const { v4: uuidv4 } = require('uuid');
const { Vital, Visit, Patient, QueueEntry } = require('../models');
const { success, created, error } = require('../utils/response');
const queueService = require('../services/queueService');
const { getIO } = require('../socket');

// Record vitals for a visit
exports.create = async (req, res) => {
  try {
    const {
      visit_id, temperature, blood_pressure_systolic, blood_pressure_diastolic,
      pulse_rate, respiratory_rate, weight, height, oxygen_saturation,
      allergies, accompanied_by, chief_complaint, notes,
    } = req.body;

    if (!visit_id) return error(res, 'visit_id is required', 400);

    const visit = await Visit.findByPk(visit_id);
    if (!visit) return error(res, 'Visit not found', 404);

    const vital = await Vital.create({
      id: uuidv4(),
      visit_id,
      recorded_by: req.user.id,
      temperature: temperature || null,
      blood_pressure_systolic: blood_pressure_systolic || null,
      blood_pressure_diastolic: blood_pressure_diastolic || null,
      pulse_rate: pulse_rate || null,
      respiratory_rate: respiratory_rate || null,
      weight: weight || null,
      height: height || null,
      oxygen_saturation: oxygen_saturation || null,
      allergies: allergies || null,
      accompanied_by: accompanied_by || null,
      chief_complaint: chief_complaint || null,
      notes: notes || null,
    });

    return created(res, vital, 'Vitals recorded');
  } catch (err) {
    console.error('Create vitals error:', err);
    return error(res, 'Failed to record vitals', 500);
  }
};

// Record vitals AND push patient to doctor queue in one action
exports.createAndPush = async (req, res) => {
  try {
    const {
      visit_id, queue_entry_id, temperature, blood_pressure_systolic,
      blood_pressure_diastolic, pulse_rate, respiratory_rate, weight,
      height, oxygen_saturation, allergies, accompanied_by, chief_complaint, notes,
    } = req.body;

    if (!visit_id) return error(res, 'visit_id is required', 400);

    const visit = await Visit.findByPk(visit_id, {
      include: [{ association: 'patient', attributes: ['id', 'first_name', 'last_name', 'patient_number'] }],
    });
    if (!visit) return error(res, 'Visit not found', 404);

    // Record vitals
    const vital = await Vital.create({
      id: uuidv4(),
      visit_id,
      recorded_by: req.user.id,
      temperature: temperature || null,
      blood_pressure_systolic: blood_pressure_systolic || null,
      blood_pressure_diastolic: blood_pressure_diastolic || null,
      pulse_rate: pulse_rate || null,
      respiratory_rate: respiratory_rate || null,
      weight: weight || null,
      height: height || null,
      oxygen_saturation: oxygen_saturation || null,
      allergies: allergies || null,
      accompanied_by: accompanied_by || null,
      chief_complaint: chief_complaint || null,
      notes: notes || null,
    });

    // Complete nurse queue entry and push to doctor
    let nextEntry = null;
    if (queue_entry_id) {
      const result = await queueService.completeEntry(queue_entry_id, {
        nextDepartment: 'doctor',
        nextPriority: visit.visit_type === 'emergency' ? 'emergency' : 'normal',
        pushed_by: req.user.id,
      });
      nextEntry = result.nextEntry;

      // Emit to doctor room
      const io = getIO();
      io.to('room:doctor').emit('queue:new_patient', {
        queueEntry: nextEntry,
        patient: visit.patient,
        visit: { id: visit.id, visit_number: visit.visit_number, visit_type: visit.visit_type },
      });
      io.to('room:nurse').emit('queue:patient_moved', {
        entryId: queue_entry_id,
        status: 'completed',
      });
    }

    return created(res, { vital, nextEntry }, 'Vitals recorded and patient pushed to doctor');
  } catch (err) {
    console.error('Create and push error:', err);
    return error(res, 'Failed to record vitals', 500);
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

    const allowedFields = [
      'temperature', 'blood_pressure_systolic', 'blood_pressure_diastolic',
      'pulse_rate', 'respiratory_rate', 'weight', 'height', 'oxygen_saturation',
      'allergies', 'accompanied_by', 'chief_complaint', 'notes',
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    await vital.update(updates);
    return success(res, vital, 'Vitals updated');
  } catch (err) {
    return error(res, 'Failed to update vitals', 500);
  }
};
