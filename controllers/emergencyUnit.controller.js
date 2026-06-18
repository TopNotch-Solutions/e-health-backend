const { v4: uuidv4 } = require('uuid');
const {
  Visit,
  Patient,
  Vital,
  ScreeningAssessment,
  EmergencyIntervention,
  Consultation,
  QueueEntry,
  sequelize,
} = require('../models');
const { success, created, error } = require('../utils/response');
const queueService = require('../services/queueService');
const { pushPrescriptionToPharmacy } = require('../services/clinicPrescriptionService');
const { getIO } = require('../socket');
const {
  EMERGENCY_UNIT_NURSE_DEPARTMENT,
  EMERGENCY_UNIT_DOCTOR_DEPARTMENT,
  EMERGENCY_UNIT_VISIT_CLASSIFICATION,
  isValidNurseDestination,
  routingLabel,
  validateInterventions,
  validateEmergencyUnitNurseIntake,
} = require('../config/emergencyUnitNurseRouting');
const {
  EMERGENCY_UNIT_DOCTOR_DEPARTMENT: EU_DOCTOR_DEPT,
  validateDiagnosis,
} = require('../config/emergencyUnitDoctorRouting');
const { finalizeOutpatientDischarge } = require('../services/visitDischargeService');
const {
  resolveDischargeDiagnosis,
  buildRefusalDischargeNotes,
  refusalDischargeActionsTaken,
} = require('../config/dischargeDocumentation');

async function emitQueueRefresh(io, department, facilityId) {
  const entries = await queueService.getQueue(department, facilityId);
  io.to(`room:${department}`).emit('queue:refresh', { department, entries });
}

async function getHandoverPayload(visitId) {
  const [vital, screeningAssessment, interventions] = await Promise.all([
    Vital.findOne({
      where: { visit_id: visitId },
      include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
    }),
    ScreeningAssessment.findOne({
      where: { visit_id: visitId },
      include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
    }),
    EmergencyIntervention.findAll({
      where: { visit_id: visitId },
      order: [['created_at', 'DESC']],
      include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
    }),
  ]);

  let pathType = null;
  if (vital?.visit_classification === 'follow_up') pathType = 'follow_up';
  else if (vital?.visit_classification === 'sick' || screeningAssessment) pathType = 'sick';

  return {
    vitals: vital || null,
    screeningAssessment: screeningAssessment || null,
    interventions,
    pathType,
  };
}

async function upsertConsultation({ visit_id, user_id, diagnosis, notes, actions_taken, transaction }) {
  let consultation = await Consultation.findOne({
    where: { visit_id },
    order: [['created_at', 'DESC']],
    transaction,
  });

  const payload = {
    diagnosis: (diagnosis && String(diagnosis).trim()) || null,
    notes: notes || null,
    actions_taken: actions_taken || null,
  };

  if (consultation) {
    await consultation.update(payload, { transaction });
    return consultation;
  }

  consultation = await Consultation.create(
    {
      id: uuidv4(),
      visit_id,
      doctor_id: user_id,
      ...payload,
    },
    { transaction }
  );
  return consultation;
}

async function resolveQueueEntry({ visit_id, queue_entry_id, department, transaction }) {
  let entry = await queueService.findActiveEntryForVisit(visit_id, department, transaction);
  if (!entry && queue_entry_id) {
    entry = await QueueEntry.findByPk(queue_entry_id, { transaction });
  }
  if (entry && entry.department === department && ['waiting', 'in_progress'].includes(entry.status)) {
    return entry;
  }
  return null;
}

function emitPharmacyNotification(io, { pharmacyEntry, prescription }) {
  if (!io) return;
  const payload = {
    queueEntry: pharmacyEntry || null,
    prescriptionId: prescription?.id || null,
    department: 'pharmacy',
  };
  io.to('room:pharmacist').emit('queue:new_patient', payload);
  io.to('room:pharmacy').emit('queue:new_patient', payload);
  io.to('room:pharmacy').emit('pharmacy:new_prescription', payload);
}

const VITAL_FIELDS = [
  'temperature', 'blood_pressure_systolic', 'blood_pressure_diastolic',
  'pulse_rate', 'respiratory_rate', 'weight', 'height', 'oxygen_saturation',
  'allergies', 'accompanied_by', 'chief_complaint', 'onset_at',
  'aggravating_factors', 'alleviating_factors', 'current_medications',
  'immunization_status', 'social_history', 'physical_examination', 'notes',
  'visit_classification',
];

function pickVitalAttributes(body) {
  const attrs = {};
  for (const field of VITAL_FIELDS) {
    if (body[field] !== undefined) {
      attrs[field] = body[field] === '' ? null : body[field];
    }
  }
  return attrs;
}

async function upsertVisitVitals({ visit_id, user_id, visit_classification, body, transaction }) {
  const vitalAttrs = pickVitalAttributes(body);
  vitalAttrs.visit_classification = visit_classification;

  const existing = await Vital.findOne({ where: { visit_id }, transaction });
  if (existing) {
    await existing.update({ ...vitalAttrs, recorded_by: user_id }, { transaction });
    return existing;
  }

  return Vital.create(
    {
      id: uuidv4(),
      visit_id,
      recorded_by: user_id,
      ...vitalAttrs,
    },
    { transaction }
  );
}

async function upsertScreeningAssessment({
  visit_id,
  user_id,
  symptoms,
  reason,
  diagnosis,
  transaction,
}) {
  const payload = {
    symptoms: symptoms.trim(),
    reason: reason.trim(),
    diagnosis: diagnosis.trim(),
    recorded_by: user_id,
  };

  const existing = await ScreeningAssessment.findOne({ where: { visit_id }, transaction });
  if (existing) {
    await existing.update(payload, { transaction });
    return existing;
  }

  return ScreeningAssessment.create(
    {
      id: uuidv4(),
      visit_id,
      ...payload,
    },
    { transaction }
  );
}

exports.getNurseHandover = async (req, res) => {
  try {
    return success(res, await getHandoverPayload(req.params.visitId));
  } catch (err) {
    return error(res, 'Failed to fetch handover', 500);
  }
};

exports.getDoctorHandover = async (req, res) => {
  try {
    return success(res, await getHandoverPayload(req.params.visitId));
  } catch (err) {
    return error(res, 'Failed to fetch handover', 500);
  }
};

exports.nurseSubmitAndRoute = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      visit_id,
      queue_entry_id,
      next_department,
      symptoms,
      reason,
      diagnosis,
      interventions,
      notes,
      items,
    } = req.body;

    const visit_classification = EMERGENCY_UNIT_VISIT_CLASSIFICATION;

    if (!visit_id || !queue_entry_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }
    if (!next_department || !isValidNurseDestination(next_department)) {
      if (!t.finished) await t.rollback();
      return error(res, 'Invalid routing destination', 400);
    }

    const intakeError = validateEmergencyUnitNurseIntake(req.body);
    if (intakeError) {
      if (!t.finished) await t.rollback();
      return error(res, intakeError, 400);
    }

    const interventionError = validateInterventions(interventions);
    if (interventionError) {
      if (!t.finished) await t.rollback();
      return error(res, interventionError, 400);
    }

    if (next_department === 'pharmacy' && (!items || !items.length)) {
      if (!t.finished) await t.rollback();
      return error(res, 'Add at least one medication to route to the pharmacist', 400);
    }

    const visit = await Visit.findByPk(visit_id, {
      include: [{ association: 'patient', attributes: ['id', 'is_emergency'] }],
      transaction: t,
    });
    if (!visit) {
      if (!t.finished) await t.rollback();
      return error(res, 'Visit not found', 404);
    }

    const nurseEntry = await QueueEntry.findByPk(queue_entry_id, { transaction: t });
    if (!nurseEntry || nurseEntry.visit_id !== visit_id || nurseEntry.department !== EMERGENCY_UNIT_NURSE_DEPARTMENT) {
      if (!t.finished) await t.rollback();
      return error(res, 'Invalid emergency unit queue entry', 400);
    }
    if (nurseEntry.status !== 'in_progress') {
      if (!t.finished) await t.rollback();
      return error(res, 'Patient must be started before submitting', 400);
    }
    if (nurseEntry.assigned_to !== req.user.id) {
      if (!t.finished) await t.rollback();
      return error(res, 'You can only process patients assigned to you', 403);
    }

    await upsertVisitVitals({
      visit_id,
      user_id: req.user.id,
      visit_classification,
      body: req.body,
      transaction: t,
    });

    await upsertScreeningAssessment({
      visit_id,
      user_id: req.user.id,
      symptoms,
      reason,
      diagnosis,
      transaction: t,
    });

    await EmergencyIntervention.create({
      id: uuidv4(),
      visit_id,
      recorded_by: req.user.id,
      interventions: interventions.trim(),
      notes: notes?.trim() || null,
    }, { transaction: t });

    const consultation = await upsertConsultation({
      visit_id,
      user_id: req.user.id,
      diagnosis: 'Emergency unit triage',
      notes: notes?.trim() || null,
      actions_taken: JSON.stringify({
        emergency_unit_nurse: true,
        visit_classification,
        routed_to: next_department,
      }),
      transaction: t,
    });

    let prescriptionResult = { prescription: null, pharmacyEntry: null, lowStockAlerts: [] };
    let nextDept = next_department;
    const priority = visit.patient?.is_emergency || visit.visit_type === 'emergency' ? 'emergency' : 'normal';

    if (next_department === 'pharmacy') {
      prescriptionResult = await pushPrescriptionToPharmacy({
        visit_id,
        consultation_id: consultation.id,
        items,
        user: req.user,
        transaction: t,
      });
      nextDept = null;
    } else if (next_department === 'emergency_unit_doctor') {
      nextDept = EMERGENCY_UNIT_DOCTOR_DEPARTMENT;
    }

    const queueResult = await queueService.completeEntry(queue_entry_id, {
      nextDepartment: nextDept,
      nextPriority: priority,
      notes: `Emergency unit nurse → ${routingLabel(next_department)}`,
      pushed_by: req.user.id,
    }, t);

    await t.commit();

    const io = getIO();
    try {
      await emitQueueRefresh(io, EMERGENCY_UNIT_NURSE_DEPARTMENT, req.user.facility_id);
      io.to(`room:${EMERGENCY_UNIT_NURSE_DEPARTMENT}`).emit('queue:patient_moved', {
        entryId: queue_entry_id,
        status: 'completed',
        department: EMERGENCY_UNIT_NURSE_DEPARTMENT,
      });

      if (queueResult.nextEntry && nextDept) {
        io.to(`room:${nextDept}`).emit('queue:new_patient', { queueEntry: queueResult.nextEntry });
        await emitQueueRefresh(io, nextDept, req.user.facility_id);
      }
      if (prescriptionResult.pharmacyEntry) {
        emitPharmacyNotification(io, prescriptionResult);
        await emitQueueRefresh(io, 'pharmacy', req.user.facility_id);
      }
    } catch (emitErr) {
      console.error('EU nurse route socket error:', emitErr.message);
    }

    return created(res, {
      consultation,
      prescription: prescriptionResult.prescription,
      nextEntry: queueResult.nextEntry,
    }, prescriptionResult.prescription
      ? 'Interventions recorded — patient routed to Pharmacy'
      : `Interventions recorded — patient routed to ${routingLabel(next_department)}`);
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('EU nurse submit error:', err);
    return error(res, err.message || 'Failed to submit', 500);
  }
};

exports.doctorTransferBookingRoom = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, queue_entry_id, diagnosis, notes, items } = req.body;

    if (!visit_id || !queue_entry_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }

    const diagnosisError = validateDiagnosis(diagnosis);
    if (diagnosisError) {
      if (!t.finished) await t.rollback();
      return error(res, diagnosisError, 400);
    }

    const visit = await Visit.findByPk(visit_id, { transaction: t });
    if (!visit) {
      if (!t.finished) await t.rollback();
      return error(res, 'Visit not found', 404);
    }

    const consultation = await upsertConsultation({
      visit_id,
      user_id: req.user.id,
      diagnosis,
      notes,
      actions_taken: JSON.stringify({
        emergency_unit_doctor: true,
        disposition: 'booking_room',
        prescribed: Boolean(items?.length),
      }),
      transaction: t,
    });

    let prescriptionResult = { prescription: null, pharmacyEntry: null, lowStockAlerts: [] };
    if (items?.length) {
      prescriptionResult = await pushPrescriptionToPharmacy({
        visit_id,
        consultation_id: consultation.id,
        items,
        user: req.user,
        transaction: t,
      });
    }

    const doctorEntry = await resolveQueueEntry({
      visit_id,
      queue_entry_id,
      department: EU_DOCTOR_DEPT,
      transaction: t,
    });

    let queueResult = { completedEntry: null, nextEntry: null };
    if (doctorEntry) {
      queueResult = await queueService.completeEntry(
        doctorEntry.id,
        {
          nextDepartment: 'booking_room',
          nextPriority: 'emergency',
          pushed_by: req.user.id,
          notes: notes || 'Emergency unit doctor → Booking Room',
        },
        t
      );
    } else {
      queueResult.nextEntry = await queueService.pushToQueue(
        {
          visit_id,
          department: 'booking_room',
          priority: 'emergency',
          pushed_by: req.user.id,
          notes: notes || 'Emergency unit doctor → Booking Room',
        },
        t
      );
    }

    await t.commit();

    const io = getIO();
    try {
      await emitQueueRefresh(io, EU_DOCTOR_DEPT, req.user.facility_id);
      if (queueResult.nextEntry) {
        io.to('room:booking_room').emit('queue:new_patient', { queueEntry: queueResult.nextEntry });
        await emitQueueRefresh(io, 'booking_room', req.user.facility_id);
      }
      if (prescriptionResult.pharmacyEntry) {
        emitPharmacyNotification(io, prescriptionResult);
      }
    } catch (emitErr) {
      console.error('EU doctor booking socket error:', emitErr.message);
    }

    return created(res, {
      consultation,
      queueEntry: queueResult.nextEntry,
      prescription: prescriptionResult.prescription,
    }, prescriptionResult.prescription
      ? 'Assessment saved — prescription to pharmacy, patient sent to Booking Room'
      : 'Assessment saved — patient transferred to Booking Room');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('EU doctor booking error:', err);
    return error(res, err.message || 'Failed to transfer', 500);
  }
};

exports.doctorPrescribePharmacy = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, queue_entry_id, diagnosis, notes, items } = req.body;

    if (!visit_id || !queue_entry_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }

    const diagnosisError = validateDiagnosis(diagnosis);
    if (diagnosisError) {
      if (!t.finished) await t.rollback();
      return error(res, diagnosisError, 400);
    }

    if (!items?.length) {
      if (!t.finished) await t.rollback();
      return error(res, 'Add at least one medication to route to pharmacy', 400);
    }

    const visit = await Visit.findByPk(visit_id, { transaction: t });
    if (!visit) {
      if (!t.finished) await t.rollback();
      return error(res, 'Visit not found', 404);
    }

    const consultation = await upsertConsultation({
      visit_id,
      user_id: req.user.id,
      diagnosis,
      notes,
      actions_taken: JSON.stringify({
        emergency_unit_doctor: true,
        disposition: 'pharmacy',
        prescribed: true,
      }),
      transaction: t,
    });

    const prescriptionResult = await pushPrescriptionToPharmacy({
      visit_id,
      consultation_id: consultation.id,
      items,
      user: req.user,
      transaction: t,
    });

    const doctorEntry = await resolveQueueEntry({
      visit_id,
      queue_entry_id,
      department: EU_DOCTOR_DEPT,
      transaction: t,
    });

    let queueResult = { completedEntry: null, nextEntry: null };
    if (doctorEntry) {
      queueResult = await queueService.completeEntry(
        doctorEntry.id,
        {
          pushed_by: req.user.id,
          notes: notes || 'Emergency unit doctor — prescription to pharmacy',
        },
        t
      );
    }

    await t.commit();

    const io = getIO();
    try {
      await emitQueueRefresh(io, EU_DOCTOR_DEPT, req.user.facility_id);
      io.to(`room:${EU_DOCTOR_DEPT}`).emit('queue:patient_moved', {
        entryId: doctorEntry?.id || queue_entry_id,
        status: 'completed',
        department: EU_DOCTOR_DEPT,
      });
      if (prescriptionResult.pharmacyEntry) {
        emitPharmacyNotification(io, prescriptionResult);
        await emitQueueRefresh(io, 'pharmacy', req.user.facility_id);
      }
    } catch (emitErr) {
      console.error('EU doctor pharmacy socket error:', emitErr.message);
    }

    return created(res, {
      consultation,
      prescription: prescriptionResult.prescription,
      queueCompleted: Boolean(queueResult.completedEntry),
    }, 'Prescription sent to pharmacy — consultation completed');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('EU doctor pharmacy error:', err);
    return error(res, err.message || 'Failed to prescribe', 500);
  }
};

exports.doctorDischargePatient = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, queue_entry_id, diagnosis, discharge_reason, notes } = req.body;
    const reason = (discharge_reason || '').trim();

    if (!visit_id || !queue_entry_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }
    if (!reason) {
      if (!t.finished) await t.rollback();
      return error(res, 'discharge_reason is required', 400);
    }

    const visit = await Visit.findByPk(visit_id, { transaction: t });
    if (!visit) {
      if (!t.finished) await t.rollback();
      return error(res, 'Visit not found', 404);
    }

    const consultation = await upsertConsultation({
      visit_id,
      user_id: req.user.id,
      diagnosis: resolveDischargeDiagnosis(diagnosis),
      notes: buildRefusalDischargeNotes(reason, notes),
      actions_taken: refusalDischargeActionsTaken(reason, {
        emergency_unit_doctor: true,
        disposition: 'discharge',
      }),
      transaction: t,
    });

    const doctorEntry = await resolveQueueEntry({
      visit_id,
      queue_entry_id,
      department: EU_DOCTOR_DEPT,
      transaction: t,
    });

    if (doctorEntry) {
      await queueService.completeEntry(
        doctorEntry.id,
        { pushed_by: req.user.id, notes: `Patient declined care: ${reason}` },
        t
      );
    }

    const dischargeResult = await finalizeOutpatientDischarge({
      visitId: visit_id,
      dischargeNotes: reason,
      userId: req.user.id,
      facilityId: req.user.facility_id,
      transaction: t,
    });

    await t.commit();

    const io = getIO();
    try {
      await emitQueueRefresh(io, EU_DOCTOR_DEPT, req.user.facility_id);
      if (doctorEntry) {
        io.to(`room:${EU_DOCTOR_DEPT}`).emit('queue:patient_moved', {
          entryId: doctorEntry.id,
          status: 'completed',
          department: EU_DOCTOR_DEPT,
        });
      }
    } catch (emitErr) {
      console.error('EU doctor discharge socket error:', emitErr.message);
    }

    if (dischargeResult.routedToBilling) {
      return success(
        res,
        {
          consultation,
          queueEntry: dischargeResult.queueEntry,
          bill: dischargeResult.bill,
          total_amount: dischargeResult.total_amount,
        },
        'Patient sent to billing — payment required before discharge'
      );
    }

    return created(
      res,
      { consultation, status: 'discharged' },
      'Patient declined care — consultation ended and documented'
    );
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('EU doctor discharge error:', err);
    return error(res, err.message || 'Failed to discharge patient', 500);
  }
};
