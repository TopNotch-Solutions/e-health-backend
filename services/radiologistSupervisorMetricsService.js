const { User, Role, SonarRequest, SonarResult, Visit, Patient, sequelize } = require('../models');
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

const ACTIVE_SONAR_STATUSES = ['pending', 'in_progress', 'awaiting_report'];

const STATUS_LABELS = {
  pending: 'Pending',
  in_progress: 'In progress',
  awaiting_report: 'Awaiting report',
  completed: 'Completed',
};

async function getSupervisorMetrics(facilityId) {
  const today = startOfDay();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayEnd = endOfDay(yesterday);
  const hourSlots = buildHourlySlots();

  const visitInclude = {
    association: 'visit',
    required: true,
    attributes: [],
    where: { facility_id: facilityId },
  };

  const [
    referralsToday,
    completedToday,
    completedYesterday,
    pendingQueue,
    emergencyToday,
    resultHourRows,
    statusRows,
    scanTypeRows,
    employeeRows,
    recentResults,
    radiologistStaffCount,
  ] = await Promise.all([
    SonarRequest.count({
      include: [visitInclude],
      where: { created_at: { [Op.gte]: today, [Op.lt]: tomorrow } },
    }),
    SonarRequest.count({
      include: [visitInclude],
      where: { status: 'completed', created_at: { [Op.gte]: today, [Op.lt]: tomorrow } },
    }),
    SonarRequest.count({
      include: [visitInclude],
      where: {
        status: 'completed',
        created_at: { [Op.gte]: yesterday, [Op.lte]: yesterdayEnd },
      },
    }),
    SonarRequest.count({
      include: [visitInclude],
      where: { status: { [Op.in]: ACTIVE_SONAR_STATUSES } },
    }),
    SonarRequest.count({
      include: [visitInclude],
      where: { is_emergency: true, created_at: { [Op.gte]: today, [Op.lt]: tomorrow } },
    }),
    sequelize.query(
      `
      SELECT HOUR(sr.completed_at) AS hour, COUNT(*) AS count
      FROM sonar_results sr
      INNER JOIN sonar_requests req ON req.id = sr.sonar_request_id
      INNER JOIN visits v ON v.id = req.visit_id
      WHERE v.facility_id = :facilityId
        AND sr.completed_at >= :today AND sr.completed_at < :tomorrow
      GROUP BY HOUR(sr.completed_at)
      `,
      { replacements: { facilityId, today, tomorrow }, type: sequelize.QueryTypes.SELECT }
    ),
    sequelize.query(
      `
      SELECT req.status AS name, COUNT(*) AS value
      FROM sonar_requests req
      INNER JOIN visits v ON v.id = req.visit_id
      WHERE v.facility_id = :facilityId
        AND req.created_at >= :today AND req.created_at < :tomorrow
      GROUP BY req.status
      `,
      { replacements: { facilityId, today, tomorrow }, type: sequelize.QueryTypes.SELECT }
    ),
    sequelize.query(
      `
      SELECT req.scan_type AS name, COUNT(*) AS value
      FROM sonar_requests req
      INNER JOIN visits v ON v.id = req.visit_id
      WHERE v.facility_id = :facilityId
        AND req.created_at >= :today AND req.created_at < :tomorrow
      GROUP BY req.scan_type
      ORDER BY value DESC
      LIMIT 8
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
        MIN(sr.completed_at) AS first_activity_at,
        COUNT(sr.id) AS reports_completed,
        SUM(CASE WHEN req.is_emergency = 1 THEN 1 ELSE 0 END) AS emergency_reports
      FROM users u
      INNER JOIN roles r ON r.id = u.role_id AND r.name = :radiologistRole
      LEFT JOIN sonar_results sr ON sr.performed_by = u.id
        AND sr.completed_at >= :today AND sr.completed_at < :tomorrow
      LEFT JOIN sonar_requests req ON req.id = sr.sonar_request_id
      LEFT JOIN visits v ON v.id = req.visit_id AND v.facility_id = :facilityId
      WHERE u.facility_id = :facilityId AND u.is_active = 1
      GROUP BY u.id, u.first_name, u.last_name, u.employee_id
      ORDER BY first_activity_at IS NULL, first_activity_at ASC, reports_completed DESC
      `,
      {
        replacements: { facilityId, today, tomorrow, radiologistRole: ROLES.RADIOLOGIST },
        type: sequelize.QueryTypes.SELECT,
      }
    ),
    SonarResult.findAll({
      where: { completed_at: { [Op.gte]: today, [Op.lt]: tomorrow } },
      include: [
        {
          association: 'sonarRequest',
          required: true,
          include: [
            {
              association: 'visit',
              required: true,
              where: { facility_id: facilityId },
              include: [
                { model: Patient, as: 'patient', attributes: ['first_name', 'last_name', 'patient_number', 'is_emergency'] },
              ],
            },
          ],
        },
        { association: 'performedBy', attributes: ['first_name', 'last_name', 'employee_id'] },
      ],
      order: [['completed_at', 'DESC']],
      limit: 20,
    }),
    User.count({
      where: { facility_id: facilityId, is_active: true },
      include: [{ model: Role, as: 'role', required: true, where: { name: ROLES.RADIOLOGIST } }],
    }),
  ]);

  const visitsByStatus = statusRows.map((r) => ({
    name: STATUS_LABELS[r.name] || r.name,
    value: Number(r.value) || 0,
  }));

  const visitsByScanType = scanTypeRows.map((r) => ({
    name: r.name || 'Other',
    value: Number(r.value) || 0,
  }));

  const employeesToday = employeeRows.map((row) => ({
    userId: row.user_id,
    name: staffDisplayName(row),
    employeeId: row.employee_id || '—',
    firstActivityAt: row.first_activity_at,
    firstActivityTime: formatTime(row.first_activity_at),
    reportsCompleted: Number(row.reports_completed) || 0,
    emergencyReports: Number(row.emergency_reports) || 0,
    totalProcessed: Number(row.reports_completed) || 0,
    hasStartedToday: Boolean(row.first_activity_at),
  }));

  const recentActivity = recentResults.map((sr) => {
    const req = sr.sonarRequest || {};
    const p = req.visit?.patient || {};
    const staff = sr.performedBy || {};
    return {
      id: sr.id,
      processedAt: sr.completed_at,
      processedTime: formatTime(sr.completed_at),
      patientName: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || 'Patient',
      patientNumber: p.patient_number,
      isEmergency: Boolean(req.is_emergency),
      staffName: [staff.first_name, staff.last_name].filter(Boolean).join(' ').trim() || 'Radiologist',
      staffEmployeeId: staff.employee_id,
      label: req.scan_type || 'Ultrasound report',
    };
  });

  return {
    kpis: {
      referralsToday,
      completedToday,
      completedYesterday,
      pendingQueue,
      emergencyToday,
      radiologistStaffCount,
      staffActiveToday: employeesToday.filter((e) => e.hasStartedToday).length,
    },
    registrationVelocity: buildVelocityFromRows(hourSlots, resultHourRows),
    visitsByStatus,
    visitsByScanType,
    employeesToday,
    recentActivity,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { getSupervisorMetrics };
