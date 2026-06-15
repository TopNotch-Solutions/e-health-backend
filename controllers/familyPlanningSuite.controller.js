const { v4: uuidv4 } = require('uuid');
const {
  Visit,
  Vital,
  ScreeningAssessment,
  FamilyPlanningRecord,
  Consultation,
  QueueEntry,
  sequelize,
} = require('../models');
const { success, created, error } = require('../utils/response');
const queueService = require('../services/queueService');
const clinicBillingService = require('../services/clinicBillingService');
const { getIO } = require('../socket');
const billingChargeService = require('../services/billingChargeService');
const { createPrescriptionWithItems } = require('../services/clinicPrescriptionService');
const notificationService = require('../services/notificationService');
const { emitNurseActivity } = notificationService;
const {
  FAMILY_PLANNING_DEPARTMENT,
  PHARMACY_DEPARTMENT,
  parseOralLog,
  inferInterventionType,
  validateRecordFields,
  payloadForInterventionType,
  isSessionFinalized,
} = require('../config/familyPlanningSuite');

async function emitQueueRefresh(io, department, facilityId) {
  const entries = await queueService.getQueue(department, facilityId);
  io.to(`room:${department}`).emit('queue:refresh', { department, entries });
}

function serializeRecord(record) {
  if (!record) return null;
  const plain = record.toJSON ? record.toJSON() : record;
  const finalized = isSessionFinalized(plain);
  return {
    id: plain.id,
    visit_id: plain.visit_id,
    intervention_type: plain.intervention_type || inferInterventionType(plain),
    subdermal_insertion_date: plain.subdermal_insertion_date,
    subdermal_insertion_notes: plain.subdermal_insertion_notes,
    subdermal_replacement_date: plain.subdermal_replacement_date,
    subdermal_replacement_notes: plain.subdermal_replacement_notes,
    device_type: plain.device_type,
    device_insertion_date: plain.device_insertion_date,
    device_insertion_notes: plain.device_insertion_notes,
    device_removal_date: plain.device_removal_date,
    device_removal_notes: plain.device_removal_notes,
    oral_contraceptive_log: parseOralLog(plain.oral_contraceptive_log),
    circumcision_surgical_criteria: plain.circumcision_surgical_criteria,
    circumcision_procedure_notes: plain.circumcision_procedure_notes,
    circumcision_post_op_metrics: plain.circumcision_post_op_metrics,
    record_saved: plain.record_saved,
    record_saved_at: plain.record_saved_at,
    routed_to_pharmacy_at: plain.routed_to_pharmacy_at,
    session_completed_at: plain.session_completed_at,
    is_finalized: finalized,
    can_route_pharmacy: plain.record_saved && !finalized,
    recordedBy: plain.recordedBy || null,
  };
}

function buildRecordPayload(body) {
  const type = inferInterventionType(body);
  return payloadForInterventionType(type, body);
}

async function findRecordForVisit(visitId) {
  return FamilyPlanningRecord.findOne({
    where: { visit_id: visitId },
    include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
    order: [['updated_at', 'DESC']],
  });
}

async function assertActiveFamilyPlanningEntry(queue_entry_id, visit_id, userId, transaction) {
  const queueEntry = await QueueEntry.findByPk(queue_entry_id, { transaction });
  if (!queueEntry || queueEntry.visit_id !== visit_id) {
    return { error: 'Invalid queue entry for this visit', status: 400 };
  }
  if (queueEntry.department !== FAMILY_PLANNING_DEPARTMENT) {
    return { error: 'Queue entry is not for the Family Planning suite', status: 400 };
  }
  if (queueEntry.status !== 'in_progress') {
    return { error: 'Patient must be started before recording procedures', status: 400 };
  }
  if (queueEntry.assigned_to !== userId) {
    return { error: 'You can only process patients assigned to you', status: 403 };
  }
  return { queueEntry };
}

async function ensureSavedRecord({ visit_id, userId, body, transaction }) {
  const validationError = validateRecordFields(body);
  if (validationError) {
    return { error: validationError, status: 400 };
  }

  const visit = await Visit.findByPk(visit_id, { transaction });
  if (!visit) return { error: 'Visit not found', status: 404 };

  let record = await FamilyPlanningRecord.findOne({ where: { visit_id }, transaction });
  if (record && isSessionFinalized(record)) {
    return { error: 'This family planning session is already completed', status: 409 };
  }

  const now = new Date();
  const payload = {
    ...buildRecordPayload(body),
    record_saved: true,
    record_saved_at: now,
    recorded_by: userId,
  };

  if (record) {
    await record.update(payload, { transaction });
  } else {
    record = await FamilyPlanningRecord.create({
      id: uuidv4(),
      visit_id,
      patient_id: visit.patient_id,
      ...payload,
    }, { transaction });
  }

  return { record, visit };
}

function buildConsultationFromRecord(record) {
  const type = record.intervention_type || inferInterventionType(record);
  const parts = [`Intervention: ${type || 'family planning'}`];

  if (type === 'subdermal') {
    if (record.subdermal_insertion_notes) parts.push(`Insertion: ${record.subdermal_insertion_notes}`);
    if (record.subdermal_replacement_notes) parts.push(`Replacement: ${record.subdermal_replacement_notes}`);
  } else if (type === 'device') {
    if (record.device_insertion_notes) {
      parts.push(`${record.device_type || 'Device'} insertion: ${record.device_insertion_notes}`);
    }
    if (record.device_removal_notes) parts.push(`Removal: ${record.device_removal_notes}`);
  } else if (type === 'oral') {
    const oral = parseOralLog(record.oral_contraceptive_log);
    if (oral.length) parts.push(`Oral log: ${oral.length} entr${oral.length === 1 ? 'y' : 'ies'}`);
  }

  return {
    diagnosis: 'Family planning consultation',
    notes: parts.join('\n'),
  };
}

async function upsertFamilyPlanningConsultation(record, plannerId, transaction) {
  const { diagnosis, notes } = buildConsultationFromRecord(record);
  let consultation = await Consultation.findOne({
    where: { visit_id: record.visit_id },
    order: [['created_at', 'DESC']],
    transaction,
  });

  const payload = {
    diagnosis,
    notes,
    actions_taken: JSON.stringify({ source: 'family_planning' }),
  };

  if (consultation) {
    await consultation.update(payload, { transaction });
    return consultation;
  }

  return Consultation.create({
    id: uuidv4(),
    visit_id: record.visit_id,
    doctor_id: plannerId,
    ...payload,
  }, { transaction });
}

exports.getHandover = async (req, res) => {
  try {
    const { visitId } = req.params;
    const visit = await Visit.findByPk(visitId, {
      include: [{ association: 'patient', attributes: ['id', 'first_name', 'last_name', 'patient_number', 'sex'] }],
    });
    if (!visit) return error(res, 'Visit not found', 404);

    const [vitals, screeningAssessment, record] = await Promise.all([
      Vital.findOne({
        where: { visit_id: visitId },
        include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
      }),
      ScreeningAssessment.findOne({
        where: { visit_id: visitId },
        include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
      }),
      findRecordForVisit(visitId),
    ]);

    return success(res, {
      visit,
      patient: visit.patient,
      vitals: vitals || null,
      screeningAssessment: screeningAssessment || null,
      record: serializeRecord(record),
    });
  } catch (err) {
    console.error('Family planning handover error:', err);
    return error(res, 'Failed to fetch handover', 500);
  }
};

exports.saveRecord = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, queue_entry_id } = req.body;
    if (!visit_id || !queue_entry_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }

    const entryCheck = await assertActiveFamilyPlanningEntry(
      queue_entry_id,
      visit_id,
      req.user.id,
      t
    );
    if (entryCheck.error) {
      if (!t.finished) await t.rollback();
      return error(res, entryCheck.error, entryCheck.status);
    }

    const saved = await ensureSavedRecord({
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
    const withUser = await findRecordForVisit(visit_id);
    return success(res, { record: serializeRecord(withUser) }, 'Procedural record saved');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Family planning save record error:', err);
    return error(res, err.message || 'Failed to save record', 500);
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

    const entryCheck = await assertActiveFamilyPlanningEntry(
      queue_entry_id,
      visit_id,
      req.user.id,
      t
    );
    if (entryCheck.error) {
      if (!t.finished) await t.rollback();
      return error(res, entryCheck.error, entryCheck.status);
    }

    const saved = await ensureSavedRecord({
      visit_id,
      userId: req.user.id,
      body: req.body,
      transaction: t,
    });
    if (saved.error) {
      if (!t.finished) await t.rollback();
      return error(res, saved.error, saved.status);
    }

    const { record } = saved;
    const completedAt = new Date();
    await record.update({ session_completed_at: completedAt }, { transaction: t });

    await queueService.completeEntry(queue_entry_id, {
      nextDepartment: null,
      pushed_by: req.user.id,
      notes: 'Family planning session complete — no pharmacy routing',
    }, t);

    await clinicBillingService.applyVisitEndState({
      visitId: visit_id,
      facilityId: req.user.facility_id,
      userId: req.user.id,
      transaction: t,
      notes: 'Family planning session complete',
    });

    await t.commit();

    const io = getIO();
    try {
      await emitQueueRefresh(io, FAMILY_PLANNING_DEPARTMENT, req.user.facility_id);
      io.to(`room:${FAMILY_PLANNING_DEPARTMENT}`).emit('queue:patient_moved', {
        entryId: queue_entry_id,
        status: 'completed',
        department: FAMILY_PLANNING_DEPARTMENT,
      });
    } catch (emitErr) {
      console.error('Family planning complete socket error:', emitErr.message);
    }

    emitNurseActivity({
      visitId: visit_id,
      recordedBy: req.user.id,
      action: 'family_planning_session_complete',
    });

    return success(res, { record: serializeRecord(record) }, 'Family planning session completed');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Family planning complete session error:', err);
    return error(res, err.message || 'Failed to complete session', 500);
  }
};

exports.routeToPharmacy = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, queue_entry_id, items } = req.body;
    if (!visit_id || !queue_entry_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }
    if (!items?.length) {
      if (!t.finished) await t.rollback();
      return error(res, 'Add at least one medication to route to pharmacy', 400);
    }

    const entryCheck = await assertActiveFamilyPlanningEntry(
      queue_entry_id,
      visit_id,
      req.user.id,
      t
    );
    if (entryCheck.error) {
      if (!t.finished) await t.rollback();
      return error(res, entryCheck.error, entryCheck.status);
    }

    const saved = await ensureSavedRecord({
      visit_id,
      userId: req.user.id,
      body: req.body,
      transaction: t,
    });
    if (saved.error) {
      if (!t.finished) await t.rollback();
      return error(res, saved.error, saved.status);
    }

    const { record } = saved;
    const consultation = await upsertFamilyPlanningConsultation(record, req.user.id, t);

    const { prescription, lowStockAlerts, lowStockNote } = await createPrescriptionWithItems({
      visit_id,
      consultation_id: consultation.id,
      items,
      prescribed_by: req.user.id,
      facility_id: req.user.facility_id,
      transaction: t,
    });

    await billingChargeService.chargeConsultationFee(
      visit_id,
      consultation.id,
      req.user.facility_id,
      t
    );

    await record.update({ routed_to_pharmacy_at: new Date() }, { transaction: t });

    const visitWithPatient = await Visit.findByPk(visit_id, {
      include: [{
        association: 'patient',
        attributes: ['id', 'first_name', 'last_name', 'patient_number', 'is_emergency', 'temp_id'],
      }],
      transaction: t,
    });

    const priority =
      visitWithPatient.visit_type === 'emergency' || visitWithPatient.patient?.is_emergency
        ? 'emergency'
        : 'normal';

    const queueResult = await queueService.completeEntry(queue_entry_id, {
      nextDepartment: PHARMACY_DEPARTMENT,
      nextPriority: priority,
      notes: lowStockNote || 'Family planning prescription',
      pushed_by: req.user.id,
    }, t);

    await t.commit();

    const io = getIO();
    try {
      await emitQueueRefresh(io, FAMILY_PLANNING_DEPARTMENT, req.user.facility_id);
      io.to(`room:${FAMILY_PLANNING_DEPARTMENT}`).emit('queue:patient_moved', {
        entryId: queue_entry_id,
        status: 'completed',
        department: FAMILY_PLANNING_DEPARTMENT,
      });
      if (queueResult.nextEntry) {
        io.to(`room:${PHARMACY_DEPARTMENT}`).emit('queue:new_patient', {
          queueEntry: queueResult.nextEntry,
          patient: visitWithPatient.patient,
          visit: {
            id: visitWithPatient.id,
            visit_number: visitWithPatient.visit_number,
            visit_type: visitWithPatient.visit_type,
          },
        });
        await emitQueueRefresh(io, PHARMACY_DEPARTMENT, req.user.facility_id);
      }
      if (lowStockAlerts?.length) {
        notificationService.emitStockAlert({
          prescription_id: prescription.id,
          visit_id,
          alerts: lowStockAlerts,
          doctor: `${req.user.first_name} ${req.user.last_name}`,
        });
      }
    } catch (emitErr) {
      console.error('Family planning pharmacy route socket error:', emitErr.message);
    }

    emitNurseActivity({
      visitId: visit_id,
      recordedBy: req.user.id,
      action: 'family_planning_routed_pharmacy',
    });

    return created(res, {
      record: serializeRecord(record),
      prescription,
      nextEntry: queueResult.nextEntry,
    }, 'Prescription sent to pharmacy');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Family planning pharmacy route error:', err);
    return error(res, err.message || 'Failed to route to pharmacy', 500);
  }
};
