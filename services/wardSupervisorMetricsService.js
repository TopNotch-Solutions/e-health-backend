const { Ward, Bed, Admission, Visit, Patient, QueueEntry, sequelize } = require('../models');
const { Op } = require('sequelize');

const TRIAGE_LEVELS = [
  { level: 'Red / Immediate', key: 'red', fill: '#e11d48' },
  { level: 'Yellow / Urgent', key: 'yellow', fill: '#d97706' },
  { level: 'Green / Non-urgent', key: 'green', fill: '#059669' },
];

const WARD_TYPE_LABELS = {
  general: 'General ward',
  maternity: 'Maternity',
  pediatric: 'Pediatrics',
  icu: 'ICU',
  surgical: 'Surgical',
  psychiatric: 'Psychiatric',
};

function formatWardType(type) {
  if (!type) return 'Other';
  return WARD_TYPE_LABELS[type] || String(type).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

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

/** Hour slots from 00:00 through current hour (inclusive). */
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

function classifyTriage({ visit, patient, queueEntries }) {
  const waiting = (queueEntries || []).filter((q) => q.status === 'waiting');
  const priorities = waiting.map((q) => q.priority);
  if (priorities.includes('emergency') || visit?.visit_type === 'emergency' || patient?.is_emergency) {
    return 'red';
  }
  if (priorities.includes('urgent')) return 'yellow';
  return 'green';
}

function bedIncludeForFacility(facilityId) {
  return {
    model: Bed,
    as: 'bed',
    required: true,
    attributes: [],
    include: [
      {
        model: Ward,
        as: 'ward',
        required: true,
        attributes: [],
        where: { facility_id: facilityId },
      },
    ],
  };
}

function buildOccupancyFromWards(wards) {
  const byType = {};
  let available = 0;

  for (const ward of wards) {
    const type = formatWardType(ward.ward_type);
    const beds = ward.beds || [];
    const occupied = beds.filter((b) => b.status === 'occupied' || b.status === 'reserved').length;
    const avail = beds.filter((b) => b.status === 'available').length;
    byType[type] = (byType[type] || 0) + occupied;
    available += avail;
  }

  const slices = Object.entries(byType)
    .filter(([, value]) => value > 0)
    .map(([name, value]) => ({ name, value }));

  if (available > 0) {
    slices.push({ name: 'Available beds', value: available });
  }

  return slices;
}

/**
 * Aggregated real-time metrics for the ward supervisor dashboard.
 */
async function getSupervisorMetrics(facilityId) {
  const today = startOfDay();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayEnd = endOfDay(yesterday);

  const hourSlots = buildHourlySlots();
  const visitFacility = { facility_id: facilityId };

  const facilityScope = `
    INNER JOIN beds b ON b.id = a.bed_id
    INNER JOIN wards w ON w.id = b.ward_id AND w.facility_id = :facilityId
  `;

  const [
    registrationsToday,
    registrationsYesterday,
    visitHourRows,
    activeRow,
    dischargesRow,
    admissionHourRows,
    dischargeHourRows,
    wards,
    pendingArrivals,
    triageWaitRows,
  ] = await Promise.all([
    Visit.count({ where: { ...visitFacility, created_at: { [Op.gte]: today, [Op.lt]: tomorrow } } }),
    Visit.count({
      where: {
        ...visitFacility,
        created_at: { [Op.gte]: yesterday, [Op.lte]: yesterdayEnd },
      },
    }),
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
      SELECT COUNT(DISTINCT a.id) AS total
      FROM admissions a
      ${facilityScope}
      WHERE a.status IN ('admitted', 'pending_arrival')
      `,
      { replacements: { facilityId }, type: sequelize.QueryTypes.SELECT }
    ),
    sequelize.query(
      `
      SELECT COUNT(DISTINCT a.id) AS total
      FROM admissions a
      ${facilityScope}
      WHERE a.status = 'discharged'
        AND a.discharged_at >= :today AND a.discharged_at < :tomorrow
      `,
      { replacements: { facilityId, today, tomorrow }, type: sequelize.QueryTypes.SELECT }
    ),
    sequelize.query(
      `
      SELECT HOUR(a.admitted_at) AS hour, COUNT(*) AS count
      FROM admissions a
      ${facilityScope}
      WHERE a.admitted_at >= :today AND a.admitted_at < :tomorrow
      GROUP BY HOUR(a.admitted_at)
      `,
      { replacements: { facilityId, today, tomorrow }, type: sequelize.QueryTypes.SELECT }
    ),
    sequelize.query(
      `
      SELECT HOUR(a.discharged_at) AS hour, COUNT(*) AS count
      FROM admissions a
      ${facilityScope}
      WHERE a.status = 'discharged'
        AND a.discharged_at >= :today AND a.discharged_at < :tomorrow
      GROUP BY HOUR(a.discharged_at)
      `,
      { replacements: { facilityId, today, tomorrow }, type: sequelize.QueryTypes.SELECT }
    ),
    Ward.findAll({
      where: { facility_id: facilityId },
      include: [{ association: 'beds', attributes: ['id', 'status'] }],
      order: [['ward_number', 'ASC']],
    }),
    Admission.findAll({
      where: { status: 'pending_arrival' },
      include: [
        bedIncludeForFacility(facilityId),
        {
          association: 'visit',
          required: true,
          where: visitFacility,
          include: [
            { model: Patient, as: 'patient', attributes: ['is_emergency'] },
            {
              model: QueueEntry,
              as: 'queueEntries',
              required: false,
              attributes: ['priority', 'status', 'department'],
            },
          ],
        },
      ],
    }),
    sequelize.query(
      `
      SELECT
        AVG(
          CASE
            WHEN a.admitted_at IS NOT NULL AND v.created_at IS NOT NULL
            THEN TIMESTAMPDIFF(MINUTE, v.created_at, a.admitted_at)
            WHEN a.status = 'pending_arrival' AND v.created_at IS NOT NULL
            THEN TIMESTAMPDIFF(MINUTE, v.created_at, NOW())
            ELSE NULL
          END
        ) AS avg_minutes
      FROM admissions a
      INNER JOIN beds b ON b.id = a.bed_id
      INNER JOIN wards w ON w.id = b.ward_id
      INNER JOIN visits v ON v.id = a.visit_id
      WHERE w.facility_id = :facilityId
        AND (
          (a.admitted_at >= :today AND a.admitted_at < :tomorrow)
          OR a.status = 'pending_arrival'
        )
      `,
      {
        replacements: { facilityId, today, tomorrow },
        type: sequelize.QueryTypes.SELECT,
      }
    ),
  ]);

  const activeAdmissions = Number(activeRow?.[0]?.total) || 0;
  const dischargesToday = Number(dischargesRow?.[0]?.total) || 0;

  const visitByHour = mapHourlyCounts(visitHourRows);
  const admissionsByHour = mapHourlyCounts(admissionHourRows);
  const dischargesByHour = mapHourlyCounts(dischargeHourRows);

  const registrationVelocity = hourSlots.map((hour) => {
    const h = parseInt(hour.slice(0, 2), 10);
    return { hour, count: visitByHour[h] || 0 };
  });

  const hourlyAdmissionsVsDischarges = hourSlots.map((hour) => {
    const h = parseInt(hour.slice(0, 2), 10);
    return {
      hour,
      admissions: admissionsByHour[h] || 0,
      discharges: dischargesByHour[h] || 0,
    };
  });

  const triageCounts = { red: 0, yellow: 0, green: 0 };
  for (const row of pendingArrivals) {
    const bucket = classifyTriage({
      visit: row.visit,
      patient: row.visit?.patient,
      queueEntries: row.visit?.queueEntries,
    });
    triageCounts[bucket] += 1;
  }

  const triageDistribution = TRIAGE_LEVELS.map(({ level, key, fill }) => ({
    level,
    count: triageCounts[key] || 0,
    fill,
  }));

  const avgRaw = triageWaitRows?.[0]?.avg_minutes;
  const avgTriageWaitMinutes =
    avgRaw != null && !Number.isNaN(Number(avgRaw)) ? Math.round(Number(avgRaw)) : 0;

  return {
    kpis: {
      registrationsToday,
      registrationsYesterday,
      activeAdmissions,
      dischargesToday,
      avgTriageWaitMinutes,
    },
    registrationVelocity,
    occupancyByArea: buildOccupancyFromWards(wards),
    hourlyAdmissionsVsDischarges,
    triageDistribution,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { getSupervisorMetrics };
