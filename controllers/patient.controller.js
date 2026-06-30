const { v4: uuidv4 } = require('uuid');
const CLINIC_FRONT_OFFICE_ROLES = ['front_office', 'booking_room'];

function isClinicFrontOffice(role) {
  return CLINIC_FRONT_OFFICE_ROLES.includes(role);
}
const { Patient, Visit, Facility, sequelize } = require('../models');
const { generatePatientNumber, generateVisitNumber, generateEmergencyId } = require('../utils/idGenerator');
const { success, created, error, paginated } = require('../utils/response');
const { getIO } = require('../socket');
const queueService = require('../services/queueService');
const visitService = require('../services/visitService');
const patientMedicalHistoryService = require('../services/patientMedicalHistoryService');
const { emitFrontOfficeRegistration } = require('../services/notificationService');
const billingChargeService = require('../services/billingChargeService');
const { assertCanEditPatientToday } = require('../services/frontOfficeService');
const {
  assertUniquePatientIdentifiers,
  validateNationalIdForRegistration,
  validatePhoneForRegistration,
  findByNationalId,
} = require('../services/patientDuplicateService');
const {
  resolveFrontOfficeRouting,
  buildIntakeNotes,
  emitQueueEvents,
  EMERGENCY_UNIT_DEPARTMENT,
} = require('../utils/patientRouting');

// Register new patient (Known or Returning)
exports.register = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      first_name, last_name, sex, date_of_birth, id_number,
      phone, address, payment_type, emergency_contact_name,
      emergency_contact_phone, category, is_emergency, immediate_triage,
      routing_destination, mode_of_arrival, accompanied_by,
    } = req.body;

    if (!first_name || !last_name || !sex) {
      if (!t.finished) await t.rollback();
      return error(res, 'First name, last name, and sex are required', 400);
    }

    const routing = resolveFrontOfficeRouting({
      is_emergency,
      immediate_triage,
      routing_destination,
      mode_of_arrival,
      accompanied_by,
      sex,
      date_of_birth,
    }, { facility: await Facility.findByPk(req.user.facility_id, { transaction: t }) });

    const isEmergency = routing.isEmergency;
    let patientCategory = category || 'known';
    if (routing.immediateTriage) {
      patientCategory = 'unknown';
    }

    const tempId = routing.immediateTriage ? generateEmergencyId() : null;

    let normalizedIdNumber = null;
    let normalizedPhone = null;
    if (!routing.immediateTriage) {
      normalizedIdNumber = validateNationalIdForRegistration(id_number);
      normalizedPhone = validatePhoneForRegistration(phone);
      await assertUniquePatientIdentifiers(
        { id_number: normalizedIdNumber, phone: normalizedPhone },
        t
      );
    }

    const patient = await Patient.create({
      id: uuidv4(),
      patient_number: generatePatientNumber(),
      category: patientCategory,
      payment_type: payment_type || 'state',
      is_emergency: isEmergency,
      first_name: routing.immediateTriage ? 'Unknown' : first_name,
      last_name: routing.immediateTriage ? tempId : last_name,
      sex,
      date_of_birth: routing.immediateTriage ? null : (date_of_birth || null),
      id_number: routing.immediateTriage ? null : normalizedIdNumber,
      phone: routing.immediateTriage ? null : normalizedPhone,
      address: routing.immediateTriage ? null : (address || null),
      emergency_contact_name: routing.immediateTriage ? null : (emergency_contact_name || null),
      emergency_contact_phone: routing.immediateTriage ? null : (emergency_contact_phone || null),
      temp_id: tempId,
    }, { transaction: t });

    const visitType = routing.immediateTriage || isEmergency
      ? 'emergency'
      : patientCategory === 'returning'
        ? 'follow_up'
        : 'new';

    const visit = await Visit.create({
      id: uuidv4(),
      patient_id: patient.id,
      facility_id: req.user.facility_id,
      visit_number: generateVisitNumber(),
      visit_type: visitType,
      status: 'in_progress',
      current_department: routing.department,
      created_by: req.user.id,
    }, { transaction: t });

    const queueEntry = await queueService.pushToQueue({
      visit_id: visit.id,
      department: routing.department,
      priority: routing.priority,
      pushed_by: req.user.id,
      notes: buildIntakeNotes(req.body, routing) || (routing.immediateTriage ? 'Immediate triage emergency registration' : 'New patient registration'),
    }, t);

    await billingChargeService.chargeAdmissionFee(visit.id, req.user.facility_id, t);

    await t.commit();

    try {
      const io = getIO();
      const patientPayload = {
        id: patient.id,
        first_name: patient.first_name,
        last_name: patient.last_name,
        patient_number: patient.patient_number,
        is_emergency: isEmergency,
        temp_id: patient.temp_id,
      };
      const visitPayload = {
        id: visit.id,
        visit_number: visit.visit_number,
        visit_type: visit.visit_type,
      };
      emitQueueEvents(io, routing, { queueEntry, patient: patientPayload, visit: visitPayload });
      emitFrontOfficeRegistration({
        visitId: visit.id,
        visitType: visit.visit_type,
        patientId: patient.id,
        processedBy: req.user.id,
      });
    } catch (emitErr) {
      console.error('Register patient emit error:', emitErr.message);
    }

    return created(res, { patient, visit, queueEntry }, `Patient registered and routed to ${routing.routingLabel || routing.department}`);
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Register patient error:', err);
    const status = err.statusCode || (err.message?.includes('already in the') ? 409 : 500);
    return error(res, err.message || 'Failed to register patient', status);
  }
};

// Emergency one-click registration (Unknown patient — immediate triage)
exports.emergencyRegister = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { sex, notes } = req.body;

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

    const visit = await Visit.create({
      id: uuidv4(),
      patient_id: patient.id,
      facility_id: req.user.facility_id,
      visit_number: generateVisitNumber(),
      visit_type: 'emergency',
      status: 'in_progress',
      current_department: EMERGENCY_UNIT_DEPARTMENT,
      created_by: req.user.id,
    }, { transaction: t });

    const queueEntry = await queueService.pushToQueue({
      visit_id: visit.id,
      department: EMERGENCY_UNIT_DEPARTMENT,
      priority: 'emergency',
      pushed_by: req.user.id,
      notes: notes || 'Immediate triage — unknown emergency patient',
    }, t);

    await t.commit();

    try {
      const io = getIO();
      const routing = {
        department: EMERGENCY_UNIT_DEPARTMENT,
        immediateTriage: true,
        isEmergency: true,
      };
      const patientPayload = {
        id: patient.id,
        temp_id: tempId,
        patient_number: patient.patient_number,
        is_emergency: true,
      };
      const visitPayload = {
        id: visit.id,
        visit_number: visit.visit_number,
        visit_type: 'emergency',
      };
      emitQueueEvents(io, routing, { queueEntry, patient: patientPayload, visit: visitPayload });
      emitFrontOfficeRegistration({
        visitId: visit.id,
        visitType: 'emergency',
        patientId: patient.id,
        processedBy: req.user.id,
      });
    } catch (emitErr) {
      console.error('Emergency register emit error:', emitErr.message);
    }

    return created(res, { patient, visit, queueEntry }, 'Emergency patient routed to Emergency Unit');
  } catch (err) {
    if (!t.finished) await t.rollback();
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

    let rows;

    if (idNumber) {
      const normalized = idNumber.replace(/\D/g, '');
      if (normalized.length === 11) {
        const match = await findByNationalId(normalized);
        rows = match ? [await Patient.findByPk(match.id)] : [];
      } else {
        rows = await Patient.findAll({
          where: { id_number: { [Op.like]: `%${idNumber}%` } },
          limit: 50,
          order: [
            ['last_name', 'ASC'],
            ['first_name', 'ASC'],
          ],
        });
      }
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

      rows = await Patient.findAll({
        where: { [Op.and]: conditions },
        limit: 50,
        order: [
          ['last_name', 'ASC'],
          ['first_name', 'ASC'],
        ],
      });
    }

    await visitService.reconcileFacilityStaleVisits(req.user.facility_id);

    const patients = await Promise.all(
      rows.map(async (p) => {
        const json = p.toJSON();
        const { activeVisit, activeQueue } = await visitService.getActiveVisitContext(
          p.id,
          req.user.facility_id
        );
        return {
          ...json,
          profile_complete: isProfileComplete(p),
          has_active_visit: Boolean(activeVisit),
          active_visit: visitService.serializeActiveVisitSummary(activeVisit, activeQueue),
        };
      })
    );

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

    const { activeVisit, activeQueue } = await visitService.getActiveVisitContext(
      patient.id,
      req.user.facility_id
    );
    const json = patient.toJSON();
    json.has_active_visit = Boolean(activeVisit);
    json.active_visit = visitService.serializeActiveVisitSummary(activeVisit, activeQueue);

    return success(res, json);
  } catch (err) {
    return error(res, 'Failed to fetch patient', 500);
  }
};

// Clinical medical history — all stops & vitals, no staff identities
exports.getClinicalMedicalHistory = async (req, res) => {
  try {
    const patient = await Patient.findByPk(req.params.id, { attributes: ['id'] });
    if (!patient) return error(res, 'Patient not found', 404);

    const history = await patientMedicalHistoryService.getClinicalMedicalHistory(
      patient.id,
      req.user.facility_id
    );
    return success(res, history);
  } catch (err) {
    console.error('Get clinical medical history error:', err);
    return error(res, 'Failed to fetch clinical medical history', 500);
  }
};

// Get patient visit history
exports.getHistory = async (req, res) => {
  try {
    const visits = await Visit.findAll({
      where: { patient_id: req.params.id },
      include: [
        { association: 'vitals' },
        { association: 'screeningAssessment' },
        { association: 'hivTestResult' },
        { association: 'artEpisode' },
        { association: 'prepEpisode' },
        { association: 'dermatologyAssessment' },
        { association: 'papSmearScreening' },
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

    if (isClinicFrontOffice(req.user.role)) {
      try {
        await assertCanEditPatientToday(patient.id, req.user.id, req.user.facility_id);
      } catch (err) {
        return error(res, err.message, err.statusCode || 403);
      }
    }

    const allowedFields = [
      'first_name', 'last_name', 'sex', 'date_of_birth', 'id_number',
      'phone', 'address', 'payment_type', 'emergency_contact_name',
      'emergency_contact_phone', 'category',
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (updates.category === 'unknown' && patient.category !== 'unknown') {
      return error(res, 'Cannot change patient category to unknown via profile update', 400);
    }

    if (
      patient.category === 'unknown'
      && updates.category === 'known'
      && updates.first_name
      && updates.last_name
    ) {
      updates.temp_id = null;
    }

    const nextIdNumber = updates.id_number !== undefined ? updates.id_number : patient.id_number;
    const nextPhone = updates.phone !== undefined ? updates.phone : patient.phone;
    if (patient.category !== 'unknown' || updates.category === 'known') {
      if (updates.id_number !== undefined && updates.id_number) {
        updates.id_number = validateNationalIdForRegistration(updates.id_number);
      }
      if (updates.phone !== undefined && updates.phone) {
        updates.phone = validatePhoneForRegistration(updates.phone);
      }
      await assertUniquePatientIdentifiers({
        id_number: updates.id_number !== undefined ? updates.id_number : nextIdNumber,
        phone: updates.phone !== undefined ? updates.phone : nextPhone,
        excludePatientId: patient.id,
      });
    }

    await patient.update(updates);
    return success(res, patient, 'Patient updated');
  } catch (err) {
    const status = err.statusCode || 500;
    return error(res, err.message || 'Failed to update patient', status);
  }
};

// Create a new visit for returning patient
exports.createVisit = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const patient = await Patient.findByPk(req.params.id);
    if (!patient) {
      if (!t.finished) await t.rollback();
      return error(res, 'Patient not found', 404);
    }

    await visitService.assertNoActiveVisitForPatient(
      patient.id,
      req.user.facility_id,
      t
    );

    const {
      mode_of_arrival,
      accompanied_by,
      is_emergency,
      immediate_triage,
      routing_destination,
    } = req.body || {};

    const routing = resolveFrontOfficeRouting({
      is_emergency,
      immediate_triage,
      routing_destination,
      mode_of_arrival,
      accompanied_by,
      sex: patient.sex,
      date_of_birth: patient.date_of_birth,
    }, { facility: await Facility.findByPk(req.user.facility_id, { transaction: t }) });

    const patientUpdates = { category: 'returning' };
    if (routing.isEmergency) patientUpdates.is_emergency = true;
    await patient.update(patientUpdates, { transaction: t });

    const visitType = routing.immediateTriage || routing.isEmergency ? 'emergency' : 'follow_up';

    const visit = await Visit.create({
      id: uuidv4(),
      patient_id: patient.id,
      facility_id: req.user.facility_id,
      visit_number: generateVisitNumber(),
      visit_type: visitType,
      status: 'in_progress',
      current_department: routing.department,
      created_by: req.user.id,
    }, { transaction: t });

    const queueEntry = await queueService.pushToQueue({
      visit_id: visit.id,
      department: routing.department,
      priority: routing.priority,
      pushed_by: req.user.id,
      notes: buildIntakeNotes(req.body, routing),
    }, t);

    await billingChargeService.chargeAdmissionFee(visit.id, req.user.facility_id, t);

    await t.commit();

    try {
      const io = getIO();
      const patientPayload = {
        id: patient.id,
        first_name: patient.first_name,
        last_name: patient.last_name,
        patient_number: patient.patient_number,
        is_emergency: routing.isEmergency,
      };
      const visitPayload = {
        id: visit.id,
        visit_number: visit.visit_number,
        visit_type: visitType,
      };
      emitQueueEvents(io, routing, { queueEntry, patient: patientPayload, visit: visitPayload });
      emitFrontOfficeRegistration({
        visitId: visit.id,
        visitType,
        patientId: patient.id,
        processedBy: req.user.id,
      });
    } catch (emitErr) {
      console.error('Create visit emit error:', emitErr.message);
    }

    return created(
      res,
      { visit, queueEntry },
      `Visit created — patient routed to ${routing.routingLabel || routing.department}`
    );
  } catch (err) {
    if (!t.finished) await t.rollback();
    const status = err.statusCode || (err.message?.includes('already in the') ? 409 : 500);
    return error(res, err.message || 'Failed to create visit', status);
  }
};
