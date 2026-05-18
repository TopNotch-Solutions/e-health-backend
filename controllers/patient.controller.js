const { v4: uuidv4 } = require('uuid');
const { Patient, Visit, QueueEntry, sequelize } = require('../models');
const { generatePatientNumber, generateVisitNumber, generateEmergencyId } = require('../utils/idGenerator');
const { success, created, error, paginated } = require('../utils/response');
const { getIO } = require('../socket');
const queueService = require('../services/queueService');

// Register new patient (Known or Returning)
exports.register = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      first_name, last_name, sex, date_of_birth, id_number,
      phone, address, payment_type, emergency_contact_name,
      emergency_contact_phone, category,
    } = req.body;

    if (!first_name || !last_name || !sex) {
      return error(res, 'First name, last name, and sex are required', 400);
    }

    const patientCategory = category || 'known';
    const patient = await Patient.create({
      id: uuidv4(),
      patient_number: generatePatientNumber(),
      category: patientCategory,
      payment_type: payment_type || 'state',
      first_name,
      last_name,
      sex,
      date_of_birth: date_of_birth || null,
      id_number: id_number || null,
      phone: phone || null,
      address: address || null,
      emergency_contact_name: emergency_contact_name || null,
      emergency_contact_phone: emergency_contact_phone || null,
    }, { transaction: t });

    // Create a visit
    const visit = await Visit.create({
      id: uuidv4(),
      patient_id: patient.id,
      facility_id: req.user.facility_id,
      visit_number: generateVisitNumber(),
      visit_type: patientCategory === 'returning' ? 'follow_up' : 'new',
      status: 'in_progress',
      current_department: 'nurse',
      created_by: req.user.id,
    }, { transaction: t });

    // Push to nurse queue
    const queueEntry = await queueService.pushToQueue({
      visit_id: visit.id,
      department: 'nurse',
      priority: 'normal',
      pushed_by: req.user.id,
    }, t);

    await t.commit();

    // Emit WebSocket event to nurse room
    const io = getIO();
    io.to('room:nurse').emit('queue:new_patient', {
      queueEntry,
      patient: { id: patient.id, first_name, last_name, patient_number: patient.patient_number },
      visit: { id: visit.id, visit_number: visit.visit_number, visit_type: visit.visit_type },
    });

    return created(res, { patient, visit, queueEntry }, 'Patient registered and queued to nurse');
  } catch (err) {
    await t.rollback();
    console.error('Register patient error:', err);
    return error(res, 'Failed to register patient', 500);
  }
};

// Emergency one-click registration (Unknown patient)
exports.emergencyRegister = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { sex, notes, equipment_required } = req.body;

    const tempId = generateEmergencyId();
    const patient = await Patient.create({
      id: uuidv4(),
      patient_number: generatePatientNumber(),
      category: 'unknown',
      payment_type: 'state',
      is_emergency: true,
      temp_id: tempId,
      first_name: 'Unknown',
      last_name: tempId,
      sex: sex || 'other',
    }, { transaction: t });

    // Create emergency visit
    const visit = await Visit.create({
      id: uuidv4(),
      patient_id: patient.id,
      facility_id: req.user.facility_id,
      visit_number: generateVisitNumber(),
      visit_type: 'emergency',
      status: 'in_progress',
      current_department: 'doctor',
      created_by: req.user.id,
    }, { transaction: t });

    // Push directly to doctor queue with emergency priority (bypasses nurse)
    const queueEntry = await queueService.pushToQueue({
      visit_id: visit.id,
      department: 'doctor',
      priority: 'emergency',
      pushed_by: req.user.id,
      notes: notes || 'Emergency admission - unknown patient',
    }, t);

    await t.commit();

    // Emit emergency override to doctor room
    const io = getIO();
    io.to('room:doctor').emit('emergency:override', {
      queueEntry,
      patient: { id: patient.id, temp_id: tempId, patient_number: patient.patient_number },
      visit: { id: visit.id, visit_number: visit.visit_number },
    });

    return created(res, { patient, visit, queueEntry }, 'Emergency patient registered - pushed to doctor queue');
  } catch (err) {
    await t.rollback();
    console.error('Emergency register error:', err);
    return error(res, 'Failed to register emergency patient', 500);
  }
};

function isProfileComplete(patient) {
  const row = patient.toJSON ? patient.toJSON() : patient;
  return Boolean(
    row.first_name &&
      row.last_name &&
      row.sex &&
      row.date_of_birth &&
      row.id_number &&
      row.phone &&
      row.category !== 'unknown'
  );
}

// Front office: national ID OR (date of birth + name)
exports.search = async (req, res) => {
  try {
    const { Op } = require('sequelize');
    const idNumber = (req.query.id_number || '').trim();
    const dateOfBirth = (req.query.date_of_birth || '').trim();
    const name = (req.query.name || '').trim();

    if (!idNumber && !(dateOfBirth && name)) {
      return error(
        res,
        'Provide either id_number, or both date_of_birth and name',
        400
      );
    }

    let where;

    if (idNumber) {
      where = { id_number: { [Op.like]: `%${idNumber}%` } };
    } else {
      const parts = name.split(/\s+/).filter(Boolean);
      const conditions = [{ date_of_birth: dateOfBirth }];

      if (parts.length >= 2) {
        conditions.push(
          { first_name: { [Op.like]: `%${parts[0]}%` } },
          { last_name: { [Op.like]: `%${parts.slice(1).join(' ')}%` } }
        );
      } else {
        conditions.push({
          [Op.or]: [
            { first_name: { [Op.like]: `%${name}%` } },
            { last_name: { [Op.like]: `%${name}%` } },
          ],
        });
      }

      where = { [Op.and]: conditions };
    }

    const rows = await Patient.findAll({
      where,
      limit: 50,
      order: [
        ['last_name', 'ASC'],
        ['first_name', 'ASC'],
      ],
    });

    const patients = rows.map((p) => {
      const json = p.toJSON();
      return { ...json, profile_complete: isProfileComplete(p) };
    });

    return success(res, { patients, count: patients.length });
  } catch (err) {
    console.error('Patient search error:', err);
    return error(res, 'Failed to search patients', 500);
  }
};

// Search / list patients
exports.getAll = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, category, payment_type } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (category) where.category = category;
    if (payment_type) where.payment_type = payment_type;

    if (search) {
      const { Op } = require('sequelize');
      where[Op.or] = [
        { first_name: { [Op.like]: `%${search}%` } },
        { last_name: { [Op.like]: `%${search}%` } },
        { patient_number: { [Op.like]: `%${search}%` } },
        { id_number: { [Op.like]: `%${search}%` } },
        { phone: { [Op.like]: `%${search}%` } },
      ];
    }

    const { rows, count } = await Patient.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['created_at', 'DESC']],
    });

    return paginated(res, rows, count, page, limit);
  } catch (err) {
    console.error('Get patients error:', err);
    return error(res, 'Failed to fetch patients', 500);
  }
};

// Get single patient
exports.getById = async (req, res) => {
  try {
    const patient = await Patient.findByPk(req.params.id, {
      include: [{ association: 'visits', order: [['created_at', 'DESC']] }],
    });

    if (!patient) return error(res, 'Patient not found', 404);
    return success(res, patient);
  } catch (err) {
    return error(res, 'Failed to fetch patient', 500);
  }
};

// Get patient visit history
exports.getHistory = async (req, res) => {
  try {
    const visits = await Visit.findAll({
      where: { patient_id: req.params.id },
      include: [
        { association: 'vitals' },
        { association: 'consultations' },
        { association: 'prescriptions' },
        { association: 'labRequests' },
        { association: 'sonarRequests' },
        { association: 'admission' },
      ],
      order: [['created_at', 'DESC']],
    });

    return success(res, visits);
  } catch (err) {
    console.error('Get history error:', err);
    return error(res, 'Failed to fetch history', 500);
  }
};

// Update patient info
exports.update = async (req, res) => {
  try {
    const patient = await Patient.findByPk(req.params.id);
    if (!patient) return error(res, 'Patient not found', 404);

    const allowedFields = [
      'first_name', 'last_name', 'sex', 'date_of_birth', 'id_number',
      'phone', 'address', 'payment_type', 'emergency_contact_name',
      'emergency_contact_phone', 'category',
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    await patient.update(updates);
    return success(res, patient, 'Patient updated');
  } catch (err) {
    return error(res, 'Failed to update patient', 500);
  }
};

// Create a new visit for returning patient
exports.createVisit = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const patient = await Patient.findByPk(req.params.id);
    if (!patient) return error(res, 'Patient not found', 404);

    // Mark as returning
    await patient.update({ category: 'returning' }, { transaction: t });

    const visit = await Visit.create({
      id: uuidv4(),
      patient_id: patient.id,
      facility_id: req.user.facility_id,
      visit_number: generateVisitNumber(),
      visit_type: 'follow_up',
      status: 'in_progress',
      current_department: 'nurse',
      created_by: req.user.id,
    }, { transaction: t });

    const { mode_of_arrival, accompanied_by } = req.body || {};
    const intakeNotes = [
      mode_of_arrival && `Mode of arrival: ${mode_of_arrival}`,
      accompanied_by && `Accompanied by: ${accompanied_by}`,
    ]
      .filter(Boolean)
      .join('; ');

    const queueEntry = await queueService.pushToQueue({
      visit_id: visit.id,
      department: 'nurse',
      priority: 'normal',
      pushed_by: req.user.id,
      notes: intakeNotes || null,
    }, t);

    await t.commit();

    const io = getIO();
    io.to('room:nurse').emit('queue:new_patient', {
      queueEntry,
      patient: { id: patient.id, first_name: patient.first_name, last_name: patient.last_name, patient_number: patient.patient_number },
      visit: { id: visit.id, visit_number: visit.visit_number, visit_type: 'follow_up' },
    });

    return created(res, { visit, queueEntry }, 'Visit created - patient queued to nurse');
  } catch (err) {
    await t.rollback();
    return error(res, 'Failed to create visit', 500);
  }
};
