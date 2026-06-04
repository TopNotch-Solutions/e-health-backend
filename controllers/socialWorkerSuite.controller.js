const { v4: uuidv4 } = require('uuid');
const {
  Visit,
  Vital,
  ScreeningAssessment,
  SocialWorkerAssessment,
  QueueEntry,
  sequelize,
} = require('../models');
const { success, created, error } = require('../utils/response');
const queueService = require('../services/queueService');
const { getIO } = require('../socket');
const { emitNurseActivity } = require('../services/notificationService');
const {
  SOCIAL_WORKER_DEPARTMENT,
  BOOKING_ROOM_DEPARTMENT,
  BOOKING_PATHWAY_SOCIAL_WORKER,
  validateAssessmentFields,
  isSessionFinalized,
} = require('../config/socialWorkerSuite');

async function emitQueueRefresh(io, department, facilityId) {
  const entries = await queueService.getQueue(department, facilityId);
  io.to(`room:${department}`).emit('queue:refresh', { department, entries });
}

function serializeAssessment(assessment) {
  if (!assessment) return null;
  const plain = assessment.toJSON ? assessment.toJSON() : assessment;
  const finalized = isSessionFinalized(plain);
  return {
    id: plain.id,
    visit_id: plain.visit_id,
    social_assessment_details: plain.social_assessment_details,
    case_history: plain.case_history,
    clinical_notes: plain.clinical_notes,
    severity: plain.severity,
    assessment_saved: plain.assessment_saved,
    assessment_saved_at: plain.assessment_saved_at,
    escalated_to_booking_at: plain.escalated_to_booking_at,
    session_completed_at: plain.session_completed_at,
    is_finalized: finalized,
    can_finalize: plain.assessment_saved && plain.severity === 'routine' && !finalized,
    can_escalate: plain.assessment_saved && plain.severity === 'severe' && !finalized,
    assessedBy: plain.assessedBy || null,
  };
}

async function findAssessmentForVisit(visitId) {
  return SocialWorkerAssessment.findOne({
    where: { visit_id: visitId },
    include: [{ association: 'assessedBy', attributes: ['id', 'first_name', 'last_name'] }],
    order: [['updated_at', 'DESC']],
  });
}

async function assertActiveSocialWorkerEntry(queue_entry_id, visit_id, userId, transaction) {
  const queueEntry = await QueueEntry.findByPk(queue_entry_id, { transaction });
  if (!queueEntry || queueEntry.visit_id !== visit_id) {
    return { error: 'Invalid queue entry for this visit', status: 400 };
  }
  if (queueEntry.department !== SOCIAL_WORKER_DEPARTMENT) {
    return { error: 'Queue entry is not for the Social Worker suite', status: 400 };
  }
  if (queueEntry.status !== 'in_progress') {
    return { error: 'Patient must be started before recording assessment', status: 400 };
  }
  if (queueEntry.assigned_to !== userId) {
    return { error: 'You can only process patients assigned to you', status: 403 };
  }
  return { queueEntry };
}

async function ensureSavedAssessment({ visit_id, userId, body, transaction }) {
  const validationError = validateAssessmentFields(body);
  if (validationError) {
    return { error: validationError, status: 400 };
  }

  const visit = await Visit.findByPk(visit_id, { transaction });
  if (!visit) return { error: 'Visit not found', status: 404 };

  let assessment = await SocialWorkerAssessment.findOne({ where: { visit_id }, transaction });
  if (assessment && isSessionFinalized(assessment)) {
    return { error: 'This social work session is already completed', status: 409 };
  }

  const now = new Date();
  const payload = {
    social_assessment_details: body.social_assessment_details.trim(),
    case_history: body.case_history.trim(),
    clinical_notes: body.clinical_notes.trim(),
    severity: body.severity,
    assessment_saved: true,
    assessment_saved_at: now,
    assessed_by: userId,
  };

  if (assessment) {
    await assessment.update(payload, { transaction });
  } else {
    assessment = await SocialWorkerAssessment.create({
      id: uuidv4(),
      visit_id,
      patient_id: visit.patient_id,
      ...payload,
    }, { transaction });
  }

  return { assessment, visit };
}

exports.getHandover = async (req, res) => {
  try {
    const { visitId } = req.params;
    const visit = await Visit.findByPk(visitId, {
      include: [{ association: 'patient', attributes: ['id', 'first_name', 'last_name', 'patient_number', 'sex'] }],
    });
    if (!visit) return error(res, 'Visit not found', 404);

    const [vitals, screeningAssessment, assessment] = await Promise.all([
      Vital.findOne({
        where: { visit_id: visitId },
        include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
      }),
      ScreeningAssessment.findOne({
        where: { visit_id: visitId },
        include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
      }),
      findAssessmentForVisit(visitId),
    ]);

    return success(res, {
      visit,
      patient: visit.patient,
      vitals: vitals || null,
      screeningAssessment: screeningAssessment || null,
      assessment: serializeAssessment(assessment),
    });
  } catch (err) {
    console.error('Social worker handover error:', err);
    return error(res, 'Failed to fetch handover', 500);
  }
};

exports.saveAssessment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, queue_entry_id } = req.body;
    if (!visit_id || !queue_entry_id) {
      await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }

    const entryCheck = await assertActiveSocialWorkerEntry(
      queue_entry_id,
      visit_id,
      req.user.id,
      t
    );
    if (entryCheck.error) {
      await t.rollback();
      return error(res, entryCheck.error, entryCheck.status);
    }

    const saved = await ensureSavedAssessment({
      visit_id,
      userId: req.user.id,
      body: req.body,
      transaction: t,
    });
    if (saved.error) {
      await t.rollback();
      return error(res, saved.error, saved.status);
    }

    await t.commit();
    const withUser = await findAssessmentForVisit(visit_id);
    return success(res, { assessment: serializeAssessment(withUser) }, 'Assessment recorded');
  } catch (err) {
    await t.rollback();
    console.error('Social worker save assessment error:', err);
    return error(res, err.message || 'Failed to save assessment', 500);
  }
};

exports.completeSession = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, queue_entry_id } = req.body;
    if (!visit_id || !queue_entry_id) {
      await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }

    const entryCheck = await assertActiveSocialWorkerEntry(
      queue_entry_id,
      visit_id,
      req.user.id,
      t
    );
    if (entryCheck.error) {
      await t.rollback();
      return error(res, entryCheck.error, entryCheck.status);
    }

    const saved = await ensureSavedAssessment({
      visit_id,
      userId: req.user.id,
      body: req.body,
      transaction: t,
    });
    if (saved.error) {
      await t.rollback();
      return error(res, saved.error, saved.status);
    }

    const { assessment, visit } = saved;
    if (assessment.severity === 'severe') {
      await t.rollback();
      return error(res, 'Severe cases must be escalated to the Booking Room', 400);
    }

    const completedAt = new Date();
    await assessment.update({ session_completed_at: completedAt }, { transaction: t });
    await visit.update({
      status: 'completed',
      completed_at: completedAt,
      current_department: null,
      current_queue_position: null,
    }, { transaction: t });

    await queueService.completeEntry(queue_entry_id, {
      nextDepartment: null,
      pushed_by: req.user.id,
      notes: 'Social work session complete — routine',
    }, t);

    await t.commit();

    const io = getIO();
    try {
      await emitQueueRefresh(io, SOCIAL_WORKER_DEPARTMENT, req.user.facility_id);
      io.to(`room:${SOCIAL_WORKER_DEPARTMENT}`).emit('queue:patient_moved', {
        entryId: queue_entry_id,
        status: 'completed',
        department: SOCIAL_WORKER_DEPARTMENT,
      });
    } catch (emitErr) {
      console.error('Social worker complete socket error:', emitErr.message);
    }

    emitNurseActivity({
      visitId: visit_id,
      recordedBy: req.user.id,
      action: 'social_worker_session_complete',
    });

    return success(res, { assessment: serializeAssessment(assessment) }, 'Social work session finalized');
  } catch (err) {
    await t.rollback();
    console.error('Social worker complete session error:', err);
    return error(res, err.message || 'Failed to finalize session', 500);
  }
};

exports.escalateToBookingRoom = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, queue_entry_id } = req.body;
    if (!visit_id || !queue_entry_id) {
      await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }

    const entryCheck = await assertActiveSocialWorkerEntry(
      queue_entry_id,
      visit_id,
      req.user.id,
      t
    );
    if (entryCheck.error) {
      await t.rollback();
      return error(res, entryCheck.error, entryCheck.status);
    }

    const saved = await ensureSavedAssessment({
      visit_id,
      userId: req.user.id,
      body: req.body,
      transaction: t,
    });
    if (saved.error) {
      await t.rollback();
      return error(res, saved.error, saved.status);
    }

    const { assessment } = saved;
    if (assessment.severity !== 'severe') {
      await t.rollback();
      return error(res, 'Only severe classifications can be escalated to the Booking Room', 400);
    }

    const visitWithPatient = await Visit.findByPk(visit_id, {
      include: [{
        association: 'patient',
        attributes: ['id', 'first_name', 'last_name', 'patient_number', 'is_emergency', 'temp_id'],
      }],
      transaction: t,
    });

    await assessment.update({ escalated_to_booking_at: new Date() }, { transaction: t });

    const queueResult = await queueService.completeEntry(queue_entry_id, {
      nextDepartment: BOOKING_ROOM_DEPARTMENT,
      nextPriority:
        visitWithPatient.visit_type === 'emergency' || visitWithPatient.patient?.is_emergency
          ? 'emergency'
          : 'normal',
      notes: BOOKING_PATHWAY_SOCIAL_WORKER,
      pushed_by: req.user.id,
    }, t);

    await t.commit();

    const io = getIO();
    try {
      await emitQueueRefresh(io, SOCIAL_WORKER_DEPARTMENT, req.user.facility_id);
      io.to(`room:${SOCIAL_WORKER_DEPARTMENT}`).emit('queue:patient_moved', {
        entryId: queue_entry_id,
        status: 'completed',
        department: SOCIAL_WORKER_DEPARTMENT,
      });
      if (queueResult.nextEntry) {
        io.to(`room:${BOOKING_ROOM_DEPARTMENT}`).emit('queue:new_patient', {
          queueEntry: queueResult.nextEntry,
          patient: visitWithPatient.patient,
          visit: {
            id: visitWithPatient.id,
            visit_number: visitWithPatient.visit_number,
            visit_type: visitWithPatient.visit_type,
          },
        });
        await emitQueueRefresh(io, BOOKING_ROOM_DEPARTMENT, req.user.facility_id);
      }
    } catch (emitErr) {
      console.error('Social worker escalate socket error:', emitErr.message);
    }

    emitNurseActivity({
      visitId: visit_id,
      recordedBy: req.user.id,
      action: 'social_worker_escalated_booking',
    });

    return created(res, {
      assessment: serializeAssessment(assessment),
      nextEntry: queueResult.nextEntry,
    }, 'Patient escalated to Booking Room');
  } catch (err) {
    await t.rollback();
    console.error('Social worker escalate error:', err);
    return error(res, err.message || 'Failed to escalate patient', 500);
  }
};
