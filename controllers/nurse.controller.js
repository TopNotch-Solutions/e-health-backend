const { v4: uuidv4 } = require('uuid');
const { Vital, Visit, Patient, QueueEntry, sequelize } = require('../models');
const { success, created, error } = require('../utils/response');
const queueService = require('../services/queueService');
const { getIO } = require('../socket');

const VITAL_FIELDS = [
  'temperature', 'blood_pressure_systolic', 'blood_pressure_diastolic',
  'pulse_rate', 'respiratory_rate', 'weight', 'height', 'oxygen_saturation',
  'allergies', 'accompanied_by', 'chief_complaint', 'onset_at',
  'aggravating_factors', 'alleviating_factors', 'current_medications',
  'immunization_status', 'social_history', 'physical_examination', 'notes',
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
      await t.rollback();
      return error(res, 'visit_id is required', 400);
    }
    if (!queue_entry_id) {
      await t.rollback();
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
      await t.rollback();
      return error(res, 'Visit not found', 404);
    }

    const nurseEntry = await QueueEntry.findByPk(queue_entry_id, { transaction: t });
    if (!nurseEntry || nurseEntry.visit_id !== visit_id || nurseEntry.department !== 'nurse') {
      await t.rollback();
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

    const io = getIO();
    try {
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
    } catch (emitErr) {
      console.error('Nurse push socket emit error:', emitErr.message);
    }

    return created(res, { vital, nextEntry: result.nextEntry }, 'Vitals recorded and patient pushed to doctor');
  } catch (err) {
    await t.rollback();
    console.error('Create and push error:', err);
    const message = err.message || 'Failed to record vitals and push to doctor';
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
