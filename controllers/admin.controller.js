const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const {
  User, Role, Patient, Visit, QueueEntry, Admission, AuditLog,
  SocialWorkerCase, Facility, RevenueShift, sequelize,
} = require('../models');
const { Op } = require('sequelize');
const { success, created, error, paginated } = require('../utils/response');

function isSystemAdmin(req) {
  return req.user?.role?.name === 'system_admin';
}

function generateTempPassword() {
  return crypto.randomBytes(9).toString('base64url').slice(0, 12);
}

async function fetchNationalDashboardAnalytics() {
  const days = 14;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (days - 1));
  startDate.setHours(0, 0, 0, 0);

  const departments = ['nurse', 'doctor', 'pharmacy', 'lab', 'sonar', 'billing', 'transport'];

  const [
    visitsRaw,
    patientsByCategory,
    patientsByPaymentType,
    facilitiesByType,
    staffByRoleRows,
    queueCounts,
  ] = await Promise.all([
    Visit.findAll({
      attributes: [
        [sequelize.fn('DATE', sequelize.col('created_at')), 'date'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      where: { created_at: { [Op.gte]: startDate } },
      group: [sequelize.fn('DATE', sequelize.col('created_at'))],
      order: [[sequelize.fn('DATE', sequelize.col('created_at')), 'ASC']],
      raw: true,
    }),
    Patient.findAll({
      attributes: ['category', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['category'],
      raw: true,
    }),
    Patient.findAll({
      attributes: ['payment_type', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['payment_type'],
      raw: true,
    }),
    Facility.findAll({
      attributes: ['type', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['type'],
      raw: true,
    }),
    User.findAll({
      attributes: [[sequelize.fn('COUNT', sequelize.col('User.id')), 'count']],
      where: { is_active: true },
      include: [{ model: Role, as: 'role', attributes: ['name', 'display_name'] }],
      group: ['role_id', 'role.id', 'role.name', 'role.display_name'],
    }),
    Promise.all(
      departments.map(async (department) => ({
        department,
        count: await QueueEntry.count({ where: { department, status: 'waiting' } }),
      }))
    ),
  ]);

  const visitsByDay = [];
  const countByDate = Object.fromEntries(
    visitsRaw.map((r) => {
      const d = r.date instanceof Date
        ? r.date.toISOString().slice(0, 10)
        : String(r.date).slice(0, 10);
      return [d, parseInt(r.count, 10) || 0];
    })
  );
  for (let i = 0; i < days; i += 1) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    visitsByDay.push({ date: key, count: countByDate[key] || 0 });
  }

  const staffByRole = staffByRoleRows
    .map((row) => {
      const plain = row.get ? row.get({ plain: true }) : row;
      const label = plain.role?.display_name || plain.role?.name || 'Unknown';
      return { role: label, count: parseInt(plain.count, 10) || 0 };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  const mapCountRows = (rows, keyField) =>
    rows.map((r) => ({
      label: r[keyField] ? String(r[keyField]).replace(/_/g, ' ') : 'Unknown',
      count: parseInt(r.count, 10) || 0,
    }));

  const FACILITY_LABELS = {
    hospital: 'State Hospital',
    clinic: 'Clinic',
    health_center: 'Health Center',
  };

  return {
    visitsByDay,
    staffByRole,
    patientsByCategory: mapCountRows(patientsByCategory, 'category'),
    patientsByPaymentType: mapCountRows(patientsByPaymentType, 'payment_type'),
    facilitiesByType: facilitiesByType.map((r) => ({
      label: FACILITY_LABELS[r.type] || r.type,
      count: parseInt(r.count, 10) || 0,
    })),
    queueWaiting: queueCounts.filter((q) => q.count > 0),
  };
}

// === FACILITY MANAGEMENT ===

exports.getFacilities = async (req, res) => {
  try {
    const facilities = await Facility.findAll({
      order: [['name', 'ASC']],
      attributes: ['id', 'name', 'type', 'province', 'district', 'address', 'phone', 'created_at'],
    });

    const staffCounts = await User.findAll({
      attributes: [
        'facility_id',
        [sequelize.fn('COUNT', sequelize.col('id')), 'staff_count'],
      ],
      group: ['facility_id'],
      raw: true,
    });
    const countByFacility = Object.fromEntries(
      staffCounts.map((r) => [r.facility_id, parseInt(r.staff_count, 10) || 0])
    );

    const rows = facilities.map((f) => {
      const plain = f.toJSON();
      return {
        ...plain,
        staff_count: countByFacility[plain.id] || 0,
        location: [plain.district, plain.province].filter(Boolean).join(', ') || plain.province || '—',
      };
    });

    return success(res, rows);
  } catch (err) {
    console.error('getFacilities error:', err);
    return error(res, 'Failed to fetch facilities', 500);
  }
};

exports.createFacility = async (req, res) => {
  try {
    const { name, type, address, province, district, phone } = req.body;
    if (!name || !type) {
      return error(res, 'name and type are required', 400);
    }
    const allowedTypes = ['hospital', 'clinic', 'health_center'];
    if (!allowedTypes.includes(type)) {
      return error(res, `type must be one of: ${allowedTypes.join(', ')}`, 400);
    }

    const facility = await Facility.create({
      id: uuidv4(),
      name: name.trim(),
      type,
      address: address?.trim() || null,
      province: province?.trim() || null,
      district: district?.trim() || null,
      phone: phone?.trim() || null,
    });

    return created(res, { ...facility.toJSON(), staff_count: 0 }, 'Facility created');
  } catch (err) {
    console.error('createFacility error:', err);
    return error(res, 'Failed to create facility', 500);
  }
};

// === USER MANAGEMENT ===

exports.getUsers = async (req, res) => {
  try {
    const { page = 1, limit = 50, search, role, facility_id, status } = req.query;
    const offset = (page - 1) * limit;
    const where = {};

    if (!isSystemAdmin(req)) {
      where.facility_id = req.user.facility_id;
    } else if (facility_id) {
      where.facility_id = facility_id;
    }

    if (status === 'active') where.is_active = true;
    if (status === 'inactive') where.is_active = false;

    if (role) {
      const roleRecord = await Role.findOne({ where: { name: role } });
      if (roleRecord) where.role_id = roleRecord.id;
    }
    if (search) {
      where[Op.or] = [
        { first_name: { [Op.like]: `%${search}%` } },
        { last_name: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } },
        { employee_id: { [Op.like]: `%${search}%` } },
      ];
    }

    const { rows, count } = await User.findAndCountAll({
      where,
      include: [
        { model: Role, as: 'role', attributes: ['id', 'name', 'display_name'] },
        { model: Facility, as: 'facility', attributes: ['id', 'name', 'province', 'district'] },
      ],
      attributes: { exclude: ['password_hash'] },
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
      order: [['last_name', 'ASC'], ['first_name', 'ASC']],
    });

    return paginated(res, rows, count, page, limit);
  } catch (err) {
    return error(res, 'Failed to fetch users', 500);
  }
};

exports.createUser = async (req, res) => {
  try {
    const {
      first_name, last_name, email, password, role_id, employee_id, phone, facility_id,
    } = req.body;
    if (!first_name || !last_name || !email || !role_id) {
      return error(res, 'first_name, last_name, email, and role_id are required', 400);
    }

    const targetFacilityId = isSystemAdmin(req)
      ? facility_id
      : req.user.facility_id;
    if (!targetFacilityId) {
      return error(res, 'facility_id is required', 400);
    }

    const facility = await Facility.findByPk(targetFacilityId);
    if (!facility) return error(res, 'Facility not found', 404);

    const existing = await User.findOne({ where: { email: email.trim() } });
    if (existing) return error(res, 'Email already in use', 400);

    const tempPassword = password || generateTempPassword();
    const password_hash = await bcrypt.hash(tempPassword, 10);

    const user = await User.create({
      id: uuidv4(),
      facility_id: targetFacilityId,
      role_id,
      employee_id: employee_id || null,
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      email: email.trim(),
      password_hash,
      phone: phone || null,
      is_active: true,
    });

    const result = await User.findByPk(user.id, {
      attributes: { exclude: ['password_hash'] },
      include: [
        { model: Role, as: 'role', attributes: ['id', 'name', 'display_name'] },
        { model: Facility, as: 'facility', attributes: ['id', 'name'] },
      ],
    });

    const payload = result.toJSON();
    if (!password) {
      payload.temporary_password = tempPassword;
    }

    return created(res, payload, 'User created');
  } catch (err) {
    console.error('Create user error:', err);
    return error(res, 'Failed to create user', 500);
  }
};

exports.updateUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return error(res, 'User not found', 404);

    if (!isSystemAdmin(req) && user.facility_id !== req.user.facility_id) {
      return error(res, 'Access denied', 403);
    }

    const allowed = ['first_name', 'last_name', 'email', 'phone', 'role_id', 'employee_id', 'is_active'];
    const updates = {};
    for (const f of allowed) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }

    // Password reset
    if (req.body.password) {
      updates.password_hash = await bcrypt.hash(req.body.password, 10);
    }

    await user.update(updates);
    const result = user.toJSON();
    delete result.password_hash;

    return success(res, result, 'User updated');
  } catch (err) {
    return error(res, 'Failed to update user', 500);
  }
};

exports.getRoles = async (req, res) => {
  try {
    const where = {};
    if (isSystemAdmin(req)) {
      where.name = { [Op.notIn]: ['system_admin', 'executive'] };
    }
    const roles = await Role.findAll({ where, order: [['display_name', 'ASC'], ['name', 'ASC']] });
    return success(res, roles);
  } catch (err) {
    return error(res, 'Failed to fetch roles', 500);
  }
};

// === AUDIT LOGS ===

exports.getAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50, user_id, resource, action, from, to } = req.query;
    const offset = (page - 1) * limit;
    const where = {};

    if (user_id) where.user_id = user_id;
    if (resource) where.resource = resource;
    if (action) where.action = action;
    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp[Op.gte] = new Date(from);
      if (to) where.timestamp[Op.lte] = new Date(to);
    }

    const { rows, count } = await AuditLog.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['timestamp', 'DESC']],
    });

    return paginated(res, rows, count, page, limit);
  } catch (err) {
    return error(res, 'Failed to fetch audit logs', 500);
  }
};

// === ADMIN DASHBOARD ===

exports.getDashboard = async (req, res) => {
  try {
    if (isSystemAdmin(req)) {
      const [
        totalFacilities,
        activeEmployees,
        inactiveEmployees,
        pendingShiftReviews,
        openSocialCases,
        totalPatients,
        analytics,
      ] = await Promise.all([
        Facility.count(),
        User.count({ where: { is_active: true } }),
        User.count({ where: { is_active: false } }),
        RevenueShift.count({
          where: { status: { [Op.in]: ['closed', 'discrepancy'] }, reconciled_by: null },
        }),
        SocialWorkerCase.count({ where: { status: { [Op.in]: ['open', 'in_progress'] } } }),
        Patient.count(),
        fetchNationalDashboardAnalytics(),
      ]);

      return success(res, {
        scope: 'national',
        totalFacilities,
        activeEmployees,
        inactiveEmployees,
        pendingRequests: pendingShiftReviews + openSocialCases,
        pendingShiftReviews,
        openSocialCases,
        totalPatients,
        analytics,
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalPatients,
      todayVisits,
      activeVisits,
      admittedCount,
      totalStaff,
      emergencyToday,
    ] = await Promise.all([
      Patient.count(),
      Visit.count({ where: { created_at: { [Op.gte]: today } } }),
      Visit.count({ where: { status: 'in_progress' } }),
      Admission.count({ where: { status: 'admitted' } }),
      User.count({ where: { facility_id: req.user.facility_id, is_active: true } }),
      Visit.count({ where: { visit_type: 'emergency', created_at: { [Op.gte]: today } } }),
    ]);

    const departments = ['nurse', 'doctor', 'pharmacy', 'lab', 'sonar', 'billing', 'transport'];
    const queueStats = {};
    for (const dept of departments) {
      queueStats[dept] = await QueueEntry.count({
        where: { department: dept, status: 'waiting' },
      });
    }

    return success(res, {
      scope: 'facility',
      totalPatients,
      todayVisits,
      activeVisits,
      admittedCount,
      totalStaff,
      emergencyToday,
      queueStats,
    });
  } catch (err) {
    return error(res, 'Failed to fetch dashboard', 500);
  }
};

// === SOCIAL WORKER CASES ===

exports.getSocialWorkerCases = async (req, res) => {
  try {
    const { status } = req.query;
    const where = {};
    if (status) where.status = status;

    const cases = await SocialWorkerCase.findAll({
      where,
      include: [
        { association: 'patient', attributes: ['id', 'first_name', 'last_name', 'patient_number'] },
        { association: 'assignedTo', attributes: ['id', 'first_name', 'last_name'] },
      ],
      order: [['created_at', 'DESC']],
    });

    return success(res, cases);
  } catch (err) {
    return error(res, 'Failed to fetch cases', 500);
  }
};

exports.createSocialWorkerCase = async (req, res) => {
  try {
    const { patient_id, visit_id, case_type, notes } = req.body;
    if (!patient_id || !case_type) return error(res, 'patient_id and case_type are required', 400);

    const swCase = await SocialWorkerCase.create({
      id: uuidv4(),
      patient_id,
      visit_id: visit_id || null,
      assigned_to: req.user.id,
      case_type,
      notes: notes || null,
    });

    return created(res, swCase, 'Case created');
  } catch (err) {
    return error(res, 'Failed to create case', 500);
  }
};

exports.updateSocialWorkerCase = async (req, res) => {
  try {
    const swCase = await SocialWorkerCase.findByPk(req.params.id);
    if (!swCase) return error(res, 'Case not found', 404);

    const { status, notes } = req.body;
    const updates = {};
    if (status) {
      updates.status = status;
      if (status === 'resolved' || status === 'closed') updates.resolved_at = new Date();
    }
    if (notes !== undefined) updates.notes = notes;

    await swCase.update(updates);
    return success(res, swCase, 'Case updated');
  } catch (err) {
    return error(res, 'Failed to update case', 500);
  }
};

// === ANALYTICS ===

exports.getAnalytics = async (req, res) => {
  try {
    const { from, to } = req.query;
    const startDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const endDate = to ? new Date(to) : new Date();

    const [totalVisits, emergencies, admissions, discharges, byCategory, byType] = await Promise.all([
      Visit.count({ where: { created_at: { [Op.between]: [startDate, endDate] } } }),
      Visit.count({ where: { visit_type: 'emergency', created_at: { [Op.between]: [startDate, endDate] } } }),
      Admission.count({ where: { admitted_at: { [Op.between]: [startDate, endDate] } } }),
      Admission.count({ where: { status: 'discharged', discharged_at: { [Op.between]: [startDate, endDate] } } }),
      Patient.findAll({
        attributes: ['category', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
        group: ['category'],
        raw: true,
      }),
      Patient.findAll({
        attributes: ['payment_type', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
        group: ['payment_type'],
        raw: true,
      }),
    ]);

    return success(res, {
      period: { from: startDate, to: endDate },
      totalVisits,
      emergencies,
      admissions,
      discharges,
      patientsByCategory: byCategory,
      patientsByPaymentType: byType,
    });
  } catch (err) {
    return error(res, 'Failed to fetch analytics', 500);
  }
};
