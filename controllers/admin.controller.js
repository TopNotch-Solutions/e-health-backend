const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const {
  User, Role, Patient, Visit, QueueEntry, Admission, AuditLog,
  SocialWorkerCase, Facility, sequelize,
} = require('../models');
const { Op } = require('sequelize');
const { success, created, error, paginated } = require('../utils/response');

// === USER MANAGEMENT ===

exports.getUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, role } = req.query;
    const offset = (page - 1) * limit;
    const where = { facility_id: req.user.facility_id };

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
      include: [{ model: Role, as: 'role', attributes: ['id', 'name', 'display_name'] }],
      attributes: { exclude: ['password_hash'] },
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['created_at', 'DESC']],
    });

    return paginated(res, rows, count, page, limit);
  } catch (err) {
    return error(res, 'Failed to fetch users', 500);
  }
};

exports.createUser = async (req, res) => {
  try {
    const { first_name, last_name, email, password, role_id, employee_id, phone } = req.body;
    if (!first_name || !last_name || !email || !password || !role_id) {
      return error(res, 'first_name, last_name, email, password, and role_id are required', 400);
    }

    const existing = await User.findOne({ where: { email } });
    if (existing) return error(res, 'Email already in use', 400);

    const password_hash = await bcrypt.hash(password, 10);

    const user = await User.create({
      id: uuidv4(),
      facility_id: req.user.facility_id,
      role_id,
      employee_id: employee_id || null,
      first_name,
      last_name,
      email,
      password_hash,
      phone: phone || null,
    });

    const result = user.toJSON();
    delete result.password_hash;

    return created(res, result, 'User created');
  } catch (err) {
    console.error('Create user error:', err);
    return error(res, 'Failed to create user', 500);
  }
};

exports.updateUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return error(res, 'User not found', 404);

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
    const roles = await Role.findAll({ order: [['name', 'ASC']] });
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

    // Queue stats
    const departments = ['nurse', 'doctor', 'pharmacy', 'lab', 'sonar', 'billing', 'transport'];
    const queueStats = {};
    for (const dept of departments) {
      queueStats[dept] = await QueueEntry.count({
        where: { department: dept, status: 'waiting' },
      });
    }

    return success(res, {
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
