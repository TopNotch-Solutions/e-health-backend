const {
  User, Role, Consultation, Prescription, LabRequest, Admission, Visit, Patient, sequelize,
} = require('../models');
const { Op } = require('sequelize');
const { ROLES } = require('../config/roles');
const {
  startOfDay,
  endOfDay,
  buildHourlySlots,
  formatTime,
  staffDisplayName,
  buildVelocityFromRows,
} = require('./supervisorMetricsUtils');

async function getSupervisorMetrics(facilityId) {
  const today = startOfDay();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayEnd = endOfDay(yesterday);
  const hourSlots = buildHourlySlots();

  const visitScope = { facility_id: facilityId };
  const todayRange = { [Op.gte]: today, [Op.lt]: tomorrow };

  const [
    consultationsToday,
    consultationsYesterday,
    prescriptionsToday,
    labOrdersToday,
    admissionsToday,
    consultHourRows,
    actionTypeRows,
    employeeRows,
    recentConsultations,
    doctorStaffCount,
  ] = await Promise.all([
    Consultation.count({
      include: [{ association: 'visit', required: true, attributes: [], where: visitScope }],
      where: { created_at: todayRange },
    }),
    Consultation.count({
      include: [{ association: 'visit', required: true, attributes: [], where: visitScope }],
      where: { created_at: { [Op.gte]: yesterday, [Op.lte]: yesterdayEnd } },
    }),
    Prescription.count({
      include: [{ association: 'visit', required: true, attributes: [], where: visitScope }],
      where: { created_at: todayRange },
    }),
    LabRequest.count({
      include: [{ association: 'visit', required: true, attributes: [], where: visitScope }],
      where: { created_at: todayRange },
    }),
    Admission.count({
      include: [{ association: 'visit', required: true, attributes: [], where: visitScope }],
      where: { admitted_at: todayRange },
    }),
    sequelize.query(
      `
      SELECT HOUR(c.created_at) AS hour, COUNT(*) AS count
      FROM consultations c
      INNER JOIN visits v ON v.id = c.visit_id
      WHERE v.facility_id = :facilityId
        AND c.created_at >= :today AND c.created_at < :tomorrow
      GROUP BY HOUR(c.created_at)
      `,
      { replacements: { facilityId, today, tomorrow }, type: sequelize.QueryTypes.SELECT }
    ),
    sequelize.query(
      `
      SELECT 'Consultations' AS name, COUNT(*) AS value FROM consultations c
      INNER JOIN visits v ON v.id = c.visit_id
      WHERE v.facility_id = :facilityId AND c.created_at >= :today AND c.created_at < :tomorrow
      UNION ALL
      SELECT 'Prescriptions', COUNT(*) FROM prescriptions p
      INNER JOIN visits v ON v.id = p.visit_id
      WHERE v.facility_id = :facilityId AND p.created_at >= :today AND p.created_at < :tomorrow
      UNION ALL
      SELECT 'Lab orders', COUNT(*) FROM lab_requests lr
      INNER JOIN visits v ON v.id = lr.visit_id
      WHERE v.facility_id = :facilityId AND lr.created_at >= :today AND lr.created_at < :tomorrow
      UNION ALL
      SELECT 'Admissions', COUNT(*) FROM admissions a
      INNER JOIN visits v ON v.id = a.visit_id
      WHERE v.facility_id = :facilityId AND a.admitted_at >= :today AND a.admitted_at < :tomorrow
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
        MIN(c.created_at) AS first_activity_at,
        COUNT(DISTINCT c.id) AS consultations,
        (SELECT COUNT(*) FROM prescriptions p
          INNER JOIN visits v ON v.id = p.visit_id
          WHERE p.prescribed_by = u.id AND v.facility_id = :facilityId
            AND p.created_at >= :today AND p.created_at < :tomorrow) AS prescriptions,
        (SELECT COUNT(*) FROM lab_requests lr
          INNER JOIN visits v ON v.id = lr.visit_id
          WHERE lr.requested_by = u.id AND v.facility_id = :facilityId
            AND lr.created_at >= :today AND lr.created_at < :tomorrow) AS lab_orders
      FROM users u
      INNER JOIN roles r ON r.id = u.role_id AND r.name = :doctorRole
      LEFT JOIN consultations c ON c.doctor_id = u.id
        AND c.created_at >= :today AND c.created_at < :tomorrow
      LEFT JOIN visits vis ON vis.id = c.visit_id AND vis.facility_id = :facilityId
      WHERE u.facility_id = :facilityId AND u.is_active = 1
      GROUP BY u.id, u.first_name, u.last_name, u.employee_id
      ORDER BY first_activity_at IS NULL, first_activity_at ASC, consultations DESC
      `,
      {
        replacements: { facilityId, today, tomorrow, doctorRole: ROLES.DOCTOR },
        type: sequelize.QueryTypes.SELECT,
      }
    ),
    Consultation.findAll({
      where: { created_at: todayRange },
      include: [
        {
          association: 'visit',
          required: true,
          where: visitScope,
          include: [{ model: Patient, as: 'patient', attributes: ['first_name', 'last_name', 'patient_number', 'is_emergency'] }],
        },
        { association: 'doctor', attributes: ['first_name', 'last_name', 'employee_id'] },
      ],
      order: [['created_at', 'DESC']],
      limit: 15,
    }),
    User.count({
      where: { facility_id: facilityId, is_active: true },
      include: [{ model: Role, as: 'role', required: true, where: { name: ROLES.DOCTOR } }],
    }),
  ]);

  const ACTION_COLORS = {
    Consultations: '#0d9488',
    Prescriptions: '#0284c7',
    'Lab orders': '#d97706',
    Admissions: '#7c3aed',
  };

  const visitsByAction = actionTypeRows
    .filter((r) => Number(r.value) > 0)
    .map((r) => ({
      name: r.name,
      value: Number(r.value) || 0,
      fill: ACTION_COLORS[r.name] || '#64748b',
    }));

  const employeesToday = employeeRows.map((row) => ({
    userId: row.user_id,
    name: staffDisplayName(row),
    employeeId: row.employee_id || '—',
    firstActivityAt: row.first_activity_at,
    firstActivityTime: formatTime(row.first_activity_at),
    consultations: Number(row.consultations) || 0,
    prescriptions: Number(row.prescriptions) || 0,
    labOrders: Number(row.lab_orders) || 0,
    totalProcessed:
      (Number(row.consultations) || 0) +
      (Number(row.prescriptions) || 0) +
      (Number(row.lab_orders) || 0),
    hasStartedToday: Boolean(row.first_activity_at),
  }));

  const recentActivity = recentConsultations.map((c) => {
    const p = c.visit?.patient || {};
    const staff = c.doctor || {};
    return {
      id: c.id,
      processedAt: c.created_at,
      processedTime: formatTime(c.created_at),
      patientName: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || 'Patient',
      patientNumber: p.patient_number,
      isEmergency: Boolean(p.is_emergency),
      staffName: [staff.first_name, staff.last_name].filter(Boolean).join(' ').trim() || 'Doctor',
      staffEmployeeId: staff.employee_id,
      label: 'Consultation',
    };
  });

  return {
    kpis: {
      consultationsToday,
      consultationsYesterday,
      prescriptionsToday,
      labOrdersToday,
      admissionsToday,
      doctorStaffCount,
      staffActiveToday: employeesToday.filter((e) => e.hasStartedToday).length,
    },
    registrationVelocity: buildVelocityFromRows(hourSlots, consultHourRows),
    visitsByAction,
    employeesToday,
    recentActivity,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { getSupervisorMetrics };
