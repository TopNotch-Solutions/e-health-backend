const { User, Role, LabRequest, LabResult, Visit, Patient, sequelize } = require('../models');
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

const ACTIVE_STATUSES = ['pending_sample', 'sample_collected', 'processing'];

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
    completedToday,
    completedYesterday,
    pendingQueue,
    emergencyToday,
    resultHourRows,
    statusRows,
    employeeRows,
    recentResults,
    labStaffCount,
  ] = await Promise.all([
    LabRequest.count({
      include: [visitInclude],
      where: { status: 'completed', created_at: { [Op.gte]: today, [Op.lt]: tomorrow } },
    }),
    LabRequest.count({
      include: [visitInclude],
      where: {
        status: 'completed',
        created_at: { [Op.gte]: yesterday, [Op.lte]: yesterdayEnd },
      },
    }),
    LabRequest.count({
      include: [visitInclude],
      where: { status: { [Op.in]: ACTIVE_STATUSES } },
    }),
    LabRequest.count({
      include: [visitInclude],
      where: { is_emergency: true, created_at: { [Op.gte]: today, [Op.lt]: tomorrow } },
    }),
    sequelize.query(
      `
      SELECT HOUR(lr.completed_at) AS hour, COUNT(*) AS count
      FROM lab_results lr
      INNER JOIN lab_requests req ON req.id = lr.lab_request_id
      INNER JOIN visits v ON v.id = req.visit_id
      WHERE v.facility_id = :facilityId
        AND lr.completed_at >= :today AND lr.completed_at < :tomorrow
      GROUP BY HOUR(lr.completed_at)
      `,
      { replacements: { facilityId, today, tomorrow }, type: sequelize.QueryTypes.SELECT }
    ),
    sequelize.query(
      `
      SELECT req.status AS name, COUNT(*) AS value
      FROM lab_requests req
      INNER JOIN visits v ON v.id = req.visit_id
      WHERE v.facility_id = :facilityId
        AND req.created_at >= :today AND req.created_at < :tomorrow
      GROUP BY req.status
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
        MIN(lr.completed_at) AS first_activity_at,
        COUNT(lr.id) AS results_completed,
        SUM(CASE WHEN req.is_emergency = 1 THEN 1 ELSE 0 END) AS emergency_results
      FROM users u
      INNER JOIN roles r ON r.id = u.role_id AND r.name = :labRole
      LEFT JOIN lab_results lr ON lr.processed_by = u.id
        AND lr.completed_at >= :today AND lr.completed_at < :tomorrow
      LEFT JOIN lab_requests req ON req.id = lr.lab_request_id
      LEFT JOIN visits v ON v.id = req.visit_id AND v.facility_id = :facilityId
      WHERE u.facility_id = :facilityId AND u.is_active = 1
      GROUP BY u.id, u.first_name, u.last_name, u.employee_id
      ORDER BY first_activity_at IS NULL, first_activity_at ASC, results_completed DESC
      `,
      {
        replacements: { facilityId, today, tomorrow, labRole: ROLES.LAB_TECHNICIAN },
        type: sequelize.QueryTypes.SELECT,
      }
    ),
    LabResult.findAll({
      where: { completed_at: { [Op.gte]: today, [Op.lt]: tomorrow } },
      include: [
        {
          association: 'labRequest',
          required: true,
          include: [
            {
              association: 'visit',
              required: true,
              where: { facility_id: facilityId },
              include: [{ model: Patient, as: 'patient', attributes: ['first_name', 'last_name', 'patient_number', 'is_emergency'] }],
            },
          ],
        },
        { association: 'processedBy', attributes: ['first_name', 'last_name', 'employee_id'] },
      ],
      order: [['completed_at', 'DESC']],
      limit: 20,
    }),
    User.count({
      where: { facility_id: facilityId, is_active: true },
      include: [{ model: Role, as: 'role', required: true, where: { name: ROLES.LAB_TECHNICIAN } }],
    }),
  ]);

  const STATUS_LABELS = {
    pending_sample: 'Pending sample',
    sample_collected: 'Sample collected',
    processing: 'Processing',
    completed: 'Completed',
  };

  const visitsByStatus = statusRows.map((r) => ({
    name: STATUS_LABELS[r.name] || r.name,
    value: Number(r.value) || 0,
  }));

  const employeesToday = employeeRows.map((row) => ({
    userId: row.user_id,
    name: staffDisplayName(row),
    employeeId: row.employee_id || '—',
    firstActivityAt: row.first_activity_at,
    firstActivityTime: formatTime(row.first_activity_at),
    resultsCompleted: Number(row.results_completed) || 0,
    emergencyResults: Number(row.emergency_results) || 0,
    totalProcessed: Number(row.results_completed) || 0,
    hasStartedToday: Boolean(row.first_activity_at),
  }));

  const recentActivity = recentResults.map((lr) => {
    const req = lr.labRequest || {};
    const p = req.visit?.patient || {};
    const staff = lr.processedBy || {};
    return {
      id: lr.id,
      processedAt: lr.completed_at,
      processedTime: formatTime(lr.completed_at),
      patientName: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || 'Patient',
      patientNumber: p.patient_number,
      isEmergency: Boolean(req.is_emergency),
      staffName: [staff.first_name, staff.last_name].filter(Boolean).join(' ').trim() || 'Lab tech',
      staffEmployeeId: staff.employee_id,
      label: req.test_type || 'Lab result',
    };
  });

  return {
    kpis: {
      completedToday,
      completedYesterday,
      pendingQueue,
      emergencyToday,
      labStaffCount,
      staffActiveToday: employeesToday.filter((e) => e.hasStartedToday).length,
    },
    registrationVelocity: buildVelocityFromRows(hourSlots, resultHourRows),
    visitsByStatus,
    employeesToday,
    recentActivity,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { getSupervisorMetrics };
