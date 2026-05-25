const { User, Role, Visit, Patient, sequelize } = require('../models');
const { Op } = require('sequelize');
const { ROLES } = require('../config/roles');

const VISIT_TYPE_LABELS = {
  new: 'New registration',
  follow_up: 'Returning check-in',
  emergency: 'Emergency',
};

const VISIT_TYPE_COLORS = {
  new: '#0d9488',
  follow_up: '#0284c7',
  emergency: '#e11d48',
};

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function buildHourlySlots() {
  const endHour = new Date().getHours();
  const slots = [];
  for (let h = 0; h <= endHour; h += 1) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
  }
  return slots;
}

function mapHourlyCounts(rows, hourKey = 'hour', countKey = 'count') {
  const byHour = {};
  for (const row of rows) {
    const h = Number(row[hourKey]);
    if (!Number.isNaN(h)) byHour[h] = Number(row[countKey]) || 0;
  }
  return byHour;
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function staffDisplayName(row) {
  return [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || 'Staff';
}

/**
 * Front office supervisor analytics: daily registrations, staff activity, visit mix.
 */
async function getSupervisorMetrics(facilityId) {
  const today = startOfDay();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayEnd = endOfDay(yesterday);

  const hourSlots = buildHourlySlots();
  const visitToday = {
    facility_id: facilityId,
    created_at: { [Op.gte]: today, [Op.lt]: tomorrow },
  };

  const [
    processedToday,
    processedYesterday,
    newRegistrationsToday,
    returningToday,
    emergencyToday,
    visitHourRows,
    visitTypeRows,
    paymentRows,
    employeeRows,
    recentVisits,
    frontOfficeStaffCount,
  ] = await Promise.all([
    Visit.count({ where: visitToday }),
    Visit.count({
      where: {
        facility_id: facilityId,
        created_at: { [Op.gte]: yesterday, [Op.lte]: yesterdayEnd },
      },
    }),
    Visit.count({ where: { ...visitToday, visit_type: 'new' } }),
    Visit.count({ where: { ...visitToday, visit_type: 'follow_up' } }),
    Visit.count({ where: { ...visitToday, visit_type: 'emergency' } }),
    sequelize.query(
      `
      SELECT HOUR(created_at) AS hour, COUNT(*) AS count
      FROM visits
      WHERE facility_id = :facilityId
        AND created_at >= :today AND created_at < :tomorrow
      GROUP BY HOUR(created_at)
      `,
      { replacements: { facilityId, today, tomorrow }, type: sequelize.QueryTypes.SELECT }
    ),
    sequelize.query(
      `
      SELECT visit_type AS type, COUNT(*) AS count
      FROM visits
      WHERE facility_id = :facilityId
        AND created_at >= :today AND created_at < :tomorrow
      GROUP BY visit_type
      `,
      { replacements: { facilityId, today, tomorrow }, type: sequelize.QueryTypes.SELECT }
    ),
    sequelize.query(
      `
      SELECT p.payment_type AS type, COUNT(*) AS count
      FROM visits v
      INNER JOIN patients p ON p.id = v.patient_id
      WHERE v.facility_id = :facilityId
        AND v.created_at >= :today AND v.created_at < :tomorrow
      GROUP BY p.payment_type
      `,
      { replacements: { facilityId, today, tomorrow }, type: sequelize.QueryTypes.SELECT }
    ),
    sequelize.query(
      `
      SELECT
        u.id AS user_id,
        u.first_name,
        u.last_name,
        u.employee_id,
        MIN(v.created_at) AS first_activity_at,
        SUM(CASE WHEN v.visit_type = 'new' THEN 1 ELSE 0 END) AS new_registrations,
        SUM(CASE WHEN v.visit_type = 'follow_up' THEN 1 ELSE 0 END) AS returning_checkins,
        SUM(CASE WHEN v.visit_type = 'emergency' THEN 1 ELSE 0 END) AS emergency_visits,
        COUNT(v.id) AS total_processed
      FROM users u
      INNER JOIN roles r ON r.id = u.role_id AND r.name = :frontOfficeRole
      LEFT JOIN visits v ON v.created_by = u.id
        AND v.facility_id = :facilityId
        AND v.created_at >= :today AND v.created_at < :tomorrow
      WHERE u.facility_id = :facilityId AND u.is_active = 1
      GROUP BY u.id, u.first_name, u.last_name, u.employee_id
      ORDER BY first_activity_at IS NULL, first_activity_at ASC, total_processed DESC
      `,
      {
        replacements: {
          facilityId,
          today,
          tomorrow,
          frontOfficeRole: ROLES.FRONT_OFFICE,
        },
        type: sequelize.QueryTypes.SELECT,
      }
    ),
    Visit.findAll({
      where: visitToday,
      include: [
        {
          model: Patient,
          as: 'patient',
          attributes: ['first_name', 'last_name', 'patient_number', 'is_emergency', 'category'],
        },
        {
          model: User,
          as: 'createdBy',
          attributes: ['id', 'first_name', 'last_name', 'employee_id'],
        },
      ],
      order: [['created_at', 'DESC']],
      limit: 20,
    }),
    User.count({
      where: { facility_id: facilityId, is_active: true },
      include: [
        {
          model: Role,
          as: 'role',
          required: true,
          where: { name: ROLES.FRONT_OFFICE },
        },
      ],
    }),
  ]);

  const visitByHour = mapHourlyCounts(visitHourRows);
  const registrationVelocity = hourSlots.map((hour) => {
    const h = parseInt(hour.slice(0, 2), 10);
    return { hour, count: visitByHour[h] || 0 };
  });

  const visitsByType = visitTypeRows.map((row) => ({
    name: VISIT_TYPE_LABELS[row.type] || row.type,
    value: Number(row.count) || 0,
    fill: VISIT_TYPE_COLORS[row.type] || '#64748b',
  }));

  const paymentLabels = { state: 'State', private: 'Private' };
  const visitsByPayment = paymentRows.map((row) => ({
    name: paymentLabels[row.type] || row.type,
    value: Number(row.count) || 0,
  }));

  const employeesToday = employeeRows.map((row) => ({
    userId: row.user_id,
    name: staffDisplayName(row),
    employeeId: row.employee_id || '—',
    firstActivityAt: row.first_activity_at,
    firstActivityTime: formatTime(row.first_activity_at),
    newRegistrations: Number(row.new_registrations) || 0,
    returningCheckins: Number(row.returning_checkins) || 0,
    emergencyVisits: Number(row.emergency_visits) || 0,
    totalProcessed: Number(row.total_processed) || 0,
    hasStartedToday: Boolean(row.first_activity_at),
  }));

  const staffActiveToday = employeesToday.filter((e) => e.hasStartedToday).length;

  const recentActivity = recentVisits.map((v) => {
    const p = v.patient || {};
    const staff = v.createdBy || {};
    return {
      visitId: v.id,
      visitNumber: v.visit_number,
      visitType: v.visit_type,
      visitTypeLabel: VISIT_TYPE_LABELS[v.visit_type] || v.visit_type,
      processedAt: v.created_at,
      processedTime: formatTime(v.created_at),
      patientName: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || 'Patient',
      patientNumber: p.patient_number,
      isEmergency: Boolean(p.is_emergency),
      staffName: [staff.first_name, staff.last_name].filter(Boolean).join(' ').trim() || 'Staff',
      staffEmployeeId: staff.employee_id,
    };
  });

  return {
    kpis: {
      processedToday,
      processedYesterday,
      newRegistrationsToday,
      returningToday,
      emergencyToday,
      frontOfficeStaffCount,
      staffActiveToday,
    },
    registrationVelocity,
    visitsByType,
    visitsByPayment,
    employeesToday,
    recentActivity,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { getSupervisorMetrics };
