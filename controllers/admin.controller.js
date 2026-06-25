'use strict';

const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const {
  User, Role, Patient, Visit, QueueEntry, Admission, AuditLog,
  SocialWorkerCase, Facility, RevenueShift, EmployeeFacilityAssignment, RefreshToken, sequelize,
} = require('../models');
const { Op } = require('sequelize');
const { success, created, error, paginated } = require('../utils/response');
const {
  DEFAULT_DEMO_PASSWORD,
  CLINIC_ROLE_SLUGS,
  isClinicFacility,
  getAllowedRoleSlugsForFacility,
  isRoleAllowedAtFacility,
} = require('../config/clinicRoles');
const { resolveNationalAdminFacility, NATIONAL_ADMIN_FACILITY_NAME } = require('../utils/nationalAdmin');
const { ensureRolesSynced } = require('../services/roleSyncService');
const {
  CLINIC_DEPARTMENT_DEFINITIONS,
  FOUNDATION_CLINIC_DEPARTMENT_KEYS,
  MINIMAL_CLINIC_TEMPLATE_KEYS,
  FULL_CLINIC_TEMPLATE_KEYS,
  isFoundationDepartment,
  getRequiredDepartment,
  getCascadeRemovals,
  resolveTemplateKeys,
  seedDepartmentsForFacility,
  getActiveDepartmentKeys,
  getFacilityDepartmentsSummary,
  addDepartments,
  removeDepartments,
  getDepartmentDetail,
} = require('../services/clinicFacilityDepartmentService');

function isSystemAdmin(req) {
  return req.user?.role?.name === 'system_admin';
}

async function resolveRoleById(roleId) {
  if (!roleId) return null;
  return Role.findByPk(roleId);
}

async function openAssignmentForUser(userId, transaction) {
  return EmployeeFacilityAssignment.findOne({
    where: { user_id: userId, ended_at: null },
    order: [['started_at', 'DESC']],
    transaction,
  });
}

async function recordFacilityAssignment({
  userId,
  facilityId,
  roleId,
  startedAt,
  transferredBy,
  notes,
  transaction,
}) {
  return EmployeeFacilityAssignment.create({
    id: uuidv4(),
    user_id: userId,
    facility_id: facilityId,
    role_id: roleId,
    started_at: startedAt || new Date(),
    ended_at: null,
    transferred_by: transferredBy || null,
    notes: notes || null,
  }, { transaction });
}

function formatAdminUserName(user) {
  if (!user) return null;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return name || user.email || null;
}

function serializeUserRow(row) {
  const plain = row.get ? row.get({ plain: true }) : { ...row };
  delete plain.password_hash;
  const openAssignment = (plain.facilityAssignments || []).find((a) => !a.ended_at)
    || plain.facilityAssignments?.[0];
  const isSa = plain.role?.name === 'system_admin';
  return {
    ...plain,
    admin_scope: isSa ? 'national' : null,
    registered_by: formatAdminUserName(plain.createdBy),
    assigned_by: formatAdminUserName(openAssignment?.transferredBy),
  };
}

const userListIncludes = [
  { model: Role, as: 'role', attributes: ['id', 'name', 'display_name'] },
  { model: Facility, as: 'facility', attributes: ['id', 'name', 'type', 'province', 'district'] },
  {
    model: User,
    as: 'createdBy',
    attributes: ['id', 'first_name', 'last_name', 'email'],
  },
  {
    model: EmployeeFacilityAssignment,
    as: 'facilityAssignments',
    where: { ended_at: null },
    required: false,
    separate: true,
    include: [{
      model: User,
      as: 'transferredBy',
      attributes: ['id', 'first_name', 'last_name', 'email'],
    }],
  },
];

const FACILITY_TYPE_LABELS = {
  hospital: 'State Hospital',
  clinic: 'Clinic',
  health_center: 'Health Center',
};

const QUEUE_DEPARTMENTS = ['nurse', 'doctor', 'pharmacy', 'lab', 'sonar', 'billing', 'transport'];

function mapCountRows(rows, keyField) {
  return rows.map((r) => ({
    label: r[keyField] ? String(r[keyField]).replace(/_/g, ' ') : 'Unknown',
    count: parseInt(r.count, 10) || 0,
  }));
}

async function getNationalOfficeFacilityId() {
  const row = await Facility.findOne({
    where: { name: NATIONAL_ADMIN_FACILITY_NAME },
    attributes: ['id'],
  });
  return row?.id || null;
}

async function fetchFacilitySummaries() {
  const nationalOfficeId = await getNationalOfficeFacilityId();
  const facilityWhere = nationalOfficeId
    ? { id: { [Op.ne]: nationalOfficeId } }
    : { name: { [Op.ne]: NATIONAL_ADMIN_FACILITY_NAME } };

  const facilities = await Facility.findAll({
    where: facilityWhere,
    order: [['name', 'ASC']],
    attributes: ['id', 'name', 'type', 'province', 'district'],
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days14 = new Date();
  days14.setDate(days14.getDate() - 13);
  days14.setHours(0, 0, 0, 0);

  const systemAdminRole = await Role.findOne({ where: { name: 'system_admin' }, attributes: ['id'] });

  return Promise.all(facilities.map(async (facility) => {
    const staffWhere = {
      facility_id: facility.id,
      ...(systemAdminRole ? { role_id: { [Op.ne]: systemAdminRole.id } } : {}),
    };

    const [activeStaff, inactiveStaff, todayVisits, visits14d, queueWaiting] = await Promise.all([
      User.count({ where: { ...staffWhere, is_active: true } }),
      User.count({ where: { ...staffWhere, is_active: false } }),
      Visit.count({ where: { facility_id: facility.id, created_at: { [Op.gte]: today } } }),
      Visit.count({ where: { facility_id: facility.id, created_at: { [Op.gte]: days14 } } }),
      QueueEntry.count({
        where: { status: 'waiting' },
        include: [{
          model: Visit,
          as: 'visit',
          attributes: [],
          where: { facility_id: facility.id },
          required: true,
        }],
      }),
    ]);

    return {
      id: facility.id,
      name: facility.name,
      type: facility.type,
      type_label: FACILITY_TYPE_LABELS[facility.type] || facility.type,
      location: [facility.district, facility.province].filter(Boolean).join(', ') || '—',
      active_staff: activeStaff,
      inactive_staff: inactiveStaff,
      today_visits: todayVisits,
      visits_14d: visits14d,
      queue_waiting: queueWaiting,
    };
  }));
}

async function countQueueByDepartment(facilityId) {
  return Promise.all(
    QUEUE_DEPARTMENTS.map(async (department) => {
      const include = facilityId ? [{
        model: Visit,
        as: 'visit',
        attributes: [],
        where: { facility_id: facilityId },
        required: true,
      }] : [];
      const count = await QueueEntry.count({
        where: { department, status: 'waiting' },
        include,
      });
      return { department, count };
    })
  );
}

async function fetchPatientsByCategory(facilityId) {
  if (!facilityId) {
    const rows = await Patient.findAll({
      attributes: ['category', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['category'],
      raw: true,
    });
    return mapCountRows(rows, 'category');
  }

  const [rows] = await sequelize.query(
    `SELECT p.category, COUNT(DISTINCT p.id) AS count
     FROM patients p
     INNER JOIN visits v ON v.patient_id = p.id
     WHERE v.facility_id = :facilityId
     GROUP BY p.category`,
    { replacements: { facilityId } }
  );
  return mapCountRows(rows, 'category');
}

async function fetchPatientsByPaymentType(facilityId) {
  if (!facilityId) {
    const rows = await Patient.findAll({
      attributes: ['payment_type', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['payment_type'],
      raw: true,
    });
    return mapCountRows(rows, 'payment_type');
  }

  const [rows] = await sequelize.query(
    `SELECT p.payment_type, COUNT(DISTINCT p.id) AS count
     FROM patients p
     INNER JOIN visits v ON v.patient_id = p.id
     WHERE v.facility_id = :facilityId
     GROUP BY p.payment_type`,
    { replacements: { facilityId } }
  );
  return mapCountRows(rows, 'payment_type');
}

async function fetchDashboardAnalytics(facilityId = null) {
  const days = 14;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (days - 1));
  startDate.setHours(0, 0, 0, 0);

  const visitWhere = {
    created_at: { [Op.gte]: startDate },
    ...(facilityId ? { facility_id: facilityId } : {}),
  };

  const staffWhere = { is_active: true };
  if (facilityId) {
    staffWhere.facility_id = facilityId;
  } else {
    const nationalOfficeId = await getNationalOfficeFacilityId();
    if (nationalOfficeId) staffWhere.facility_id = { [Op.ne]: nationalOfficeId };
  }

  const [
    visitsRaw,
    patientsByCategory,
    patientsByPaymentType,
    facilitiesByType,
    staffByRoleRows,
    queueCounts,
    visitsByFacilityRows,
  ] = await Promise.all([
    Visit.findAll({
      attributes: [
        [sequelize.fn('DATE', sequelize.col('created_at')), 'date'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      where: visitWhere,
      group: [sequelize.fn('DATE', sequelize.col('created_at'))],
      order: [[sequelize.fn('DATE', sequelize.col('created_at')), 'ASC']],
      raw: true,
    }),
    fetchPatientsByCategory(facilityId),
    fetchPatientsByPaymentType(facilityId),
    facilityId
      ? Promise.resolve([])
      : Facility.findAll({
        attributes: ['type', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
        where: { name: { [Op.ne]: NATIONAL_ADMIN_FACILITY_NAME } },
        group: ['type'],
        raw: true,
      }),
    User.findAll({
      attributes: [[sequelize.fn('COUNT', sequelize.col('User.id')), 'count']],
      where: staffWhere,
      include: [{
        model: Role,
        as: 'role',
        attributes: ['name', 'display_name'],
        where: { name: { [Op.ne]: 'system_admin' } },
        required: true,
      }],
      group: ['role_id', 'role.id', 'role.name', 'role.display_name'],
    }),
    countQueueByDepartment(facilityId),
    facilityId
      ? Promise.resolve([])
      : Visit.findAll({
        attributes: [
          [sequelize.fn('COUNT', sequelize.col('Visit.id')), 'count'],
        ],
        where: { created_at: { [Op.gte]: startDate } },
        include: [{
          model: Facility,
          as: 'facility',
          attributes: ['id', 'name', 'type'],
          where: { name: { [Op.ne]: NATIONAL_ADMIN_FACILITY_NAME } },
          required: true,
        }],
        group: ['facility_id', 'facility.id', 'facility.name', 'facility.type'],
      }),
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

  const visitsByFacility = visitsByFacilityRows
    .map((row) => {
      const plain = row.get ? row.get({ plain: true }) : row;
      return {
        label: plain.facility?.name || 'Unknown',
        type: plain.facility?.type,
        count: parseInt(plain.count, 10) || 0,
      };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  return {
    facilityId,
    visitsByDay,
    staffByRole,
    patientsByCategory,
    patientsByPaymentType,
    facilitiesByType: facilitiesByType.map((r) => ({
      label: FACILITY_TYPE_LABELS[r.type] || r.type,
      count: parseInt(r.count, 10) || 0,
    })),
    visitsByFacility,
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

    const rows = await Promise.all(facilities.map(async (f) => {
      const plain = f.toJSON();
      let department_count = null;
      if (plain.type === 'clinic') {
        const { FacilityDepartment } = require('../models');
        department_count = await FacilityDepartment.count({
          where: { facility_id: plain.id, is_active: true },
        });
      }
      return {
        ...plain,
        staff_count: countByFacility[plain.id] || 0,
        department_count,
        location: [plain.district, plain.province].filter(Boolean).join(', ') || plain.province || '—',
      };
    }));

    return success(res, rows);
  } catch (err) {
    console.error('getFacilities error:', err);
    return error(res, 'Failed to fetch facilities', 500);
  }
};

exports.createFacility = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      name,
      type,
      address,
      province,
      district,
      phone,
      clinic_template,
      departments,
      template_reason,
    } = req.body;
    if (!name || !type) {
      await t.rollback();
      return error(res, 'name and type are required', 400);
    }
    const allowedTypes = ['hospital', 'clinic', 'health_center'];
    if (!allowedTypes.includes(type)) {
      await t.rollback();
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
    }, { transaction: t });

    let seededDepartments = [];
    if (type === 'clinic') {
      const template = clinic_template || 'full';
      const keys = resolveTemplateKeys(template, departments);
      if (!keys.length) {
        await t.rollback();
        return error(res, 'Select at least one clinic department', 400);
      }
      const customDiffersFromFull = template === 'custom'
        && (keys.length !== FULL_CLINIC_TEMPLATE_KEYS.length
          || keys.some((k) => !FULL_CLINIC_TEMPLATE_KEYS.includes(k))
          || FULL_CLINIC_TEMPLATE_KEYS.some((k) => !keys.includes(k)));
      if (customDiffersFromFull && !template_reason?.trim()) {
        await t.rollback();
        return error(res, 'A reason is required when removing optional clinic departments', 400);
      }
      seededDepartments = await seedDepartmentsForFacility(facility.id, keys, t);
      if (template === 'custom' && template_reason?.trim()) {
        const { FacilityDepartmentChange } = require('../models');
        for (const key of keys) {
          await FacilityDepartmentChange.create({
            id: uuidv4(),
            facility_id: facility.id,
            department_key: key,
            action: 'added',
            reason: template_reason.trim(),
            changed_by: req.user.id,
          }, { transaction: t });
        }
      }
    }

    await t.commit();

    const payload = {
      ...facility.toJSON(),
      staff_count: 0,
      department_count: seededDepartments.length,
    };
    return created(res, payload, 'Facility created');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('createFacility error:', err);
    return error(res, err.message || 'Failed to create facility', err.statusCode || 500);
  }
};

exports.getClinicDepartmentCatalog = async (req, res) => {
  return success(res, {
    foundation_template: FOUNDATION_CLINIC_DEPARTMENT_KEYS,
    minimal_template: MINIMAL_CLINIC_TEMPLATE_KEYS,
    full_template: FULL_CLINIC_TEMPLATE_KEYS,
    departments: CLINIC_DEPARTMENT_DEFINITIONS.map((d) => ({
      key: d.key,
      label: d.label,
      is_foundation: isFoundationDepartment(d.key),
      requires_department: getRequiredDepartment(d.key),
      removal_cascades_to: getCascadeRemovals(d.key),
    })),
  });
};

exports.getFacilityDepartments = async (req, res) => {
  try {
    const summary = await getFacilityDepartmentsSummary(req.params.id);
    if (!summary) return error(res, 'Facility not found', 404);
    return success(res, summary);
  } catch (err) {
    console.error('getFacilityDepartments error:', err);
    return error(res, 'Failed to load clinic departments', 500);
  }
};

exports.addFacilityDepartment = async (req, res) => {
  try {
    const { department_key, department_keys, reason } = req.body || {};
    const keys = Array.isArray(department_keys) && department_keys.length
      ? department_keys
      : department_key
        ? [department_key]
        : [];
    if (!keys.length) {
      return error(res, 'Select at least one department', 400);
    }
    const summary = await addDepartments(
      req.params.id,
      keys,
      reason,
      req.user.id
    );
    const message = keys.length === 1
      ? 'Department added'
      : `${keys.length} departments added`;
    return success(res, summary, message);
  } catch (err) {
    console.error('addFacilityDepartment error:', err);
    return error(res, err.message || 'Failed to add department', err.statusCode || 500);
  }
};

exports.removeFacilityDepartment = async (req, res) => {
  try {
    const { reason } = req.body || {};
    const summary = await removeDepartments(
      req.params.id,
      [req.params.departmentKey],
      reason,
      req.user.id
    );
    return success(res, summary, 'Department removed');
  } catch (err) {
    console.error('removeFacilityDepartment error:', err);
    return error(res, err.message || 'Failed to remove department', err.statusCode || 500);
  }
};

exports.removeFacilityDepartments = async (req, res) => {
  try {
    const { department_keys, reason } = req.body || {};
    const keys = Array.isArray(department_keys) && department_keys.length
      ? department_keys
      : [];
    if (!keys.length) {
      return error(res, 'Select at least one department', 400);
    }
    const summary = await removeDepartments(
      req.params.id,
      keys,
      reason,
      req.user.id
    );
    const message = keys.length === 1
      ? 'Department removed'
      : `${keys.length} departments removed`;
    return success(res, summary, message);
  } catch (err) {
    console.error('removeFacilityDepartments error:', err);
    return error(res, err.message || 'Failed to remove departments', err.statusCode || 500);
  }
};

exports.getFacilityDepartmentDetail = async (req, res) => {
  try {
    const detail = await getDepartmentDetail(req.params.id, req.params.departmentKey);
    return success(res, detail);
  } catch (err) {
    console.error('getFacilityDepartmentDetail error:', err);
    return error(res, err.message || 'Failed to load department detail', err.statusCode || 500);
  }
};

// === USER MANAGEMENT ===

exports.getUsers = async (req, res) => {
  try {
    const {
      page = 1, limit = 50, search, role, facility_id, status, exclude_role, role_only,
    } = req.query;
    const offset = (page - 1) * limit;
    const where = {};

    if (!isSystemAdmin(req)) {
      where.facility_id = req.user.facility_id;
    } else if (facility_id) {
      where.facility_id = facility_id;
    }

    if (status === 'active') where.is_active = true;
    if (status === 'inactive') where.is_active = false;

    const systemAdminRole = await Role.findOne({ where: { name: 'system_admin' }, attributes: ['id'] });

    if (role_only === 'system_admin' && systemAdminRole) {
      where.role_id = systemAdminRole.id;
    } else if (role) {
      const roleRecord = await Role.findOne({ where: { name: role } });
      if (roleRecord) where.role_id = roleRecord.id;
    } else if (exclude_role === 'system_admin' && systemAdminRole) {
      where.role_id = { [Op.ne]: systemAdminRole.id };
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
      include: userListIncludes,
      attributes: { exclude: ['password_hash'] },
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
      order: [['last_name', 'ASC'], ['first_name', 'ASC']],
      distinct: true,
    });

    return paginated(res, rows.map(serializeUserRow), count, page, limit);
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

    const role = await resolveRoleById(role_id);
    if (!role) return error(res, 'Role not found', 404);

    if (role.name === 'system_admin') {
      return error(res, 'Use the System administrators section to add system admin accounts', 400);
    }

    if (!isRoleAllowedAtFacility(role.name, facility)) {
      const label = isClinicFacility(facility) ? 'clinic' : 'state hospital';
      return error(
        res,
        `The selected role is not authorized at this ${label}. Choose a role available at the assigned facility.`,
        400
      );
    }

    const existing = await User.findOne({ where: { email: email.trim() } });
    if (existing) return error(res, 'Email already in use', 400);

    const isClinic = isClinicFacility(facility);
    const tempPassword = (password && String(password).trim()) || DEFAULT_DEMO_PASSWORD;
    const password_hash = await bcrypt.hash(tempPassword, 10);

    const user = await sequelize.transaction(async (transaction) => {
      const createdUser = await User.create({
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
        created_by: req.user.id,
      }, { transaction });

      await recordFacilityAssignment({
        userId: createdUser.id,
        facilityId: targetFacilityId,
        roleId: role_id,
        startedAt: new Date(),
        transferredBy: req.user.id,
        notes: isClinic ? 'Clinic onboarding' : 'Initial assignment',
        transaction,
      });

      return createdUser;
    });

    const result = await User.findByPk(user.id, {
      attributes: { exclude: ['password_hash'] },
      include: [
        { model: Role, as: 'role', attributes: ['id', 'name', 'display_name'] },
        { model: Facility, as: 'facility', attributes: ['id', 'name', 'type'] },
      ],
    });

    const payload = result.toJSON();
    payload.temporary_password = tempPassword;

    return created(res, payload, isClinic ? 'Clinic employee registered' : 'User created');
  } catch (err) {
    console.error('Create user error:', err);
    return error(res, 'Failed to create user', 500);
  }
};

exports.createSystemAdmin = async (req, res) => {
  try {
    if (!isSystemAdmin(req)) {
      return error(res, 'Only system administrators can create system admin accounts', 403);
    }

    const { first_name, last_name, email, password, phone } = req.body;
    if (!first_name || !last_name || !email) {
      return error(res, 'first_name, last_name, and email are required', 400);
    }

    const role = await Role.findOne({ where: { name: 'system_admin' } });
    if (!role) return error(res, 'system_admin role not found', 500);

    const existing = await User.findOne({ where: { email: email.trim() } });
    if (existing) return error(res, 'Email already in use', 400);

    const tempPassword = (password && String(password).trim()) || DEFAULT_DEMO_PASSWORD;
    const password_hash = await bcrypt.hash(tempPassword, 10);

    const user = await sequelize.transaction(async (transaction) => {
      const nationalFacility = await resolveNationalAdminFacility(transaction);

      const createdUser = await User.create({
        id: uuidv4(),
        facility_id: nationalFacility.id,
        role_id: role.id,
        employee_id: null,
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        email: email.trim(),
        password_hash,
        phone: phone || null,
        is_active: true,
        created_by: req.user.id,
      }, { transaction });

      await recordFacilityAssignment({
        userId: createdUser.id,
        facilityId: nationalFacility.id,
        roleId: role.id,
        startedAt: new Date(),
        transferredBy: req.user.id,
        notes: 'National system administrator — manages all state hospitals and clinics',
        transaction,
      });

      return createdUser;
    });

    const result = await User.findByPk(user.id, {
      attributes: { exclude: ['password_hash'] },
      include: userListIncludes,
    });

    const payload = serializeUserRow(result);
    payload.temporary_password = tempPassword;

    return created(res, payload, 'System administrator created');
  } catch (err) {
    console.error('createSystemAdmin error:', err);
    return error(res, 'Failed to create system administrator', 500);
  }
};

exports.updateUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      include: [{ model: Role, as: 'role', attributes: ['name'] }],
    });
    if (!user) return error(res, 'User not found', 404);

    if (!isSystemAdmin(req) && user.facility_id !== req.user.facility_id) {
      return error(res, 'Access denied', 403);
    }

    const isTargetSystemAdmin = user.role?.name === 'system_admin';

    const allowed = isTargetSystemAdmin
      ? ['is_active']
      : ['first_name', 'last_name', 'email', 'phone', 'role_id', 'employee_id', 'is_active'];
    const updates = {};
    for (const f of allowed) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }

    if (updates.is_active === false && user.id === req.user.id) {
      return error(res, 'You cannot inactivate your own account', 400);
    }

    if (updates.is_active === false && user.is_active && isTargetSystemAdmin) {
      const activeAdmins = await User.count({
        where: { is_active: true },
        include: [{ model: Role, as: 'role', where: { name: 'system_admin' }, required: true }],
      });
      if (activeAdmins <= 1) {
        return error(res, 'At least one active system administrator is required', 400);
      }
    }

    if (updates.role_id && !isTargetSystemAdmin) {
      const facility = await Facility.findByPk(user.facility_id);
      const role = await resolveRoleById(updates.role_id);
      if (!role) return error(res, 'Role not found', 404);
      if (!isRoleAllowedAtFacility(role.name, facility)) {
        const label = isClinicFacility(facility) ? 'clinic' : 'state hospital';
        return error(
          res,
          `The selected role is not authorized at this ${label}. Choose a role available at the assigned facility.`,
          400
        );
      }
    }

    // Password reset (not for system admin accounts via this endpoint)
    if (req.body.password && !isTargetSystemAdmin) {
      updates.password_hash = await bcrypt.hash(req.body.password, 10);
    }

    if (updates.is_active === false && user.is_active) {
      await RefreshToken.update(
        { revoked: true },
        { where: { user_id: user.id, revoked: false } }
      );
    }

    await user.update(updates);
    const result = user.toJSON();
    delete result.password_hash;

    return success(res, result, 'User updated');
  } catch (err) {
    return error(res, 'Failed to update user', 500);
  }
};

exports.transferEmployee = async (req, res) => {
  try {
    if (!isSystemAdmin(req)) {
      return error(res, 'Only system administrators can transfer employees between facilities', 403);
    }

    const user = await User.findByPk(req.params.id, {
      include: [
        { model: Role, as: 'role', attributes: ['id', 'name', 'display_name'] },
        { model: Facility, as: 'facility', attributes: ['id', 'name', 'type'] },
      ],
    });
    if (!user) return error(res, 'User not found', 404);

    if (user.role?.name === 'system_admin') {
      return error(res, 'System administrators cannot be transferred between facilities', 400);
    }

    const { facility_id: targetFacilityId, role_id: newRoleId, notes } = req.body;
    if (!targetFacilityId) {
      return error(res, 'facility_id is required', 400);
    }

    const targetFacility = await Facility.findByPk(targetFacilityId);
    if (!targetFacility) return error(res, 'Target facility not found', 404);

    if (targetFacilityId === user.facility_id) {
      return error(res, 'Employee is already assigned to this facility', 400);
    }

    if (!newRoleId) {
      return error(res, 'role_id is required — select a role for the destination facility', 400);
    }

    const transferNotes = typeof notes === 'string' ? notes.trim() : '';
    if (!transferNotes) {
      return error(res, 'Transfer notes are required', 400);
    }

    const targetRole = await resolveRoleById(newRoleId);
    if (!targetRole) return error(res, 'Role not found', 404);

    if (!isRoleAllowedAtFacility(targetRole.name, targetFacility)) {
      const facilityLabel = isClinicFacility(targetFacility)
        ? 'clinic'
        : targetFacility.type.replace('_', ' ');
      return error(
        res,
        `The selected role is not authorized at this ${facilityLabel}. Choose a role available at the destination facility.`,
        400
      );
    }

    const resolvedRoleId = newRoleId;

    const now = new Date();

    await sequelize.transaction(async (transaction) => {
      let openAssignment = await openAssignmentForUser(user.id, transaction);
      if (!openAssignment) {
        openAssignment = await recordFacilityAssignment({
          userId: user.id,
          facilityId: user.facility_id,
          roleId: user.role_id,
          startedAt: user.created_at || now,
          notes: 'Assignment opened before transfer',
          transaction,
        });
      }

      await openAssignment.update({ ended_at: now }, { transaction });

      await user.update({
        facility_id: targetFacilityId,
        role_id: resolvedRoleId,
      }, { transaction });

      await recordFacilityAssignment({
        userId: user.id,
        facilityId: targetFacilityId,
        roleId: resolvedRoleId,
        startedAt: now,
        transferredBy: req.user.id,
        notes: transferNotes,
        transaction,
      });
    });

    const result = await User.findByPk(user.id, {
      attributes: { exclude: ['password_hash'] },
      include: [
        { model: Role, as: 'role', attributes: ['id', 'name', 'display_name'] },
        { model: Facility, as: 'facility', attributes: ['id', 'name', 'type'] },
      ],
    });

    return success(res, result, 'Employee transferred successfully');
  } catch (err) {
    console.error('transferEmployee error:', err);
    return error(res, 'Failed to transfer employee', 500);
  }
};

exports.getEmployeeFacilityHistory = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return error(res, 'User not found', 404);

    if (!isSystemAdmin(req) && user.facility_id !== req.user.facility_id) {
      return error(res, 'Access denied', 403);
    }

    const history = await EmployeeFacilityAssignment.findAll({
      where: { user_id: req.params.id },
      include: [
        { model: Facility, as: 'facility', attributes: ['id', 'name', 'type'] },
        { model: Role, as: 'role', attributes: ['id', 'name', 'display_name'] },
        {
          model: User,
          as: 'transferredBy',
          attributes: ['id', 'first_name', 'last_name'],
        },
      ],
      order: [['started_at', 'DESC']],
    });

    return success(res, history);
  } catch (err) {
    console.error('getEmployeeFacilityHistory error:', err);
    return error(res, 'Failed to fetch facility history', 500);
  }
};

exports.getRoles = async (req, res) => {
  try {
    await ensureRolesSynced();

    const where = {};
    if (isSystemAdmin(req)) {
      where.name = { [Op.notIn]: ['system_admin', 'executive'] };
    }

    const { facility_id: facilityId, context } = req.query;

    if (facilityId) {
      const facility = await Facility.findByPk(facilityId);
      if (!facility) return error(res, 'Facility not found', 404);
      let allowedSlugs = getAllowedRoleSlugsForFacility(facility);
      if (isClinicFacility(facility)) {
        const activeDeptKeys = await getActiveDepartmentKeys(facilityId);
        if (activeDeptKeys.length) {
          allowedSlugs = allowedSlugs.filter((slug) => activeDeptKeys.includes(slug));
        }
      }
      where.name = { [Op.in]: allowedSlugs };
    } else if (context === 'clinic') {
      where.name = { [Op.in]: CLINIC_ROLE_SLUGS };
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
      include: [{
        model: User,
        as: 'user',
        attributes: ['id', 'first_name', 'last_name', 'email'],
      }],
    });

    const data = rows.map((row) => {
      const plain = row.toJSON();
      const userName = plain.user
        ? [plain.user.first_name, plain.user.last_name].filter(Boolean).join(' ').trim()
        : null;
      return {
        id: plain.id,
        user_id: plain.user_id,
        user_name: userName || null,
        user_email: plain.user?.email || null,
        action: plain.action,
        resource: plain.resource,
        resource_id: plain.resource_id,
        details: plain.details,
        ip_address: plain.ip_address,
        timestamp: plain.timestamp,
      };
    });

    return paginated(res, data, count, page, limit);
  } catch (err) {
    return error(res, 'Failed to fetch audit logs', 500);
  }
};

// === ADMIN DASHBOARD ===

exports.getDashboard = async (req, res) => {
  try {
    if (isSystemAdmin(req)) {
      const { facility_id: facilityId } = req.query;
      let selectedFacility = null;

      if (facilityId) {
        selectedFacility = await Facility.findOne({
          where: {
            id: facilityId,
            name: { [Op.ne]: NATIONAL_ADMIN_FACILITY_NAME },
          },
          attributes: ['id', 'name', 'type', 'province', 'district'],
        });
        if (!selectedFacility) return error(res, 'Facility not found', 404);
      }

      const nationalOfficeId = await getNationalOfficeFacilityId();
      const operationalFacilityWhere = nationalOfficeId
        ? { id: { [Op.ne]: nationalOfficeId } }
        : { name: { [Op.ne]: NATIONAL_ADMIN_FACILITY_NAME } };

      const staffBaseWhere = selectedFacility
        ? { facility_id: selectedFacility.id }
        : (nationalOfficeId ? { facility_id: { [Op.ne]: nationalOfficeId } } : {});

      const visitScopeWhere = selectedFacility
        ? { facility_id: selectedFacility.id }
        : {};

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [
        totalFacilities,
        activeEmployees,
        inactiveEmployees,
        pendingShiftReviews,
        openSocialCases,
        totalPatients,
        todayVisits,
        facilitySummaries,
        analytics,
      ] = await Promise.all([
        Facility.count({ where: operationalFacilityWhere }),
        User.count({
          where: { ...staffBaseWhere, is_active: true },
          include: [{
            model: Role,
            as: 'role',
            where: { name: { [Op.ne]: 'system_admin' } },
            required: true,
          }],
        }),
        User.count({
          where: { ...staffBaseWhere, is_active: false },
          include: [{
            model: Role,
            as: 'role',
            where: { name: { [Op.ne]: 'system_admin' } },
            required: true,
          }],
        }),
        RevenueShift.count({
          where: {
            status: { [Op.in]: ['closed', 'discrepancy'] },
            reconciled_by: null,
            ...(selectedFacility ? { facility_id: selectedFacility.id } : {}),
          },
        }),
        SocialWorkerCase.count({ where: { status: { [Op.in]: ['open', 'in_progress'] } } }),
        selectedFacility
          ? sequelize.query(
            `SELECT COUNT(DISTINCT p.id) AS count FROM patients p
             INNER JOIN visits v ON v.patient_id = p.id
             WHERE v.facility_id = :facilityId`,
            { replacements: { facilityId: selectedFacility.id } }
          ).then(([rows]) => parseInt(rows[0]?.count, 10) || 0)
          : Patient.count(),
        Visit.count({
          where: {
            ...visitScopeWhere,
            created_at: { [Op.gte]: today },
          },
        }),
        fetchFacilitySummaries(),
        fetchDashboardAnalytics(selectedFacility?.id || null),
      ]);

      return success(res, {
        scope: selectedFacility ? 'facility' : 'facilities',
        selectedFacility: selectedFacility ? {
          id: selectedFacility.id,
          name: selectedFacility.name,
          type: selectedFacility.type,
          type_label: FACILITY_TYPE_LABELS[selectedFacility.type] || selectedFacility.type,
          location: [selectedFacility.district, selectedFacility.province].filter(Boolean).join(', ') || '—',
        } : null,
        totalFacilities,
        activeEmployees,
        inactiveEmployees,
        pendingRequests: pendingShiftReviews + openSocialCases,
        pendingShiftReviews,
        openSocialCases,
        totalPatients,
        todayVisits,
        facilitySummaries,
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
