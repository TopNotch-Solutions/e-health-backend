const { User, Role, Vital, Visit, Patient, QueueEntry, sequelize } = require('../models');
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

  const visitInclude = {
    model: Visit,
    as: 'visit',
    required: true,
    attributes: [],
    where: { facility_id: facilityId },
  };

  const [
    vitalsToday,
    vitalsYesterday,
    emergencyVitalsToday,
    nurseQueueWaiting,
    vitalHourRows,
    employeeRows,
    recentVitals,
    nurseStaffCount,
  ] = await Promise.all([
    Vital.count({
      include: [visitInclude],
      where: { recorded_at: { [Op.gte]: today, [Op.lt]: tomorrow } },
    }),
    Vital.count({
      include: [visitInclude],
      where: { recorded_at: { [Op.gte]: yesterday, [Op.lte]: yesterdayEnd } },
    }),
    Vital.count({
      include: [{
        ...visitInclude,
        include: [{ model: Patient, as: 'patient', required: true, attributes: [], where: { is_emergency: true } }],
      }],
      where: { recorded_at: { [Op.gte]: today, [Op.lt]: tomorrow } },
    }),
    QueueEntry.count({
      where: { department: 'nurse', status: 'waiting' },
      include: [
        {
          association: 'visit',
          required: true,
          attributes: [],
          where: { facility_id: facilityId },
        },
      ],
    }),
    sequelize.query(
      `
      SELECT HOUR(v.recorded_at) AS hour, COUNT(*) AS count
      FROM vitals v
      INNER JOIN visits vis ON vis.id = v.visit_id
      WHERE vis.facility_id = :facilityId
        AND v.recorded_at >= :today AND v.recorded_at < :tomorrow
      GROUP BY HOUR(v.recorded_at)
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
        MIN(v.recorded_at) AS first_activity_at,
        COUNT(v.id) AS vitals_recorded,
        SUM(CASE WHEN p.is_emergency = 1 THEN 1 ELSE 0 END) AS emergency_patients
      FROM users u
      INNER JOIN roles r ON r.id = u.role_id AND r.name = :nurseRole
      LEFT JOIN vitals v ON v.recorded_by = u.id
        AND v.recorded_at >= :today AND v.recorded_at < :tomorrow
      LEFT JOIN visits vis ON vis.id = v.visit_id AND vis.facility_id = :facilityId
      LEFT JOIN patients p ON p.id = vis.patient_id
      WHERE u.facility_id = :facilityId AND u.is_active = 1
      GROUP BY u.id, u.first_name, u.last_name, u.employee_id
      ORDER BY first_activity_at IS NULL, first_activity_at ASC, vitals_recorded DESC
      `,
      {
        replacements: { facilityId, today, tomorrow, nurseRole: ROLES.NURSE },
        type: sequelize.QueryTypes.SELECT,
      }
    ),
    Vital.findAll({
      where: { recorded_at: { [Op.gte]: today, [Op.lt]: tomorrow } },
      include: [
        {
          association: 'visit',
          required: true,
          where: { facility_id: facilityId },
          include: [
            { model: Patient, as: 'patient', attributes: ['first_name', 'last_name', 'patient_number', 'is_emergency'] },
          ],
        },
        { association: 'recordedBy', attributes: ['first_name', 'last_name', 'employee_id'] },
      ],
      order: [['recorded_at', 'DESC']],
      limit: 20,
    }),
    User.count({
      where: { facility_id: facilityId, is_active: true },
      include: [{ model: Role, as: 'role', required: true, where: { name: ROLES.NURSE } }],
    }),
  ]);

  const employeesToday = employeeRows.map((row) => ({
    userId: row.user_id,
    name: staffDisplayName(row),
    employeeId: row.employee_id || '—',
    firstActivityAt: row.first_activity_at,
    firstActivityTime: formatTime(row.first_activity_at),
    vitalsRecorded: Number(row.vitals_recorded) || 0,
    emergencyPatients: Number(row.emergency_patients) || 0,
    totalProcessed: Number(row.vitals_recorded) || 0,
    hasStartedToday: Boolean(row.first_activity_at),
  }));

  const recentActivity = recentVitals.map((v) => {
    const p = v.visit?.patient || {};
    const staff = v.recordedBy || {};
    return {
      id: v.id,
      processedAt: v.recorded_at,
      processedTime: formatTime(v.recorded_at),
      patientName: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || 'Patient',
      patientNumber: p.patient_number,
      isEmergency: Boolean(p.is_emergency),
      staffName: [staff.first_name, staff.last_name].filter(Boolean).join(' ').trim() || 'Nurse',
      staffEmployeeId: staff.employee_id,
      label: 'Vitals recorded',
    };
  });

  return {
    kpis: {
      vitalsToday,
      vitalsYesterday,
      emergencyVitalsToday,
      nurseQueueWaiting,
      nurseStaffCount,
      staffActiveToday: employeesToday.filter((e) => e.hasStartedToday).length,
    },
    registrationVelocity: buildVelocityFromRows(hourSlots, vitalHourRows),
    employeesToday,
    recentActivity,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { getSupervisorMetrics };
