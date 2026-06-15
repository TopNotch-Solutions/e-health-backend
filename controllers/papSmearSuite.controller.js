const { v4: uuidv4 } = require('uuid');
const {
  Visit,
  Vital,
  ScreeningAssessment,
  PapSmearScreening,
  QueueEntry,
  sequelize,
} = require('../models');
const { success, created, error } = require('../utils/response');
const queueService = require('../services/queueService');
const clinicBillingService = require('../services/clinicBillingService');
const { getIO } = require('../socket');
const { emitNurseActivity } = require('../services/notificationService');
const {
  PAP_SMEAR_DEPARTMENT,
  MASTER_DOCTOR_DEPARTMENT,
  validateScreeningFields,
  isSessionFinalized,
} = require('../config/papSmearSuite');

async function emitQueueRefresh(io, department, facilityId) {
  const entries = await queueService.getQueue(department, facilityId);
  io.to(`room:${department}`).emit('queue:refresh', { department, entries });
}

function serializeScreening(screening) {
  if (!screening) return null;
  const plain = screening.toJSON ? screening.toJSON() : screening;
  const finalized = isSessionFinalized(plain);
  return {
    id: plain.id,
    visit_id: plain.visit_id,
    screening_details: plain.screening_details,
    test_observations: plain.test_observations,
    clinical_findings: plain.clinical_findings,
    severity: plain.severity,
    findings_saved: plain.findings_saved,
    findings_saved_at: plain.findings_saved_at,
    escalated_to_master_doctor_at: plain.escalated_to_master_doctor_at,
    session_completed_at: plain.session_completed_at,
    is_finalized: finalized,
    can_finalize: plain.findings_saved && plain.severity === 'routine' && !finalized,
    can_escalate: plain.findings_saved && plain.severity === 'severe' && !finalized,
    screenedBy: plain.screenedBy || null,
  };
}

async function findScreeningForVisit(visitId) {
  return PapSmearScreening.findOne({
    where: { visit_id: visitId },
    include: [{ association: 'screenedBy', attributes: ['id', 'first_name', 'last_name'] }],
    order: [['updated_at', 'DESC']],
  });
}

async function assertActivePapSmearEntry(queue_entry_id, visit_id, userId, transaction) {
  const queueEntry = await QueueEntry.findByPk(queue_entry_id, { transaction });
  if (!queueEntry || queueEntry.visit_id !== visit_id) {
    return { error: 'Invalid queue entry for this visit', status: 400 };
  }
  if (queueEntry.department !== PAP_SMEAR_DEPARTMENT) {
    return { error: 'Queue entry is not for the Pap Smear suite', status: 400 };
  }
  if (queueEntry.status !== 'in_progress') {
    return { error: 'Patient must be started before recording screening', status: 400 };
  }
  if (queueEntry.assigned_to !== userId) {
    return { error: 'You can only process patients assigned to you', status: 403 };
  }
  return { queueEntry };
}

async function ensureSavedScreening({ visit_id, userId, body, transaction }) {
  const validationError = validateScreeningFields(body);
  if (validationError) {
    return { error: validationError, status: 400 };
  }

  const visit = await Visit.findByPk(visit_id, { transaction });
  if (!visit) return { error: 'Visit not found', status: 404 };

  let screening = await PapSmearScreening.findOne({ where: { visit_id }, transaction });
  if (screening && isSessionFinalized(screening)) {
    return { error: 'This Pap smear session is already completed', status: 409 };
  }

  const now = new Date();
  const payload = {
    screening_details: body.screening_details.trim(),
    test_observations: body.test_observations.trim(),
    clinical_findings: body.clinical_findings.trim(),
    severity: body.severity,
    findings_saved: true,
    findings_saved_at: now,
    screened_by: userId,
  };

  if (screening) {
    await screening.update(payload, { transaction });
  } else {
    screening = await PapSmearScreening.create({
      id: uuidv4(),
      visit_id,
      patient_id: visit.patient_id,
      ...payload,
    }, { transaction });
  }

  return { screening, visit };
}

exports.getHandover = async (req, res) => {
  try {
    const { visitId } = req.params;
    const visit = await Visit.findByPk(visitId, {
      include: [{ association: 'patient', attributes: ['id', 'first_name', 'last_name', 'patient_number', 'sex'] }],
    });
    if (!visit) return error(res, 'Visit not found', 404);

    const [vitals, screeningAssessment, screening] = await Promise.all([
      Vital.findOne({
        where: { visit_id: visitId },
        include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
      }),
      ScreeningAssessment.findOne({
        where: { visit_id: visitId },
        include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
      }),
      findScreeningForVisit(visitId),
    ]);

    return success(res, {
      visit,
      patient: visit.patient,
      vitals: vitals || null,
      screeningAssessment: screeningAssessment || null,
      screening: serializeScreening(screening),
    });
  } catch (err) {
    console.error('Pap smear handover error:', err);
    return error(res, 'Failed to fetch handover', 500);
  }
};

exports.saveScreening = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, queue_entry_id } = req.body;
    if (!visit_id || !queue_entry_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }

    const entryCheck = await assertActivePapSmearEntry(
      queue_entry_id,
      visit_id,
      req.user.id,
      t
    );
    if (entryCheck.error) {
      if (!t.finished) await t.rollback();
      return error(res, entryCheck.error, entryCheck.status);
    }

    const saved = await ensureSavedScreening({
      visit_id,
      userId: req.user.id,
      body: req.body,
      transaction: t,
    });
    if (saved.error) {
      if (!t.finished) await t.rollback();
      return error(res, saved.error, saved.status);
    }

    await t.commit();
    const withUser = await findScreeningForVisit(visit_id);
    return success(res, { screening: serializeScreening(withUser) }, 'Screening recorded');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Pap smear save screening error:', err);
    return error(res, err.message || 'Failed to save screening', 500);
  }
};

exports.completeSession = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, queue_entry_id } = req.body;
    if (!visit_id || !queue_entry_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }

    const entryCheck = await assertActivePapSmearEntry(
      queue_entry_id,
      visit_id,
      req.user.id,
      t
    );
    if (entryCheck.error) {
      if (!t.finished) await t.rollback();
      return error(res, entryCheck.error, entryCheck.status);
    }

    const saved = await ensureSavedScreening({
      visit_id,
      userId: req.user.id,
      body: req.body,
      transaction: t,
    });
    if (saved.error) {
      if (!t.finished) await t.rollback();
      return error(res, saved.error, saved.status);
    }

    const { screening } = saved;
    if (screening.severity === 'severe') {
      if (!t.finished) await t.rollback();
      return error(res, 'Severe cases must be escalated to the Master Doctor', 400);
    }

    const completedAt = new Date();
    await screening.update({ session_completed_at: completedAt }, { transaction: t });

    await queueService.completeEntry(queue_entry_id, {
      nextDepartment: null,
      pushed_by: req.user.id,
      notes: 'Pap smear screening complete — routine',
    }, t);

    await clinicBillingService.applyVisitEndState({
      visitId: visit_id,
      facilityId: req.user.facility_id,
      userId: req.user.id,
      transaction: t,
      notes: 'Pap smear screening complete',
    });

    await t.commit();

    const io = getIO();
    try {
      await emitQueueRefresh(io, PAP_SMEAR_DEPARTMENT, req.user.facility_id);
      io.to(`room:${PAP_SMEAR_DEPARTMENT}`).emit('queue:patient_moved', {
        entryId: queue_entry_id,
        status: 'completed',
        department: PAP_SMEAR_DEPARTMENT,
      });
    } catch (emitErr) {
      console.error('Pap smear complete socket error:', emitErr.message);
    }

    emitNurseActivity({
      visitId: visit_id,
      recordedBy: req.user.id,
      action: 'pap_smear_session_complete',
    });

    return success(res, { screening: serializeScreening(screening) }, 'Pap smear session finalized');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Pap smear complete session error:', err);
    return error(res, err.message || 'Failed to finalize session', 500);
  }
};

exports.escalateToMasterDoctor = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, queue_entry_id } = req.body;
    if (!visit_id || !queue_entry_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }

    const entryCheck = await assertActivePapSmearEntry(
      queue_entry_id,
      visit_id,
      req.user.id,
      t
    );
    if (entryCheck.error) {
      if (!t.finished) await t.rollback();
      return error(res, entryCheck.error, entryCheck.status);
    }

    const saved = await ensureSavedScreening({
      visit_id,
      userId: req.user.id,
      body: req.body,
      transaction: t,
    });
    if (saved.error) {
      if (!t.finished) await t.rollback();
      return error(res, saved.error, saved.status);
    }

    const { screening } = saved;
    if (screening.severity !== 'severe') {
      if (!t.finished) await t.rollback();
      return error(res, 'Only severe classifications can be escalated to the Master Doctor', 400);
    }

    const visitWithPatient = await Visit.findByPk(visit_id, {
      include: [{
        association: 'patient',
        attributes: ['id', 'first_name', 'last_name', 'patient_number', 'is_emergency', 'temp_id'],
      }],
      transaction: t,
    });

    await screening.update({ escalated_to_master_doctor_at: new Date() }, { transaction: t });

    const queueResult = await queueService.completeEntry(queue_entry_id, {
      nextDepartment: MASTER_DOCTOR_DEPARTMENT,
      nextPriority:
        visitWithPatient.visit_type === 'emergency' || visitWithPatient.patient?.is_emergency
          ? 'emergency'
          : 'normal',
      notes: 'Pap smear severe — escalated to Master Doctor',
      pushed_by: req.user.id,
    }, t);

    await t.commit();

    const io = getIO();
    try {
      await emitQueueRefresh(io, PAP_SMEAR_DEPARTMENT, req.user.facility_id);
      io.to(`room:${PAP_SMEAR_DEPARTMENT}`).emit('queue:patient_moved', {
        entryId: queue_entry_id,
        status: 'completed',
        department: PAP_SMEAR_DEPARTMENT,
      });
      if (queueResult.nextEntry) {
        io.to(`room:${MASTER_DOCTOR_DEPARTMENT}`).emit('queue:new_patient', {
          queueEntry: queueResult.nextEntry,
          patient: visitWithPatient.patient,
          visit: {
            id: visitWithPatient.id,
            visit_number: visitWithPatient.visit_number,
            visit_type: visitWithPatient.visit_type,
          },
        });
        await emitQueueRefresh(io, MASTER_DOCTOR_DEPARTMENT, req.user.facility_id);
      }
    } catch (emitErr) {
      console.error('Pap smear escalate socket error:', emitErr.message);
    }

    emitNurseActivity({
      visitId: visit_id,
      recordedBy: req.user.id,
      action: 'pap_smear_escalated_master_doctor',
    });

    return created(res, {
      screening: serializeScreening(screening),
      nextEntry: queueResult.nextEntry,
    }, 'Patient escalated to Master Doctor');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Pap smear escalate error:', err);
    return error(res, err.message || 'Failed to escalate patient', 500);
  }
};
