const { v4: uuidv4 } = require('uuid');
const {
  Visit,
  PediatricAssessment,
  QueueEntry,
  sequelize,
} = require('../models');
const { success, created, error } = require('../utils/response');
const queueService = require('../services/queueService');
const { getIO } = require('../socket');
const { emitNurseActivity } = require('../services/notificationService');
const {
  PEDIATRIC_DEPARTMENT,
  MASTER_DOCTOR_DEPARTMENT,
  pediatricEligibilityForPatient,
  validateAssessmentFields,
  isSessionFinalized,
} = require('../config/pediatricCorner');

async function emitQueueRefresh(io, department, facilityId) {
  const entries = await queueService.getQueue(department, facilityId);
  io.to(`room:${department}`).emit('queue:refresh', { department, entries });
}

function serializeAssessment(assessment) {
  if (!assessment) return null;
  const plain = assessment.toJSON ? assessment.toJSON() : assessment;
  return {
    id: plain.id,
    visit_id: plain.visit_id,
    temperature: plain.temperature != null ? Number(plain.temperature) : null,
    weight: plain.weight != null ? Number(plain.weight) : null,
    general_assessment: plain.general_assessment,
    assessment_saved: plain.assessment_saved,
    assessment_saved_at: plain.assessment_saved_at,
    routed_to_master_doctor_at: plain.routed_to_master_doctor_at,
    is_finalized: isSessionFinalized(plain),
    assessedBy: plain.assessedBy || null,
  };
}

async function findAssessmentForVisit(visitId) {
  return PediatricAssessment.findOne({
    where: { visit_id: visitId },
    include: [{ association: 'assessedBy', attributes: ['id', 'first_name', 'last_name'] }],
    order: [['updated_at', 'DESC']],
  });
}

async function loadPatientForVisit(visitId, transaction) {
  const visit = await Visit.findByPk(visitId, {
    include: [{
      association: 'patient',
      attributes: ['id', 'first_name', 'last_name', 'patient_number', 'sex', 'date_of_birth', 'is_emergency', 'temp_id'],
    }],
    transaction,
  });
  return visit;
}

async function assertActivePediatricEntry(queue_entry_id, visit_id, userId, transaction) {
  const queueEntry = await QueueEntry.findByPk(queue_entry_id, { transaction });
  if (!queueEntry || queueEntry.visit_id !== visit_id) {
    return { error: 'Invalid queue entry for this visit', status: 400 };
  }
  if (queueEntry.department !== PEDIATRIC_DEPARTMENT) {
    return { error: 'Queue entry is not for the Pediatric Corner', status: 400 };
  }
  if (queueEntry.status !== 'in_progress') {
    return { error: 'Patient must be started before recording assessment', status: 400 };
  }
  if (queueEntry.assigned_to !== userId) {
    return { error: 'You can only process patients assigned to you', status: 403 };
  }
  return { queueEntry };
}

async function assertPediatricEligible(visitId, transaction) {
  const visit = await loadPatientForVisit(visitId, transaction);
  if (!visit) return { error: 'Visit not found', status: 404 };
  const eligibility = pediatricEligibilityForPatient(visit.patient);
  if (!eligibility.eligible) {
    return { error: eligibility.message, status: 403, eligibility };
  }
  return { visit, eligibility };
}

exports.getHandover = async (req, res) => {
  try {
    const { visitId } = req.params;
    const visit = await loadPatientForVisit(visitId);
    if (!visit) return error(res, 'Visit not found', 404);

    const eligibility = pediatricEligibilityForPatient(visit.patient);
    const assessment = await findAssessmentForVisit(visitId);

    return success(res, {
      visit,
      patient: visit.patient,
      eligibility,
      assessment: serializeAssessment(assessment),
    });
  } catch (err) {
    console.error('Pediatric handover error:', err);
    return error(res, 'Failed to fetch handover', 500);
  }
};

exports.routeToMasterDoctor = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, queue_entry_id } = req.body;
    if (!visit_id || !queue_entry_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }

    const entryCheck = await assertActivePediatricEntry(
      queue_entry_id,
      visit_id,
      req.user.id,
      t
    );
    if (entryCheck.error) {
      if (!t.finished) await t.rollback();
      return error(res, entryCheck.error, entryCheck.status);
    }

    const eligibleCheck = await assertPediatricEligible(visit_id, t);
    if (eligibleCheck.error) {
      if (!t.finished) await t.rollback();
      return error(res, eligibleCheck.error, eligibleCheck.status);
    }

    const validationError = validateAssessmentFields(req.body);
    if (validationError) {
      if (!t.finished) await t.rollback();
      return error(res, validationError, 400);
    }

    const { visit } = eligibleCheck;
    let assessment = await PediatricAssessment.findOne({ where: { visit_id }, transaction: t });
    if (assessment && isSessionFinalized(assessment)) {
      if (!t.finished) await t.rollback();
      return error(res, 'This pediatric assessment is already completed', 409);
    }

    const now = new Date();
    const payload = {
      temperature: Number(req.body.temperature),
      weight: Number(req.body.weight),
      general_assessment: req.body.general_assessment.trim(),
      assessment_saved: true,
      assessment_saved_at: now,
      assessed_by: req.user.id,
      routed_to_master_doctor_at: now,
    };

    if (assessment) {
      await assessment.update(payload, { transaction: t });
    } else {
      assessment = await PediatricAssessment.create({
        id: uuidv4(),
        visit_id,
        patient_id: visit.patient_id,
        ...payload,
      }, { transaction: t });
    }

    const visitWithPatient = await Visit.findByPk(visit_id, {
      include: [{
        association: 'patient',
        attributes: ['id', 'first_name', 'last_name', 'patient_number', 'is_emergency', 'temp_id'],
      }],
      transaction: t,
    });

    const queueResult = await queueService.completeEntry(queue_entry_id, {
      nextDepartment: MASTER_DOCTOR_DEPARTMENT,
      nextPriority:
        visitWithPatient.visit_type === 'emergency' || visitWithPatient.patient?.is_emergency
          ? 'emergency'
          : 'normal',
      notes: 'Pediatric Corner — routed to Master Doctor',
      pushed_by: req.user.id,
    }, t);

    await t.commit();

    const io = getIO();
    try {
      await emitQueueRefresh(io, PEDIATRIC_DEPARTMENT, req.user.facility_id);
      io.to(`room:${PEDIATRIC_DEPARTMENT}`).emit('queue:patient_moved', {
        entryId: queue_entry_id,
        status: 'completed',
        department: PEDIATRIC_DEPARTMENT,
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
      console.error('Pediatric route socket error:', emitErr.message);
    }

    emitNurseActivity({
      visitId: visit_id,
      recordedBy: req.user.id,
      action: 'pediatric_routed_master_doctor',
    });

    const withUser = await findAssessmentForVisit(visit_id);
    return created(res, {
      assessment: serializeAssessment(withUser),
      nextEntry: queueResult.nextEntry,
    }, 'Pediatric assessment saved — patient sent to Master Doctor');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Pediatric route to master doctor error:', err);
    return error(res, err.message || 'Failed to route patient', 500);
  }
};
