const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const {
  Vital,
  Visit,
  Patient,
  QueueEntry,
  ScreeningAssessment,
  PapSmearScreening,
  PediatricAssessment,
  sequelize,
} = require('../models');
const { success, created, error } = require('../utils/response');
const queueService = require('../services/queueService');
const { getIO } = require('../socket');
const { emitNurseActivity } = require('../services/notificationService');
const {
  PARAMETER_NURSE_DEPARTMENT,
  isValidClassification,
  isValidDestination,
  validateVitalsForClassification,
} = require('../config/parameterNurseRouting');
const {
  SCREENING_NURSE_DEPARTMENT,
  isValidDestination: isValidScreeningDestination,
  validateAssessmentFields,
  routingLabel: screeningRoutingLabel,
} = require('../config/screeningNurseRouting');

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

// Record vitals for a visit
exports.create = async (req, res) => {
  try {
    const { visit_id } = req.body;

    if (!visit_id) return error(res, 'visit_id is required', 400);

    const visit = await Visit.findByPk(visit_id);
    if (!visit) return error(res, 'Visit not found', 404);

    const vital = await Vital.create({
      id: uuidv4(),
      visit_id,
      recorded_by: req.user.id,
      ...pickVitalAttributes(req.body),
    });

    emitNurseActivity({ visitId: visit_id, vitalId: vital.id, recordedBy: req.user.id, action: 'vitals_recorded' });

    return created(res, vital, 'Vitals recorded');
  } catch (err) {
    console.error('Create vitals error:', err);
    return error(res, 'Failed to record vitals', 500);
  }
};

// Record vitals AND push patient to doctor queue in one action
exports.createAndPush = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, queue_entry_id } = req.body;

    if (!visit_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id is required', 400);
    }
    if (!queue_entry_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'queue_entry_id is required', 400);
    }

    const visit = await Visit.findByPk(visit_id, {
      include: [{
        association: 'patient',
        attributes: ['id', 'first_name', 'last_name', 'patient_number', 'is_emergency'],
      }],
      transaction: t,
    });
    if (!visit) {
      if (!t.finished) await t.rollback();
      return error(res, 'Visit not found', 404);
    }

    const nurseEntry = await QueueEntry.findByPk(queue_entry_id, { transaction: t });
    if (!nurseEntry || nurseEntry.visit_id !== visit_id || nurseEntry.department !== 'nurse') {
      if (!t.finished) await t.rollback();
      return error(res, 'Invalid nurse queue entry for this visit', 400);
    }

    const vital = await Vital.create({
      id: uuidv4(),
      visit_id,
      recorded_by: req.user.id,
      ...pickVitalAttributes(req.body),
    }, { transaction: t });

    const result = await queueService.completeEntry(queue_entry_id, {
      nextDepartment: 'doctor',
      nextPriority:
        visit.visit_type === 'emergency' || visit.patient?.is_emergency
          ? 'emergency'
          : 'normal',
      pushed_by: req.user.id,
    }, t);

    await t.commit();

    try {
      const io = getIO();
      const nurseEntries = await queueService.getQueue('nurse', req.user.facility_id);
      io.to('room:nurse').emit('queue:refresh', { department: 'nurse', entries: nurseEntries });
      io.to('room:nurse').emit('queue:patient_moved', {
        entryId: queue_entry_id,
        status: 'completed',
        department: 'nurse',
      });

      if (result.nextEntry) {
        io.to('room:doctor').emit('queue:new_patient', {
          queueEntry: result.nextEntry,
          patient: visit.patient,
          visit: { id: visit.id, visit_number: visit.visit_number, visit_type: visit.visit_type },
        });
        const doctorEntries = await queueService.getQueue('doctor', req.user.facility_id);
        io.to('room:doctor').emit('queue:refresh', { department: 'doctor', entries: doctorEntries });
      }

      emitNurseActivity({ visitId: visit_id, vitalId: vital.id, recordedBy: req.user.id, action: 'push_to_doctor' });
    } catch (emitErr) {
      console.error('Nurse push socket emit error:', emitErr.message);
    }

    return created(res, { vital, nextEntry: result.nextEntry }, 'Vitals recorded and patient pushed to doctor');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Create and push error:', err);
    const message = err.message || 'Failed to record vitals and push to doctor';
    const status = message.includes('already in the') ? 409 : 500;
    return error(res, message, status);
  }
};

async function emitQueueRefresh(io, department, facilityId) {
  const entries = await queueService.getQueue(department, facilityId);
  io.to(`room:${department}`).emit('queue:refresh', { department, entries });
}

// Parameter nurse: vitals + route to clinic destination based on visit classification
exports.parameterNursePush = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      visit_id,
      queue_entry_id,
      visit_classification,
      next_department,
    } = req.body;

    if (!visit_id || !queue_entry_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }
    if (!isValidClassification(visit_classification)) {
      if (!t.finished) await t.rollback();
      return error(res, 'Visit classification must be follow_up or sick', 400);
    }
    if (!next_department || !isValidDestination(visit_classification, next_department)) {
      if (!t.finished) await t.rollback();
      return error(res, 'Invalid routing destination for this visit classification', 400);
    }

    const vitalAttrs = pickVitalAttributes(req.body);
    vitalAttrs.visit_classification = visit_classification;

    const vitalError = validateVitalsForClassification(visit_classification, vitalAttrs);
    if (vitalError) {
      if (!t.finished) await t.rollback();
      return error(res, vitalError, 400);
    }

    const visit = await Visit.findByPk(visit_id, {
      include: [{
        association: 'patient',
        attributes: ['id', 'first_name', 'last_name', 'patient_number', 'is_emergency', 'temp_id'],
      }],
      transaction: t,
    });
    if (!visit) {
      if (!t.finished) await t.rollback();
      return error(res, 'Visit not found', 404);
    }

    const queueEntry = await QueueEntry.findByPk(queue_entry_id, { transaction: t });
    if (!queueEntry || queueEntry.visit_id !== visit_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'Invalid queue entry for this visit', 400);
    }
    if (queueEntry.department !== PARAMETER_NURSE_DEPARTMENT) {
      if (!t.finished) await t.rollback();
      return error(res, 'Queue entry is not for the parameter nurse department', 400);
    }
    if (queueEntry.status !== 'in_progress') {
      if (!t.finished) await t.rollback();
      return error(res, 'Patient must be started before submitting vitals', 400);
    }
    if (queueEntry.assigned_to !== req.user.id) {
      if (!t.finished) await t.rollback();
      return error(res, 'You can only process patients assigned to you', 403);
    }

    const vital = await Vital.create({
      id: uuidv4(),
      visit_id,
      recorded_by: req.user.id,
      ...vitalAttrs,
    }, { transaction: t });

    const nextPriority =
      visit.visit_type === 'emergency'
      || visit.patient?.is_emergency
      || next_department === 'emergency_unit'
        ? 'emergency'
        : 'normal';

    const result = await queueService.completeEntry(queue_entry_id, {
      nextDepartment: next_department,
      nextPriority,
      notes: `Parameter nurse: ${visit_classification} → ${next_department}`,
      pushed_by: req.user.id,
    }, t);

    await t.commit();

    try {
      const io = getIO();
      await emitQueueRefresh(io, PARAMETER_NURSE_DEPARTMENT, req.user.facility_id);
      io.to(`room:${PARAMETER_NURSE_DEPARTMENT}`).emit('queue:patient_moved', {
        entryId: queue_entry_id,
        status: 'completed',
        department: PARAMETER_NURSE_DEPARTMENT,
      });

      if (result.nextEntry) {
        io.to(`room:${next_department}`).emit('queue:new_patient', {
          queueEntry: result.nextEntry,
          patient: visit.patient,
          visit: { id: visit.id, visit_number: visit.visit_number, visit_type: visit.visit_type },
        });
        await emitQueueRefresh(io, next_department, req.user.facility_id);
      }

      emitNurseActivity({
        visitId: visit_id,
        vitalId: vital.id,
        recordedBy: req.user.id,
        action: 'parameter_nurse_push',
      });
    } catch (emitErr) {
      console.error('Parameter nurse push socket emit error:', emitErr.message);
    }

    return created(res, { vital, nextEntry: result.nextEntry }, 'Vitals recorded and patient routed');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Parameter nurse push error:', err);
    const message = err.message || 'Failed to record vitals and route patient';
    const status = message.includes('already in the') ? 409 : 500;
    return error(res, message, status);
  }
};

// Screening nurse: clinical assessment + route to doctor / HIV testing / emergency
exports.screeningNursePush = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      visit_id,
      queue_entry_id,
      next_department,
      symptoms,
      reason,
      diagnosis,
      notes,
    } = req.body;

    if (!visit_id || !queue_entry_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }
    if (!next_department || !isValidScreeningDestination(next_department)) {
      if (!t.finished) await t.rollback();
      return error(res, 'Invalid routing destination', 400);
    }

    const fieldError = validateAssessmentFields({ symptoms, reason, diagnosis });
    if (fieldError) {
      if (!t.finished) await t.rollback();
      return error(res, fieldError, 400);
    }

    const visit = await Visit.findByPk(visit_id, {
      include: [{
        association: 'patient',
        attributes: ['id', 'first_name', 'last_name', 'patient_number', 'is_emergency', 'temp_id'],
      }],
      transaction: t,
    });
    if (!visit) {
      if (!t.finished) await t.rollback();
      return error(res, 'Visit not found', 404);
    }

    const queueEntry = await QueueEntry.findByPk(queue_entry_id, { transaction: t });
    if (!queueEntry || queueEntry.visit_id !== visit_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'Invalid queue entry for this visit', 400);
    }
    if (queueEntry.department !== SCREENING_NURSE_DEPARTMENT) {
      if (!t.finished) await t.rollback();
      return error(res, 'Queue entry is not for the screening nurse department', 400);
    }
    if (queueEntry.status !== 'in_progress') {
      if (!t.finished) await t.rollback();
      return error(res, 'Patient must be started before submitting assessment', 400);
    }
    if (queueEntry.assigned_to !== req.user.id) {
      if (!t.finished) await t.rollback();
      return error(res, 'You can only process patients assigned to you', 403);
    }

    const assessment = await ScreeningAssessment.create({
      id: uuidv4(),
      visit_id,
      recorded_by: req.user.id,
      symptoms: symptoms.trim(),
      reason: reason.trim(),
      diagnosis: diagnosis.trim(),
      notes: notes?.trim() || null,
    }, { transaction: t });

    const nextPriority =
      visit.visit_type === 'emergency'
      || visit.patient?.is_emergency
      || next_department === 'emergency_unit'
        ? 'emergency'
        : 'normal';

    const result = await queueService.completeEntry(queue_entry_id, {
      nextDepartment: next_department,
      nextPriority,
      notes: `Screening nurse → ${screeningRoutingLabel(next_department)}`,
      pushed_by: req.user.id,
    }, t);

    await t.commit();

    try {
      const io = getIO();
      await emitQueueRefresh(io, SCREENING_NURSE_DEPARTMENT, req.user.facility_id);
      io.to(`room:${SCREENING_NURSE_DEPARTMENT}`).emit('queue:patient_moved', {
        entryId: queue_entry_id,
        status: 'completed',
        department: SCREENING_NURSE_DEPARTMENT,
      });

      if (result.nextEntry) {
        io.to(`room:${next_department}`).emit('queue:new_patient', {
          queueEntry: result.nextEntry,
          patient: visit.patient,
          visit: { id: visit.id, visit_number: visit.visit_number, visit_type: visit.visit_type },
        });
        await emitQueueRefresh(io, next_department, req.user.facility_id);
      }

      emitNurseActivity({
        visitId: visit_id,
        recordedBy: req.user.id,
        action: 'screening_nurse_push',
      });
    } catch (emitErr) {
      console.error('Screening nurse push socket emit error:', emitErr.message);
    }

    return created(res, { assessment, nextEntry: result.nextEntry }, 'Assessment recorded and patient routed');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Screening nurse push error:', err);
    const message = err.message || 'Failed to submit assessment and route patient';
    const status = message.includes('already in the') ? 409 : 500;
    return error(res, message, status);
  }
};

// Get vitals for a visit
exports.getByVisit = async (req, res) => {
  try {
    const vital = await Vital.findOne({
      where: { visit_id: req.params.visitId },
      include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
    });

    if (!vital) return error(res, 'Vitals not found', 404);
    return success(res, vital);
  } catch (err) {
    return error(res, 'Failed to fetch vitals', 500);
  }
};

// Vitals for screening handover (404-safe wrapper used by screening module)
exports.getHandoverVitals = async (req, res) => {
  try {
    const vital = await Vital.findOne({
      where: { visit_id: req.params.visitId },
      include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
    });
    return success(res, vital || null);
  } catch (err) {
    return error(res, 'Failed to fetch handover vitals', 500);
  }
};

function serializePediatricForTimeline(assessment) {
  if (!assessment) return null;
  const plain = assessment.toJSON ? assessment.toJSON() : assessment;
  if (!plain.assessment_saved) return null;
  return {
    temperature: plain.temperature != null ? Number(plain.temperature) : null,
    weight: plain.weight != null ? Number(plain.weight) : null,
    general_assessment: plain.general_assessment,
    assessment_saved_at: plain.assessment_saved_at,
    routed_to_master_doctor_at: plain.routed_to_master_doctor_at,
    assessedBy: plain.assessedBy || null,
  };
}

function serializePapSmearForTimeline(screening) {
  if (!screening) return null;
  const plain = screening.toJSON ? screening.toJSON() : screening;
  if (!plain.findings_saved) return null;
  return {
    screening_details: plain.screening_details,
    test_observations: plain.test_observations,
    clinical_findings: plain.clinical_findings,
    severity: plain.severity,
    findings_saved_at: plain.findings_saved_at,
    escalated_to_master_doctor_at: plain.escalated_to_master_doctor_at,
    screenedBy: plain.screenedBy || null,
  };
}

async function findLatestMedicalHistoryVitals(patientId, excludeVisitId = null) {
  const visitWhere = { patient_id: patientId };
  if (excludeVisitId) {
    visitWhere.id = { [Op.ne]: excludeVisitId };
  }

  const rows = await Vital.findAll({
    where: {
      [Op.or]: [
        { current_medications: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] } },
        { social_history: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] } },
        { immunization_status: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] } },
        { chief_complaint: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] } },
        { physical_examination: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] } },
      ],
    },
    include: [
      {
        association: 'visit',
        where: visitWhere,
        required: true,
        attributes: ['id', 'visit_number', 'created_at'],
      },
    ],
    order: [['recorded_at', 'DESC']],
    limit: 1,
  });

  const vital = rows[0] || null;
  if (!vital) return null;

  return {
    vitals: vital,
    visit_number: vital.visit?.visit_number || null,
    recorded_at: vital.recorded_at || vital.visit?.created_at || null,
  };
}

// Clinical timeline for clinic doctor (parameter + optional screening + pap smear handover)
exports.getClinicalTimeline = async (req, res) => {
  try {
    const visitId = req.params.visitId;
    const visit = await Visit.findByPk(visitId, { attributes: ['id', 'patient_id'] });
    if (!visit) return error(res, 'Visit not found', 404);

    const [vital, screeningAssessment, papSmearScreening, pediatricAssessment, medicalHistory] = await Promise.all([
      Vital.findOne({
        where: { visit_id: visitId },
        include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
      }),
      ScreeningAssessment.findOne({
        where: { visit_id: visitId },
        include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
      }),
      PapSmearScreening.findOne({
        where: { visit_id: visitId },
        include: [{ association: 'screenedBy', attributes: ['id', 'first_name', 'last_name'] }],
        order: [['updated_at', 'DESC']],
      }),
      PediatricAssessment.findOne({
        where: { visit_id: visitId },
        include: [{ association: 'assessedBy', attributes: ['id', 'first_name', 'last_name'] }],
      }),
      findLatestMedicalHistoryVitals(visit.patient_id, visitId),
    ]);

    let pathType = null;
    if (vital?.visit_classification === 'follow_up') {
      pathType = 'follow_up';
    } else if (vital?.visit_classification === 'sick' || screeningAssessment) {
      pathType = 'sick';
    }

    return success(res, {
      vitals: vital || null,
      screeningAssessment: screeningAssessment || null,
      papSmearScreening: serializePapSmearForTimeline(papSmearScreening),
      pediatricAssessment: serializePediatricForTimeline(pediatricAssessment),
      pathType,
      medicalHistory: medicalHistory || null,
    });
  } catch (err) {
    return error(res, 'Failed to fetch clinical timeline', 500);
  }
};

// Update vitals
exports.update = async (req, res) => {
  try {
    const vital = await Vital.findByPk(req.params.id);
    if (!vital) return error(res, 'Vitals not found', 404);

    const updates = pickVitalAttributes(req.body);

    await vital.update(updates);
    return success(res, vital, 'Vitals updated');
  } catch (err) {
    return error(res, 'Failed to update vitals', 500);
  }
};
