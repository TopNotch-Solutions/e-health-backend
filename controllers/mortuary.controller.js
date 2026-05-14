const { v4: uuidv4 } = require('uuid');
const { MortuaryRecord, Patient, Visit, Admission, Bed } = require('../models');
const { Op } = require('sequelize');
const { success, created, error } = require('../utils/response');

// Get all mortuary records
exports.getAll = async (req, res) => {
  try {
    const { status } = req.query;
    const where = {};
    if (status) where.body_status = status;

    const records = await MortuaryRecord.findAll({
      where,
      include: [
        { association: 'patient', attributes: ['id', 'first_name', 'last_name', 'patient_number', 'sex'] },
        { association: 'declaredBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
      order: [['date_of_death', 'DESC']],
    });

    return success(res, records);
  } catch (err) {
    return error(res, 'Failed to fetch mortuary records', 500);
  }
};

// Get single record
exports.getById = async (req, res) => {
  try {
    const record = await MortuaryRecord.findByPk(req.params.id, {
      include: [
        { association: 'patient' },
        { association: 'visit' },
        { association: 'declaredBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
    });
    if (!record) return error(res, 'Record not found', 404);
    return success(res, record);
  } catch (err) {
    return error(res, 'Failed to fetch record', 500);
  }
};

// Register deceased patient
exports.register = async (req, res) => {
  try {
    const { patient_id, visit_id, cause_of_death, date_of_death, notes } = req.body;
    if (!patient_id || !date_of_death) {
      return error(res, 'patient_id and date_of_death are required', 400);
    }

    const record = await MortuaryRecord.create({
      id: uuidv4(),
      patient_id,
      visit_id: visit_id || null,
      cause_of_death: cause_of_death || null,
      date_of_death,
      declared_by: req.user.id,
      notes: notes || null,
    });

    // Update visit status if provided
    if (visit_id) {
      await Visit.update({ status: 'deceased', completed_at: new Date() }, { where: { id: visit_id } });

      // Free bed if admitted
      const admission = await Admission.findOne({
        where: { visit_id, status: 'admitted' },
        include: [{ association: 'bed' }],
      });
      if (admission) {
        await admission.update({ status: 'deceased', discharged_at: new Date() });
        if (admission.bed) await admission.bed.update({ status: 'available' });
      }
    }

    return created(res, record, 'Deceased registered');
  } catch (err) {
    console.error('Register deceased error:', err);
    return error(res, 'Failed to register deceased', 500);
  }
};

// Release body
exports.release = async (req, res) => {
  try {
    const record = await MortuaryRecord.findByPk(req.params.id);
    if (!record) return error(res, 'Record not found', 404);

    const { released_to, undertaker_name, undertaker_contact } = req.body;
    if (!released_to) return error(res, 'released_to is required', 400);

    await record.update({
      body_status: 'released',
      released_to,
      released_at: new Date(),
      undertaker_name: undertaker_name || null,
      undertaker_contact: undertaker_contact || null,
    });

    return success(res, record, 'Body released');
  } catch (err) {
    return error(res, 'Failed to release body', 500);
  }
};
