const { v4: uuidv4 } = require('uuid');
const {
  Visit,
  Vital,
  ScreeningAssessment,
  DermatologyAssessment,
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
const {
  DERMATOLOGIST_DEPARTMENT,
  BOOKING_ROOM_DEPARTMENT,
  PHARMACY_DEPARTMENT,
  BOOKING_PATHWAY_DERMATOLOGIST,
  validateObservationFields,
  isSessionFinalized,
} = require('../config/dermatologistRouting');

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
    clinical_observations: plain.clinical_observations,
    skin_assessment: plain.skin_assessment,
    differential_diagnosis: plain.differential_diagnosis,
    treatment_plan: plain.treatment_plan,
    observations_saved: plain.observations_saved,
    observations_saved_at: plain.observations_saved_at,
    routed_to_pharmacy_at: plain.routed_to_pharmacy_at,
    routed_to_booking_at: plain.routed_to_booking_at,
    session_completed_at: plain.session_completed_at,
    is_finalized: isSessionFinalized(plain),
    can_dispose: plain.observations_saved && !isSessionFinalized(plain),
    assessedBy: plain.assessedBy || null,
  };
}

function buildConsultationFromAssessment(assessment) {
  const diagnosis = assessment.differential_diagnosis?.trim()
    || 'Dermatology consultation';
  const notes = [
    assessment.clinical_observations,
    assessment.skin_assessment,
    assessment.treatment_plan ? `Treatment plan: ${assessment.treatment_plan}` : null,
  ].filter(Boolean).join('\n\n');
  return { diagnosis, notes };
}

async function upsertDermatologyConsultation(assessment, doctorId, transaction) {
  const { diagnosis, notes } = buildConsultationFromAssessment(assessment);
  let consultation = await Consultation.findOne({
    where: { visit_id: assessment.visit_id },
    order: [['created_at', 'DESC']],
    transaction,
  });

  const payload = {
    diagnosis,
    notes,
    actions_taken: JSON.stringify({ source: 'dermatologist' }),
  };

  if (consultation) {
    await consultation.update(payload, { transaction });
    return consultation;
  }

  return Consultation.create({
    id: uuidv4(),
    visit_id: assessment.visit_id,
    doctor_id: doctorId,
    ...payload,
  }, { transaction });
}

async function assertActiveDermatologistEntry(queue_entry_id, visit_id, userId, transaction) {
  const queueEntry = await QueueEntry.findByPk(queue_entry_id, { transaction });
  if (!queueEntry || queueEntry.visit_id !== visit_id) {
    return { error: 'Invalid queue entry for this visit', status: 400 };
  }
  if (queueEntry.department !== DERMATOLOGIST_DEPARTMENT) {
    return { error: 'Queue entry is not for the dermatologist', status: 400 };
  }
  if (queueEntry.status !== 'in_progress') {
    return { error: 'Patient must be started before completing actions', status: 400 };
  }
  if (queueEntry.assigned_to !== userId) {
    return { error: 'You can only process patients assigned to you', status: 403 };
  }
  return { queueEntry };
}

async function ensureSavedAssessment({
  visit_id,
  userId,
  body,
  transaction,
}) {
  const validationError = validateObservationFields(body);
  if (validationError) {
    return { error: validationError, status: 400 };
  }

  const visit = await Visit.findByPk(visit_id, { transaction });
  if (!visit) return { error: 'Visit not found', status: 404 };

  let assessment = await DermatologyAssessment.findOne({ where: { visit_id }, transaction });
  if (assessment && isSessionFinalized(assessment)) {
    return { error: 'This dermatology session is already completed', status: 409 };
  }

  const now = new Date();
  const payload = {
    clinical_observations: body.clinical_observations.trim(),
    skin_assessment: body.skin_assessment.trim(),
    differential_diagnosis: body.differential_diagnosis?.trim() || null,
    treatment_plan: body.treatment_plan?.trim() || null,
    observations_saved: true,
    observations_saved_at: now,
    assessed_by: userId,
  };

  if (assessment) {
    await assessment.update(payload, { transaction });
  } else {
    assessment = await DermatologyAssessment.create({
      id: uuidv4(),
      visit_id,
      patient_id: visit.patient_id,
      ...payload,
    }, { transaction });
  }

  return { assessment, visit };
}

async function findAssessmentForVisit(visitId) {
  return DermatologyAssessment.findOne({
    where: { visit_id: visitId },
    include: [{ association: 'assessedBy', attributes: ['id', 'first_name', 'last_name'] }],
    order: [['updated_at', 'DESC']],
  });
}

exports.getHandover = async (req, res) => {
  try {
    const { visitId } = req.params;
    const visit = await Visit.findByPk(visitId, {
      include: [{ association: 'patient', attributes: ['id', 'first_name', 'last_name', 'patient_number'] }],
    });
    if (!visit) return error(res, 'Visit not found', 404);

    const [vital, screeningAssessment, assessment, priorConsultations] = await Promise.all([
      Vital.findOne({
        where: { visit_id: visitId },
        include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
      }),
      ScreeningAssessment.findOne({
        where: { visit_id: visitId },
        include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
      }),
      findAssessmentForVisit(visitId),
      Consultation.findAll({
        where: { patient_id: visit.patient_id },
        order: [['created_at', 'DESC']],
        limit: 8,
        include: [{ association: 'doctor', attributes: ['id', 'first_name', 'last_name'] }],
      }),
    ]);

    return success(res, {
      visit,
      patient: visit.patient,
      vitals: vital || null,
      screeningAssessment: screeningAssessment || null,
      assessment: serializeAssessment(assessment),
      priorConsultations,
    });
  } catch (err) {
    console.error('Dermatologist handover error:', err);
    return error(res, 'Failed to fetch handover', 500);
  }
};

exports.saveObservations = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, queue_entry_id } = req.body;
    if (!visit_id || !queue_entry_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }

    const entryCheck = await assertActiveDermatologistEntry(
      queue_entry_id,
      visit_id,
      req.user.id,
      t
    );
    if (entryCheck.error) {
      if (!t.finished) await t.rollback();
      return error(res, entryCheck.error, entryCheck.status);
    }

    const saved = await ensureSavedAssessment({
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
    const withUser = await findAssessmentForVisit(visit_id);
    return success(res, { assessment: serializeAssessment(withUser) }, 'Clinical observations saved');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Dermatologist save observations error:', err);
    return error(res, err.message || 'Failed to save observations', 500);
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

    const entryCheck = await assertActiveDermatologistEntry(
      queue_entry_id,
      visit_id,
      req.user.id,
      t
    );
    if (entryCheck.error) {
      if (!t.finished) await t.rollback();
      return error(res, entryCheck.error, entryCheck.status);
    }

    const saved = await ensureSavedAssessment({
      visit_id,
      userId: req.user.id,
      body: req.body,
      transaction: t,
    });
    if (saved.error) {
      if (!t.finished) await t.rollback();
      return error(res, saved.error, saved.status);
    }

    const { assessment } = saved;
    await upsertDermatologyConsultation(assessment, req.user.id, t);

    const completedAt = new Date();
    await assessment.update({ session_completed_at: completedAt }, { transaction: t });

    await queueService.completeEntry(queue_entry_id, {
      nextDepartment: null,
      pushed_by: req.user.id,
      notes: 'Dermatology session complete — no further routing',
    }, t);

    await clinicBillingService.applyVisitEndState({
      visitId: visit_id,
      facilityId: req.user.facility_id,
      userId: req.user.id,
      transaction: t,
      notes: 'Dermatology session complete',
    });

    await t.commit();

    const io = getIO();
    try {
      await emitQueueRefresh(io, DERMATOLOGIST_DEPARTMENT, req.user.facility_id);
      io.to(`room:${DERMATOLOGIST_DEPARTMENT}`).emit('queue:patient_moved', {
        entryId: queue_entry_id,
        status: 'completed',
        department: DERMATOLOGIST_DEPARTMENT,
      });
    } catch (emitErr) {
      console.error('Dermatologist complete session socket error:', emitErr.message);
    }

    return success(res, { assessment: serializeAssessment(assessment) }, 'Session saved and completed');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Dermatologist complete session error:', err);
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

    const entryCheck = await assertActiveDermatologistEntry(
      queue_entry_id,
      visit_id,
      req.user.id,
      t
    );
    if (entryCheck.error) {
      if (!t.finished) await t.rollback();
      return error(res, entryCheck.error, entryCheck.status);
    }

    const saved = await ensureSavedAssessment({
      visit_id,
      userId: req.user.id,
      body: req.body,
      transaction: t,
    });
    if (saved.error) {
      if (!t.finished) await t.rollback();
      return error(res, saved.error, saved.status);
    }

    const { assessment, visit } = saved;
    const consultation = await upsertDermatologyConsultation(assessment, req.user.id, t);

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

    await assessment.update({ routed_to_pharmacy_at: new Date() }, { transaction: t });

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
      notes: lowStockNote || 'Dermatologist prescription',
      pushed_by: req.user.id,
    }, t);

    await t.commit();

    const io = getIO();
    try {
      await emitQueueRefresh(io, DERMATOLOGIST_DEPARTMENT, req.user.facility_id);
      io.to(`room:${DERMATOLOGIST_DEPARTMENT}`).emit('queue:patient_moved', {
        entryId: queue_entry_id,
        status: 'completed',
        department: DERMATOLOGIST_DEPARTMENT,
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
      console.error('Dermatologist pharmacy route socket error:', emitErr.message);
    }

    return created(res, {
      assessment: serializeAssessment(assessment),
      prescription,
      nextEntry: queueResult.nextEntry,
    }, 'Prescription sent to pharmacy');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Dermatologist pharmacy route error:', err);
    return error(res, err.message || 'Failed to route to pharmacy', 500);
  }
};

exports.routeToBookingRoom = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, queue_entry_id } = req.body;

    if (!visit_id || !queue_entry_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }

    const entryCheck = await assertActiveDermatologistEntry(
      queue_entry_id,
      visit_id,
      req.user.id,
      t
    );
    if (entryCheck.error) {
      if (!t.finished) await t.rollback();
      return error(res, entryCheck.error, entryCheck.status);
    }

    const saved = await ensureSavedAssessment({
      visit_id,
      userId: req.user.id,
      body: req.body,
      transaction: t,
    });
    if (saved.error) {
      if (!t.finished) await t.rollback();
      return error(res, saved.error, saved.status);
    }

    const { assessment } = saved;
    await upsertDermatologyConsultation(assessment, req.user.id, t);
    await assessment.update({ routed_to_booking_at: new Date() }, { transaction: t });

    const visitWithPatient = await Visit.findByPk(visit_id, {
      include: [{
        association: 'patient',
        attributes: ['id', 'first_name', 'last_name', 'patient_number', 'is_emergency', 'temp_id'],
      }],
      transaction: t,
    });

    const queueResult = await queueService.completeEntry(queue_entry_id, {
      nextDepartment: BOOKING_ROOM_DEPARTMENT,
      nextPriority:
        visitWithPatient.visit_type === 'emergency' || visitWithPatient.patient?.is_emergency
          ? 'emergency'
          : 'normal',
      notes: BOOKING_PATHWAY_DERMATOLOGIST,
      pushed_by: req.user.id,
    }, t);

    await t.commit();

    const io = getIO();
    try {
      await emitQueueRefresh(io, DERMATOLOGIST_DEPARTMENT, req.user.facility_id);
      io.to(`room:${DERMATOLOGIST_DEPARTMENT}`).emit('queue:patient_moved', {
        entryId: queue_entry_id,
        status: 'completed',
        department: DERMATOLOGIST_DEPARTMENT,
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
      console.error('Dermatologist route socket error:', emitErr.message);
    }

    return created(res, {
      assessment: serializeAssessment(assessment),
      nextEntry: queueResult.nextEntry,
    }, 'Patient routed to Booking Room');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Dermatologist route to booking error:', err);
    return error(res, err.message || 'Failed to route patient', 500);
  }
};
