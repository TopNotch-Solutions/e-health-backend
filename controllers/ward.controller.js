const { v4: uuidv4 } = require('uuid');
const { Ward, Bed, Admission, Visit, Patient, User, sequelize } = require('../models');
const { Op } = require('sequelize');
const { success, created, error } = require('../utils/response');
const notificationService = require('../services/notificationService');

// Get all wards with bed summary
exports.getAll = async (req, res) => {
  try {
    const wards = await Ward.findAll({
      where: { facility_id: req.user.facility_id },
      include: [
        { association: 'supervisor', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'beds', attributes: ['id', 'bed_number', 'status', 'condition_note'] },
      ],
      order: [['ward_number', 'ASC']],
    });

    // Add summary stats per ward
    const result = wards.map(ward => {
      const beds = ward.beds || [];
      return {
        ...ward.toJSON(),
        stats: {
          total: beds.length,
          available: beds.filter(b => b.status === 'available').length,
          occupied: beds.filter(b => b.status === 'occupied').length,
          out_of_service: beds.filter(b => b.status === 'out_of_service').length,
        },
      };
    });

    return success(res, result);
  } catch (err) {
    console.error('Get wards error:', err);
    return error(res, 'Failed to fetch wards', 500);
  }
};

// Get ward supervisor dashboard
exports.getDashboard = async (req, res) => {
  try {
    const { id } = req.params;
    const ward = await Ward.findByPk(id, {
      include: [
        { association: 'supervisor', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'beds' },
      ],
    });

    if (!ward) return error(res, 'Ward not found', 404);

    // Get current admissions for this ward
    const admissions = await Admission.findAll({
      where: { status: 'admitted' },
      include: [
        {
          model: Bed,
          as: 'bed',
          where: { ward_id: id },
          attributes: ['id', 'bed_number'],
        },
        {
          association: 'visit',
          include: [{ model: Patient, as: 'patient', attributes: ['id', 'first_name', 'last_name', 'patient_number', 'sex'] }],
        },
      ],
    });

    const beds = ward.beds || [];
    const dashboard = {
      ward: {
        id: ward.id,
        name: ward.name,
        ward_number: ward.ward_number,
        ward_type: ward.ward_type,
        supervisor: ward.supervisor,
      },
      stats: {
        total_beds: beds.length,
        available: beds.filter(b => b.status === 'available').length,
        occupied: beds.filter(b => b.status === 'occupied').length,
        out_of_service: beds.filter(b => b.status === 'out_of_service').length,
      },
      beds: beds.map(bed => {
        const admission = admissions.find(a => a.bed.id === bed.id);
        return {
          ...bed.toJSON(),
          patient: admission ? admission.visit.patient : null,
          admitted_at: admission ? admission.admitted_at : null,
        };
      }),
      current_admissions: admissions,
    };

    return success(res, dashboard);
  } catch (err) {
    console.error('Get dashboard error:', err);
    return error(res, 'Failed to fetch dashboard', 500);
  }
};

// Create ward
exports.createWard = async (req, res) => {
  try {
    const { name, ward_number, ward_type, supervisor_id } = req.body;
    if (!name || !ward_number || !ward_type) {
      return error(res, 'name, ward_number, and ward_type are required', 400);
    }

    const ward = await Ward.create({
      id: uuidv4(),
      facility_id: req.user.facility_id,
      name,
      ward_number,
      ward_type,
      supervisor_id: supervisor_id || null,
    });

    return created(res, ward, 'Ward created');
  } catch (err) {
    return error(res, 'Failed to create ward', 500);
  }
};

// Update ward
exports.updateWard = async (req, res) => {
  try {
    const ward = await Ward.findByPk(req.params.id);
    if (!ward) return error(res, 'Ward not found', 404);

    const allowed = ['name', 'ward_number', 'ward_type', 'supervisor_id'];
    const updates = {};
    for (const f of allowed) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }

    await ward.update(updates);
    return success(res, ward, 'Ward updated');
  } catch (err) {
    return error(res, 'Failed to update ward', 500);
  }
};

// Add bed to ward
exports.addBed = async (req, res) => {
  try {
    const { ward_id, bed_number, condition_note } = req.body;
    if (!ward_id || !bed_number) return error(res, 'ward_id and bed_number are required', 400);

    const ward = await Ward.findByPk(ward_id);
    if (!ward) return error(res, 'Ward not found', 404);

    const bed = await Bed.create({
      id: uuidv4(),
      ward_id,
      bed_number,
      status: 'available',
      condition_note: condition_note || null,
    });

    // Update total bed count
    await ward.update({ total_beds: ward.total_beds + 1 });

    return created(res, bed, 'Bed added');
  } catch (err) {
    return error(res, 'Failed to add bed', 500);
  }
};

// Update bed status/condition
exports.updateBed = async (req, res) => {
  try {
    const bed = await Bed.findByPk(req.params.id, {
      include: [{ model: Ward, as: 'ward' }],
    });
    if (!bed) return error(res, 'Bed not found', 404);

    const { status, condition_note } = req.body;
    const updates = {};
    if (status) updates.status = status;
    if (condition_note !== undefined) updates.condition_note = condition_note;

    await bed.update(updates);

    // Notify ward dashboard
    notificationService.emitWardUpdate({
      type: 'bed_status_change',
      bed_id: bed.id,
      ward_id: bed.ward_id,
      new_status: status || bed.status,
    });

    return success(res, bed, 'Bed updated');
  } catch (err) {
    return error(res, 'Failed to update bed', 500);
  }
};

// Get available beds (for doctor when admitting)
exports.getAvailableBeds = async (req, res) => {
  try {
    const beds = await Bed.findAll({
      where: { status: 'available' },
      include: [{
        model: Ward,
        as: 'ward',
        where: { facility_id: req.user.facility_id },
        attributes: ['id', 'name', 'ward_number', 'ward_type'],
      }],
      order: [[{ model: Ward, as: 'ward' }, 'name', 'ASC'], ['bed_number', 'ASC']],
    });

    return success(res, beds);
  } catch (err) {
    return error(res, 'Failed to fetch available beds', 500);
  }
};

// Update admission (ward staff updates admitted/discharged dates)
exports.updateAdmission = async (req, res) => {
  try {
    const admission = await Admission.findByPk(req.params.id, {
      include: [{ model: Bed, as: 'bed' }],
    });
    if (!admission) return error(res, 'Admission not found', 404);

    const { status, discharge_notes } = req.body;

    if (status === 'discharged') {
      await admission.update({
        status: 'discharged',
        discharged_at: new Date(),
        discharged_by: req.user.id,
        discharge_notes: discharge_notes || null,
      });

      // Free bed
      await admission.bed.update({ status: 'available' });

      notificationService.emitWardUpdate({
        type: 'discharge',
        bed_id: admission.bed_id,
        ward_id: admission.bed.ward_id,
      });
    } else if (status) {
      await admission.update({ status });
    }

    return success(res, admission, 'Admission updated');
  } catch (err) {
    return error(res, 'Failed to update admission', 500);
  }
};

// Get all current admissions for the facility
exports.getAdmissions = async (req, res) => {
  try {
    const { status = 'admitted' } = req.query;
    const admissions = await Admission.findAll({
      where: { status },
      include: [
        {
          model: Bed, as: 'bed',
          include: [{ model: Ward, as: 'ward', where: { facility_id: req.user.facility_id } }],
        },
        {
          association: 'visit',
          include: [{ model: Patient, as: 'patient', attributes: ['id', 'first_name', 'last_name', 'patient_number'] }],
        },
      ],
      order: [['admitted_at', 'DESC']],
    });

    return success(res, admissions);
  } catch (err) {
    return error(res, 'Failed to fetch admissions', 500);
  }
};
