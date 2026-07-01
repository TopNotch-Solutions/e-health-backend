'use strict';

const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const {
  User,
  Role,
  Visit,
  QueueEntry,
  Facility,
  FacilityDepartment,
  FacilityDepartmentChange,
  sequelize,
} = require('../models');
const {
  CLINIC_DEPARTMENT_DEFINITIONS,
  DEPARTMENT_BY_KEY,
  departmentLabel,
  isValidDepartmentKey,
  isFoundationDepartment,
  resolveTemplateKeys,
  getRequiredDepartment,
  getCascadeRemovals,
  FOUNDATION_CLINIC_DEPARTMENT_KEYS,
  MINIMAL_CLINIC_TEMPLATE_KEYS,
  FULL_CLINIC_TEMPLATE_KEYS,
} = require('../config/clinicFacilityDepartments');
const {
  HOSPITAL_DEPARTMENT_DEFINITIONS,
  HOSPITAL_DEPARTMENT_BY_KEY,
  hospitalDepartmentLabel,
  isValidHospitalDepartmentKey,
  isFoundationHospitalDepartment,
  resolveHospitalTemplateKeys,
  getHospitalRequiredDepartment,
  getHospitalCascadeRemovals,
  FOUNDATION_HOSPITAL_DEPARTMENT_KEYS,
  FULL_HOSPITAL_TEMPLATE_KEYS,
  buildHospitalFrontOfficeRouting,
} = require('../config/hospitalFacilityDepartments');
const { isClinicFacility, isHospitalFacility } = require('../config/clinicRoles');

function departmentDefsForFacility(facility) {
  return isHospitalFacility(facility) ? HOSPITAL_DEPARTMENT_DEFINITIONS : CLINIC_DEPARTMENT_DEFINITIONS;
}

function departmentByKeyForFacility(facility) {
  return isHospitalFacility(facility) ? HOSPITAL_DEPARTMENT_BY_KEY : DEPARTMENT_BY_KEY;
}

function labelForDepartmentKey(key, facility) {
  if (isHospitalFacility(facility)) return hospitalDepartmentLabel(key);
  return departmentLabel(key);
}

function isValidDepartmentKeyForFacility(key, facility) {
  if (isHospitalFacility(facility)) return isValidHospitalDepartmentKey(key);
  return isValidDepartmentKey(key);
}

function isFoundationDepartmentForFacility(key, facility) {
  if (isHospitalFacility(facility)) return isFoundationHospitalDepartment(key);
  return isFoundationDepartment(key);
}

function getRequiredDepartmentForFacility(key, facility) {
  if (isHospitalFacility(facility)) return getHospitalRequiredDepartment(key);
  return getRequiredDepartment(key);
}

function getCascadeRemovalsForFacility(key, facility) {
  if (isHospitalFacility(facility)) return getHospitalCascadeRemovals(key);
  return getCascadeRemovals(key);
}

function facilityTypeLabel(facility) {
  return isHospitalFacility(facility) ? 'hospital' : 'clinic';
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function seedDepartmentsForFacility(facilityId, departmentKeys, transaction) {
  const facility = await Facility.findByPk(facilityId, { transaction });
  const uniqueKeys = [...new Set(departmentKeys.filter((key) => isValidDepartmentKeyForFacility(key, facility)))];
  const created = [];

  for (const key of uniqueKeys) {
    const [row] = await FacilityDepartment.findOrCreate({
      where: { facility_id: facilityId, department_key: key },
      defaults: {
        id: uuidv4(),
        facility_id: facilityId,
        department_key: key,
        is_active: true,
      },
      transaction,
    });
    if (!row.is_active) {
      await row.update({ is_active: true }, { transaction });
    }
    created.push(row);
  }

  return created;
}

async function getActiveDepartmentKeys(facilityId) {
  const rows = await FacilityDepartment.findAll({
    where: { facility_id: facilityId, is_active: true },
    attributes: ['department_key'],
    order: [['department_key', 'ASC']],
  });
  return rows.map((r) => r.department_key);
}

async function getActiveQueueDepartmentsForFacility(facilityId) {
  const facility = await Facility.findByPk(facilityId);
  if (!facility || (!isClinicFacility(facility) && !isHospitalFacility(facility))) return null;

  const keys = await getActiveDepartmentKeys(facilityId);
  const byKey = departmentByKeyForFacility(facility);
  const queues = new Set();
  for (const key of keys) {
    const def = byKey[key];
    if (def?.queue_department) queues.add(def.queue_department);
  }
  return queues;
}

async function getHospitalFrontOfficeRoutingForFacility(facilityId) {
  const facility = await Facility.findByPk(facilityId);
  if (!facility || !isHospitalFacility(facility)) return [];
  const keys = await getActiveDepartmentKeys(facilityId);
  return buildHospitalFrontOfficeRouting(keys);
}

async function assertQueueDepartmentActiveAtFacility(facilityId, queueDepartment) {
  const facility = await Facility.findByPk(facilityId);
  if (!facility) return;

  if (isClinicFacility(facility)) {
    const activeQueues = await getActiveQueueDepartmentsForFacility(facilityId);
    if (!activeQueues) return;
    if (!queueDepartment || !activeQueues.has(queueDepartment)) {
      const { routingLabel } = require('../config/clinicQueueDepartments');
      const label = routingLabel(queueDepartment) || queueDepartment;
      const err = new Error(
        `${label} is not an active department at this clinic. Ask system administration to add the department first.`
      );
      err.statusCode = 400;
      throw err;
    }
    return;
  }

  if (isHospitalFacility(facility)) {
    const activeQueues = await getActiveQueueDepartmentsForFacility(facilityId);
    if (!activeQueues) return;
    if (!queueDepartment || !activeQueues.has(queueDepartment)) {
      const { routingLabel } = require('../config/clinicQueueDepartments');
      const { hospitalFrontOfficeRoutingLabel } = require('../config/hospitalFrontOfficeConfig');
      const label = hospitalFrontOfficeRoutingLabel(queueDepartment)
        || routingLabel(queueDepartment)
        || queueDepartment;
      const err = new Error(
        `${label} is not an active department at this hospital. Ask system administration to add the department first.`
      );
      err.statusCode = 400;
      throw err;
    }
  }
}

async function getFacilityDepartmentChangeHistory(facilityId, limit = 100) {
  const facility = await Facility.findByPk(facilityId);
  const changes = await FacilityDepartmentChange.findAll({
    where: { facility_id: facilityId },
    include: [{
      model: User,
      as: 'changedBy',
      attributes: ['id', 'first_name', 'last_name'],
    }],
    order: [['created_at', 'DESC']],
    limit,
  });

  return changes.map((c) => ({
    id: c.id,
    department_key: c.department_key,
    department_label: labelForDepartmentKey(c.department_key, facility),
    action: c.action,
    reason: c.reason,
    created_at: c.created_at,
    changed_by: c.changedBy
      ? `${c.changedBy.first_name} ${c.changedBy.last_name}`.trim()
      : '—',
  }));
}

async function getFacilityDepartmentsSummary(facilityId) {
  const facility = await Facility.findByPk(facilityId);
  if (!facility) return null;

  const deptRows = await FacilityDepartment.findAll({
    where: { facility_id: facilityId, is_active: true },
    order: [['department_key', 'ASC']],
  });

  const roleRows = await Role.findAll({
    where: { name: { [Op.in]: deptRows.map((d) => d.department_key) } },
    attributes: ['id', 'name'],
  });
  const roleIdByName = Object.fromEntries(roleRows.map((r) => [r.name, r.id]));

  const staffCounts = await User.findAll({
    where: {
      facility_id: facilityId,
      is_active: true,
      role_id: { [Op.in]: roleRows.map((r) => r.id) },
    },
    attributes: ['role_id', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['role_id'],
    raw: true,
  });
  const countByRoleId = Object.fromEntries(
    staffCounts.map((r) => [r.role_id, parseInt(r.count, 10) || 0])
  );

  const byKey = departmentByKeyForFacility(facility);
  const departments = deptRows.map((row) => {
    const def = byKey[row.department_key];
    const roleId = roleIdByName[row.department_key];
    return {
      id: row.id,
      department_key: row.department_key,
      label: def?.label || labelForDepartmentKey(row.department_key, facility),
      employee_count: roleId ? (countByRoleId[roleId] || 0) : 0,
      activity_mode: def?.activity_mode || 'queue',
      is_foundation: isFoundationDepartmentForFacility(row.department_key, facility),
    };
  });

  const change_history = (isClinicFacility(facility) || isHospitalFacility(facility))
    ? await getFacilityDepartmentChangeHistory(facilityId)
    : [];

  return {
    facility: {
      id: facility.id,
      name: facility.name,
      type: facility.type,
      province: facility.province,
      district: facility.district,
      address: facility.address,
      phone: facility.phone,
    },
    departments,
    total_employees: departments.reduce((sum, d) => sum + d.employee_count, 0),
    change_history,
  };
}

async function recordDepartmentChange({
  facilityId,
  departmentKey,
  action,
  reason,
  changedBy,
  transaction,
}) {
  await FacilityDepartmentChange.create({
    id: uuidv4(),
    facility_id: facilityId,
    department_key: departmentKey,
    action,
    reason: reason.trim(),
    changed_by: changedBy,
  }, { transaction });
}

async function deactivateDepartmentIfActive({
  facilityId,
  departmentKey,
  reason,
  changedBy,
  transaction,
}) {
  const existing = await FacilityDepartment.findOne({
    where: { facility_id: facilityId, department_key: departmentKey, is_active: true },
    transaction,
  });
  if (!existing) return false;

  await existing.update({ is_active: false }, { transaction });
  await recordDepartmentChange({
    facilityId,
    departmentKey,
    action: 'removed',
    reason,
    changedBy,
    transaction,
  });
  return true;
}

function sortDepartmentsForAddition(keys, facility) {
  const unique = [...new Set(keys)];
  return unique.sort((a, b) => {
    const reqA = getRequiredDepartmentForFacility(a, facility);
    const reqB = getRequiredDepartmentForFacility(b, facility);
    if (reqA === b) return 1;
    if (reqB === a) return -1;
    return 0;
  });
}

async function addSingleDepartmentInTransaction({
  facilityId,
  facility,
  departmentKey,
  reason,
  changedBy,
  batchSet,
  transaction,
}) {
  const existing = await FacilityDepartment.findOne({
    where: { facility_id: facilityId, department_key: departmentKey },
    transaction,
  });

  if (existing?.is_active) {
    const err = new Error(`${labelForDepartmentKey(departmentKey, facility)} is already active at this ${facilityTypeLabel(facility)}`);
    err.statusCode = 409;
    throw err;
  }

  const requiredParent = getRequiredDepartmentForFacility(departmentKey, facility);
  if (requiredParent) {
    const parentInBatch = batchSet?.has(requiredParent);
    if (!parentInBatch) {
      const parentActive = await FacilityDepartment.findOne({
        where: { facility_id: facilityId, department_key: requiredParent, is_active: true },
        transaction,
      });
      if (!parentActive) {
        const err = new Error(
          `${labelForDepartmentKey(departmentKey, facility)} requires ${labelForDepartmentKey(requiredParent, facility)} to be active at this ${facilityTypeLabel(facility)}`
        );
        err.statusCode = 400;
        throw err;
      }
    }
  }

  if (existing) {
    await existing.update({ is_active: true }, { transaction });
  } else {
    await FacilityDepartment.create({
      id: uuidv4(),
      facility_id: facilityId,
      department_key: departmentKey,
      is_active: true,
    }, { transaction });
  }

  await recordDepartmentChange({
    facilityId,
    departmentKey,
    action: 'added',
    reason,
    changedBy,
    transaction,
  });
}

async function addDepartments(facilityId, departmentKeys, reason, changedBy) {
  if (!Array.isArray(departmentKeys) || !departmentKeys.length) {
    const err = new Error('Select at least one department');
    err.statusCode = 400;
    throw err;
  }
  if (!reason?.trim()) {
    const err = new Error('A reason is required when adding departments');
    err.statusCode = 400;
    throw err;
  }

  const uniqueKeys = [...new Set(departmentKeys)];
  const facility = await Facility.findByPk(facilityId);
  if (!facility || (!isClinicFacility(facility) && !isHospitalFacility(facility))) {
    const err = new Error('Departments can only be managed for clinic or hospital facilities');
    err.statusCode = 400;
    throw err;
  }

  for (const key of uniqueKeys) {
    if (!isValidDepartmentKeyForFacility(key, facility)) {
      const err = new Error(`Invalid ${facilityTypeLabel(facility)} department: ${key}`);
      err.statusCode = 400;
      throw err;
    }
  }

  const batchSet = new Set(uniqueKeys);
  const sortedKeys = sortDepartmentsForAddition(uniqueKeys, facility);

  const t = await sequelize.transaction();
  try {
    for (const departmentKey of sortedKeys) {
      await addSingleDepartmentInTransaction({
        facilityId,
        facility,
        departmentKey,
        reason: reason.trim(),
        changedBy,
        batchSet,
        transaction: t,
      });
    }
    await t.commit();
    return getFacilityDepartmentsSummary(facilityId);
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }
}

async function addDepartment(facilityId, departmentKey, reason, changedBy) {
  return addDepartments(facilityId, [departmentKey], reason, changedBy);
}

async function removeDepartments(facilityId, departmentKeys, reason, changedBy) {
  if (!Array.isArray(departmentKeys) || !departmentKeys.length) {
    const err = new Error('Select at least one department');
    err.statusCode = 400;
    throw err;
  }
  if (!reason?.trim()) {
    const err = new Error('A reason is required when removing departments');
    err.statusCode = 400;
    throw err;
  }

  const requested = [...new Set(departmentKeys)];
  const facility = await Facility.findByPk(facilityId);
  if (!facility || (!isClinicFacility(facility) && !isHospitalFacility(facility))) {
    const err = new Error('Departments can only be managed for clinic or hospital facilities');
    err.statusCode = 400;
    throw err;
  }

  for (const key of requested) {
    if (!isValidDepartmentKeyForFacility(key, facility)) {
      const err = new Error(`Invalid ${facilityTypeLabel(facility)} department: ${key}`);
      err.statusCode = 400;
      throw err;
    }
    if (isFoundationDepartmentForFacility(key, facility)) {
      const err = new Error(
        `${labelForDepartmentKey(key, facility)} is a foundation department and cannot be removed`
      );
      err.statusCode = 400;
      throw err;
    }
  }

  const requestedSet = new Set(requested);
  const t = await sequelize.transaction();
  try {
    const trimmedReason = reason.trim();

    for (const departmentKey of requested) {
      const active = await FacilityDepartment.findOne({
        where: { facility_id: facilityId, department_key: departmentKey, is_active: true },
        transaction: t,
      });
      if (!active) {
        await t.rollback();
        const err = new Error(`${labelForDepartmentKey(departmentKey, facility)} is not active at this ${facilityTypeLabel(facility)}`);
        err.statusCode = 404;
        throw err;
      }
    }

    for (const departmentKey of requested) {
      await deactivateDepartmentIfActive({
        facilityId,
        departmentKey,
        reason: trimmedReason,
        changedBy,
        transaction: t,
      });

      for (const cascadeKey of getCascadeRemovalsForFacility(departmentKey, facility)) {
        if (requestedSet.has(cascadeKey)) continue;
        const cascadeReason = `${trimmedReason} (auto-removed with ${labelForDepartmentKey(departmentKey, facility)}: billing clerks are overseen by the Revenue Office)`;
        await deactivateDepartmentIfActive({
          facilityId,
          departmentKey: cascadeKey,
          reason: cascadeReason,
          changedBy,
          transaction: t,
        });
      }
    }

    await t.commit();
    return getFacilityDepartmentsSummary(facilityId);
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }
}

async function removeDepartment(facilityId, departmentKey, reason, changedBy) {
  return removeDepartments(facilityId, [departmentKey], reason, changedBy);
}

async function getEmployeeActivityStats(userId, departmentKey, facilityId) {
  const facility = await Facility.findByPk(facilityId);
  const def = departmentByKeyForFacility(facility)[departmentKey];
  const since14d = daysAgo(14);
  const today = startOfToday();

  const user = await User.findByPk(userId, {
    include: [{ model: Role, as: 'role', attributes: ['id', 'name', 'display_name'] }],
  });
  if (!user || user.facility_id !== facilityId) return null;

  let patients_served_today = 0;
  let patients_served_14d = 0;
  let in_progress = 0;

  if (def?.activity_mode === 'intake') {
    const [visitsToday, visits14d, pushedToday, pushed14d] = await Promise.all([
      Visit.count({ where: { facility_id: facilityId, created_by: userId, created_at: { [Op.gte]: today } } }),
      Visit.count({ where: { facility_id: facilityId, created_by: userId, created_at: { [Op.gte]: since14d } } }),
      QueueEntry.count({
        where: { pushed_by: userId, created_at: { [Op.gte]: today } },
        include: [{ model: Visit, as: 'visit', where: { facility_id: facilityId }, attributes: [] }],
      }),
      QueueEntry.count({
        where: { pushed_by: userId, created_at: { [Op.gte]: since14d } },
        include: [{ model: Visit, as: 'visit', where: { facility_id: facilityId }, attributes: [] }],
      }),
    ]);
    patients_served_today = visitsToday + pushedToday;
    patients_served_14d = visits14d + pushed14d;
  } else if (def?.queue_department) {
    const baseInclude = [{
      model: Visit,
      as: 'visit',
      where: { facility_id: facilityId },
      attributes: [],
    }];
    [patients_served_today, patients_served_14d, in_progress] = await Promise.all([
      QueueEntry.count({
        where: {
          department: def.queue_department,
          assigned_to: userId,
          status: 'completed',
          completed_at: { [Op.gte]: today },
        },
        include: baseInclude,
      }),
      QueueEntry.count({
        where: {
          department: def.queue_department,
          assigned_to: userId,
          status: 'completed',
          completed_at: { [Op.gte]: since14d },
        },
        include: baseInclude,
      }),
      QueueEntry.count({
        where: {
          department: def.queue_department,
          assigned_to: userId,
          status: 'in_progress',
        },
        include: baseInclude,
      }),
    ]);
  }

  return {
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    is_active: user.is_active,
    role: user.role?.display_name || user.role?.name || departmentKey,
    last_login: user.last_login,
    patients_served_today,
    patients_served_14d,
    in_progress,
  };
}

async function getDepartmentDetail(facilityId, departmentKey) {
  const facility = await Facility.findByPk(facilityId);
  if (!facility) {
    const err = new Error('Facility not found');
    err.statusCode = 404;
    throw err;
  }
  if (!isValidDepartmentKeyForFacility(departmentKey, facility)) {
    const err = new Error(`Invalid ${facilityTypeLabel(facility)} department`);
    err.statusCode = 400;
    throw err;
  }

  const active = await FacilityDepartment.findOne({
    where: { facility_id: facilityId, department_key: departmentKey, is_active: true },
  });
  if (!active) {
    const err = new Error(`Department not found at this ${facilityTypeLabel(facility)}`);
    err.statusCode = 404;
    throw err;
  }

  const def = departmentByKeyForFacility(facility)[departmentKey];
  const role = await Role.findOne({ where: { name: departmentKey }, attributes: ['id', 'name', 'display_name'] });

  const employees = role
    ? await User.findAll({
      where: { facility_id: facilityId, role_id: role.id },
      order: [['last_name', 'ASC'], ['first_name', 'ASC']],
    })
    : [];

  const employeeStats = await Promise.all(
    employees.map((emp) => getEmployeeActivityStats(emp.id, departmentKey, facilityId))
  );

  const changes = await FacilityDepartmentChange.findAll({
    where: { facility_id: facilityId, department_key: departmentKey },
    include: [{
      model: User,
      as: 'changedBy',
      attributes: ['id', 'first_name', 'last_name'],
    }],
    order: [['created_at', 'DESC']],
    limit: 20,
  });

  const stats = employeeStats.reduce(
    (acc, e) => ({
      patients_served_today: acc.patients_served_today + (e?.patients_served_today || 0),
      patients_served_14d: acc.patients_served_14d + (e?.patients_served_14d || 0),
      in_progress: acc.in_progress + (e?.in_progress || 0),
    }),
    { patients_served_today: 0, patients_served_14d: 0, in_progress: 0 }
  );

  return {
    department_key: departmentKey,
    label: def?.label || labelForDepartmentKey(departmentKey, facility),
    activity_mode: def?.activity_mode || 'queue',
    queue_department: def?.queue_department || null,
    employee_count: employees.length,
    active_employee_count: employees.filter((e) => e.is_active).length,
    stats,
    employees: employeeStats.filter(Boolean),
    change_history: changes.map((c) => ({
      id: c.id,
      action: c.action,
      reason: c.reason,
      created_at: c.created_at,
      changed_by: c.changedBy
        ? `${c.changedBy.first_name} ${c.changedBy.last_name}`.trim()
        : '—',
    })),
  };
}

module.exports = {
  CLINIC_DEPARTMENT_DEFINITIONS,
  FOUNDATION_CLINIC_DEPARTMENT_KEYS,
  MINIMAL_CLINIC_TEMPLATE_KEYS,
  FULL_CLINIC_TEMPLATE_KEYS,
  HOSPITAL_DEPARTMENT_DEFINITIONS,
  FOUNDATION_HOSPITAL_DEPARTMENT_KEYS,
  FULL_HOSPITAL_TEMPLATE_KEYS,
  resolveHospitalTemplateKeys,
  isFoundationHospitalDepartment,
  getHospitalRequiredDepartment,
  getHospitalCascadeRemovals,
  isFoundationDepartment,
  getRequiredDepartment,
  getCascadeRemovals,
  resolveTemplateKeys,
  seedDepartmentsForFacility,
  getActiveDepartmentKeys,
  getActiveQueueDepartmentsForFacility,
  getHospitalFrontOfficeRoutingForFacility,
  assertQueueDepartmentActiveAtFacility,
  getFacilityDepartmentsSummary,
  getFacilityDepartmentChangeHistory,
  addDepartment,
  addDepartments,
  removeDepartment,
  removeDepartments,
  getDepartmentDetail,
};
