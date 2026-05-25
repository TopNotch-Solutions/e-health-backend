const {
  Facility, Bill, Visit, MealPlan, Patient, User, Role, QueueEntry, Admission,
  MortuaryRecord, RevenueShift, sequelize,
} = require('../models');
const { Op } = require('sequelize');
const { getSupervisorMetrics: getPharmacyMetrics } = require('./pharmacySupervisorMetricsService');
const { getSupervisorMetrics: getNurseMetrics } = require('./nurseSupervisorMetricsService');
const { getSupervisorMetrics: getDoctorMetrics } = require('./doctorSupervisorMetricsService');
const { getSupervisorMetrics: getLabMetrics } = require('./laboratorySupervisorMetricsService');
const { getSupervisorMetrics: getRadiologyMetrics } = require('./radiologistSupervisorMetricsService');
const { getSupervisorMetrics: getFrontOfficeMetrics } = require('./frontOfficeSupervisorMetricsService');
const { getSupervisorMetrics: getWardMetrics } = require('./wardSupervisorMetricsService');

function sumKpis(kpisList) {
  const out = {};
  for (const kpi of kpisList) {
    if (!kpi) continue;
    for (const [key, val] of Object.entries(kpi)) {
      if (typeof val === 'number') out[key] = (out[key] || 0) + val;
    }
  }
  return out;
}

function mergeHourlySeries(list, hourKey = 'hour', valueKeys = ['count', 'dispensed', 'value']) {
  const map = {};
  for (const series of list) {
    for (const point of series || []) {
      const h = point[hourKey];
      if (h == null) continue;
      let v = 0;
      for (const vk of valueKeys) {
        if (point[vk] != null) v += Number(point[vk]) || 0;
      }
      map[h] = (map[h] || 0) + v;
    }
  }
  return Object.keys(map)
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .map((hour) => {
      const row = { hour };
      const firstKey = valueKeys.find((vk) => list.some((s) => s?.some((p) => p[vk] != null))) || 'count';
      row[firstKey] = map[hour];
      return row;
    });
}

function mergeAdmissionsDischarges(seriesList) {
  const map = {};
  for (const series of seriesList) {
    for (const point of series || []) {
      const h = point.hour;
      if (h == null) continue;
      if (!map[h]) map[h] = { hour: h, admissions: 0, discharges: 0 };
      map[h].admissions += Number(point.admissions) || 0;
      map[h].discharges += Number(point.discharges) || 0;
    }
  }
  return Object.keys(map)
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .map((hour) => map[hour]);
}

function mergeTriage(arrays) {
  const map = {};
  for (const arr of arrays) {
    for (const row of arr || []) {
      const level = row.level || row.name;
      map[level] = (map[level] || 0) + (Number(row.count) || 0);
    }
  }
  return Object.entries(map).map(([level, count]) => ({ level, count }));
}

function mergeNamedCounts(arrays, nameKey = 'name', countKeys = ['count', 'value']) {
  const map = {};
  for (const arr of arrays) {
    for (const row of arr || []) {
      const name = row[nameKey] ?? row.status ?? row.name ?? 'Other';
      let c = 0;
      for (const ck of countKeys) {
        if (row[ck] != null) c += Number(row[ck]) || 0;
      }
      map[name] = (map[name] || 0) + c;
    }
  }
  return Object.entries(map).map(([name, count]) => ({
    name,
    count,
    value: count,
    status: name,
  }));
}

async function getFacilityIds() {
  const rows = await Facility.findAll({ attributes: ['id'], raw: true });
  return rows.map((r) => r.id);
}

async function aggregateSupervisorMetrics(fetcher) {
  const ids = await getFacilityIds();
  if (!ids.length) return null;
  const results = await Promise.all(ids.map((id) => fetcher(id).catch(() => null)));
  const valid = results.filter(Boolean);
  if (!valid.length) return null;

  return {
    kpis: sumKpis(valid.map((r) => r.kpis)),
    stockReceivedVelocity: mergeHourlySeries(valid.map((r) => r.stockReceivedVelocity)),
    hourlyDispensed: mergeHourlySeries(valid.map((r) => r.hourlyDispensed), 'hour', ['dispensed', 'count']),
    registrationVelocity: mergeHourlySeries(valid.map((r) => r.registrationVelocity)),
    hourlyAdmissionsVsDischarges: mergeAdmissionsDischarges(
      valid.map((r) => r.hourlyAdmissionsVsDischarges)
    ),
    stockByCategory: mergeNamedCounts(valid.map((r) => r.stockByCategory)),
    prescriptionStatus: mergeNamedCounts(valid.map((r) => r.prescriptionStatus), 'status'),
    visitTypeMix: mergeNamedCounts(valid.map((r) => r.visitTypeMix)),
    paymentTypeMix: mergeNamedCounts(valid.map((r) => r.paymentTypeMix)),
    visitsByAction: mergeNamedCounts(valid.map((r) => r.visitsByAction)),
    visitsByStatus: mergeNamedCounts(valid.map((r) => r.visitsByStatus), 'status'),
    visitsByScanType: mergeNamedCounts(valid.map((r) => r.visitsByScanType)),
    occupancyByArea: mergeNamedCounts(valid.map((r) => r.occupancyByArea)),
    triageDistribution: mergeTriage(valid.map((r) => r.triageDistribution)),
    lowStockBar: valid
      .flatMap((r) => r.lowStockBar || [])
      .sort((a, b) => (a.count ?? 0) - (b.count ?? 0))
      .slice(0, 12),
    lowStockAlerts: valid.flatMap((r) => r.lowStockAlerts || []).slice(0, 15),
    facilityCount: ids.length,
    updatedAt: new Date().toISOString(),
  };
}

function kpi(label, value, hint) {
  return { label, value: value ?? 0, hint };
}

function chart(type, title, subtitle, data, config = {}) {
  return { type, title, subtitle, data: data || [], ...config };
}

function buildSupervisorModulePayload(key, title, merged, kpiMap, charts) {
  if (!merged) {
    return {
      module: key,
      title,
      readOnly: true,
      kpis: [kpi('Facilities', 0, 'No facility data')],
      charts: [],
    };
  }
  const kpis = kpiMap(merged);
  return {
    module: key,
    title,
    readOnly: true,
    facilityCount: merged.facilityCount,
    updatedAt: merged.updatedAt,
    kpis,
    charts: charts(merged),
  };
}

async function getPharmacyModule() {
  const merged = await aggregateSupervisorMetrics(getPharmacyMetrics);
  return buildSupervisorModulePayload('pharmacy', 'Pharmacy', merged, (m) => [
    kpi('Medications tracked', m.kpis.totalMedications),
    kpi('Low stock items', m.kpis.lowStockCount),
    kpi('Pending prescriptions', m.kpis.pendingPrescriptions),
    kpi('Dispensed today', m.kpis.dispensedToday),
    kpi('Units received today', m.kpis.unitsReceivedToday),
  ], (m) => [
    chart('line', 'Stock received (today)', 'Units by hour — all facilities', m.stockReceivedVelocity, { xKey: 'hour', yKey: 'count' }),
    chart('line', 'Dispensed (today)', 'Prescriptions dispensed by hour', m.hourlyDispensed, { xKey: 'hour', yKey: 'dispensed' }),
    chart('pie', 'Stock by category', 'Inventory distribution', m.stockByCategory, { nameKey: 'name', valueKey: 'value' }),
    chart('bar', 'Prescription status', 'Current pipeline', m.prescriptionStatus, { xKey: 'status', yKey: 'count' }),
    chart('bar', 'Low stock medications', 'Below reorder level', m.lowStockBar, { xKey: 'name', yKey: 'count', layout: 'vertical' }),
    chart('bar', 'Pharmacy workload', 'National today', [
      { name: 'Pending Rx', count: m.kpis.pendingPrescriptions || 0 },
      { name: 'Dispensed', count: m.kpis.dispensedToday || 0 },
      { name: 'Low stock SKUs', count: m.kpis.lowStockCount || 0 },
    ], { xKey: 'name', yKey: 'count' }),
  ]);
}

async function getNursingModule() {
  const merged = await aggregateSupervisorMetrics(getNurseMetrics);
  return buildSupervisorModulePayload('nursing', 'Nursing', merged, (m) => [
    kpi('Vitals recorded today', m.kpis.vitalsToday),
    kpi('Vitals yesterday', m.kpis.vitalsYesterday),
    kpi('Emergency vitals today', m.kpis.emergencyVitalsToday),
    kpi('Queue waiting', m.kpis.nurseQueueWaiting),
    kpi('Active nurses', m.kpis.nurseStaffCount),
  ], (m) => [
    chart('line', 'Vitals recorded (today)', 'By hour — all facilities', m.registrationVelocity, { xKey: 'hour', yKey: 'count' }),
    chart('bar', 'Vitals volume', 'Today vs yesterday', [
      { name: 'Today', count: m.kpis.vitalsToday || 0 },
      { name: 'Yesterday', count: m.kpis.vitalsYesterday || 0 },
      { name: 'Emergency today', count: m.kpis.emergencyVitalsToday || 0 },
    ], { xKey: 'name', yKey: 'count' }),
    chart('bar', 'Nurse queue & staff', 'National snapshot', [
      { name: 'Waiting in queue', count: m.kpis.nurseQueueWaiting || 0 },
      { name: 'Active nurses', count: m.kpis.nurseStaffCount || 0 },
      { name: 'Staff active today', count: m.kpis.staffActiveToday || 0 },
    ], { xKey: 'name', yKey: 'count' }),
  ]);
}

async function getDoctorModule() {
  const merged = await aggregateSupervisorMetrics(getDoctorMetrics);
  return buildSupervisorModulePayload('doctor', 'Doctor / clinical', merged, (m) => [
    kpi('Consultations today', m.kpis.consultationsToday),
    kpi('Prescriptions today', m.kpis.prescriptionsToday),
    kpi('Lab orders today', m.kpis.labOrdersToday),
    kpi('Active doctors', m.kpis.doctorStaffCount),
  ], (m) => [
    chart('line', 'Consultations (today)', 'By hour', m.registrationVelocity, { xKey: 'hour', yKey: 'count' }),
    chart('pie', 'Clinical actions today', 'Consultations, prescriptions, labs', m.visitsByAction, { nameKey: 'name', valueKey: 'value' }),
    chart('bar', 'Doctor output today', 'National totals', [
      { name: 'Consultations', count: m.kpis.consultationsToday || 0 },
      { name: 'Prescriptions', count: m.kpis.prescriptionsToday || 0 },
      { name: 'Lab orders', count: m.kpis.labOrdersToday || 0 },
      { name: 'Admissions', count: m.kpis.admissionsToday || 0 },
    ], { xKey: 'name', yKey: 'count' }),
    chart('bar', 'Consultations trend', 'Today vs yesterday', [
      { name: 'Today', count: m.kpis.consultationsToday || 0 },
      { name: 'Yesterday', count: m.kpis.consultationsYesterday || 0 },
    ], { xKey: 'name', yKey: 'count' }),
  ]);
}

async function getFrontOfficeModule() {
  const merged = await aggregateSupervisorMetrics(getFrontOfficeMetrics);
  return buildSupervisorModulePayload('front_office', 'Front office', merged, (m) => [
    kpi('Visits processed today', m.kpis.processedToday),
    kpi('New registrations', m.kpis.newRegistrationsToday),
    kpi('Returning patients', m.kpis.returningToday),
    kpi('Emergencies today', m.kpis.emergencyToday),
    kpi('FO staff active', m.kpis.frontOfficeStaffCount),
  ], (m) => [
    chart('line', 'Registrations (today)', 'Visits by hour', m.registrationVelocity, { xKey: 'hour', yKey: 'count' }),
    chart('pie', 'Visit type mix', 'Today', m.visitTypeMix, { nameKey: 'name', valueKey: 'value' }),
    chart('bar', 'Payment type mix', 'Today', m.paymentTypeMix, { xKey: 'name', yKey: 'count' }),
    chart('bar', 'Front office throughput', 'Today', [
      { name: 'Total processed', count: m.kpis.processedToday || 0 },
      { name: 'New', count: m.kpis.newRegistrationsToday || 0 },
      { name: 'Returning', count: m.kpis.returningToday || 0 },
      { name: 'Emergency', count: m.kpis.emergencyToday || 0 },
    ], { xKey: 'name', yKey: 'count' }),
    chart('bar', 'Daily comparison', 'Today vs yesterday', [
      { name: 'Today', count: m.kpis.processedToday || 0 },
      { name: 'Yesterday', count: m.kpis.processedYesterday || 0 },
    ], { xKey: 'name', yKey: 'count' }),
  ]);
}

async function getLaboratoryModule() {
  const merged = await aggregateSupervisorMetrics(getLabMetrics);
  return buildSupervisorModulePayload('laboratory', 'Laboratory', merged, (m) => [
    kpi('Completed today', m.kpis.completedToday),
    kpi('Completed yesterday', m.kpis.completedYesterday),
    kpi('Pending queue', m.kpis.pendingQueue),
    kpi('Emergencies today', m.kpis.emergencyToday),
    kpi('Lab staff', m.kpis.labStaffCount),
  ], (m) => [
    chart('line', 'Results filed (today)', 'By hour', m.registrationVelocity, { xKey: 'hour', yKey: 'count' }),
    chart('bar', 'Request status', 'Pipeline', m.visitsByStatus, { xKey: 'status', yKey: 'count' }),
    chart('bar', 'Lab completions', 'Today vs yesterday', [
      { name: 'Today', count: m.kpis.completedToday || 0 },
      { name: 'Yesterday', count: m.kpis.completedYesterday || 0 },
      { name: 'Pending', count: m.kpis.pendingQueue || 0 },
      { name: 'Emergencies', count: m.kpis.emergencyToday || 0 },
    ], { xKey: 'name', yKey: 'count' }),
  ]);
}

async function getRadiologyModule() {
  const merged = await aggregateSupervisorMetrics(getRadiologyMetrics);
  return buildSupervisorModulePayload('radiology', 'Radiology / sonar', merged, (m) => [
    kpi('Referrals today', m.kpis.referralsToday),
    kpi('Completed today', m.kpis.completedToday),
    kpi('Pending queue', m.kpis.pendingQueue),
    kpi('Radiology staff', m.kpis.radiologistStaffCount),
  ], (m) => [
    chart('line', 'Reports completed (today)', 'By hour', m.registrationVelocity, { xKey: 'hour', yKey: 'count' }),
    chart('bar', 'Request status', 'Pipeline', m.visitsByStatus, { xKey: 'status', yKey: 'count' }),
    chart('bar', 'By scan type', 'Today', m.visitsByScanType, { xKey: 'name', yKey: 'count' }),
    chart('bar', 'Radiology output', 'Today vs yesterday', [
      { name: 'Referrals today', count: m.kpis.referralsToday || 0 },
      { name: 'Completed today', count: m.kpis.completedToday || 0 },
      { name: 'Completed yesterday', count: m.kpis.completedYesterday || 0 },
      { name: 'Pending', count: m.kpis.pendingQueue || 0 },
    ], { xKey: 'name', yKey: 'count' }),
  ]);
}

async function getWardModule() {
  const merged = await aggregateSupervisorMetrics(getWardMetrics);
  return buildSupervisorModulePayload('ward', 'Ward & admissions', merged, (m) => [
    kpi('Registrations today', m.kpis.registrationsToday),
    kpi('Active admissions', m.kpis.activeAdmissions),
    kpi('Discharges today', m.kpis.dischargesToday),
    kpi('Avg triage wait (min)', m.kpis.avgTriageWaitMinutes),
  ], (m) => [
    chart('line', 'Admissions vs discharges', 'Today by hour', m.hourlyAdmissionsVsDischarges, {
      xKey: 'hour',
      yKeys: ['admissions', 'discharges'],
      multiLine: true,
    }),
    chart('pie', 'Ward occupancy', 'By area', m.occupancyByArea, { nameKey: 'name', valueKey: 'value' }),
    chart('bar', 'Pending triage', 'Arrival urgency', m.triageDistribution, { xKey: 'level', yKey: 'count' }),
    chart('bar', 'Ward flow today', 'Registrations & bed movement', [
      { name: 'Registrations', count: m.kpis.registrationsToday || 0 },
      { name: 'Active beds', count: m.kpis.activeAdmissions || 0 },
      { name: 'Discharges', count: m.kpis.dischargesToday || 0 },
    ], { xKey: 'name', yKey: 'count' }),
    chart('bar', 'Registration trend', 'Today vs yesterday', [
      { name: 'Today', count: m.kpis.registrationsToday || 0 },
      { name: 'Yesterday', count: m.kpis.registrationsYesterday || 0 },
    ], { xKey: 'name', yKey: 'count' }),
  ]);
}

async function getKitchenModule() {
  const today = new Date().toISOString().slice(0, 10);
  const plans = await MealPlan.findAll({
    where: { meal_date: today },
    attributes: ['id', 'meal_type', 'prepared', 'dispensed'],
    raw: true,
  });
  const rows = plans;
  const stats = {
    total: rows.length,
    prepared: rows.filter((p) => p.prepared).length,
    dispensed: rows.filter((p) => p.dispensed).length,
    pending: rows.filter((p) => !p.prepared).length,
  };
  const byType = ['breakfast', 'lunch', 'dinner'].map((type) => ({
    name: type,
    count: rows.filter((p) => p.meal_type === type).length,
    prepared: rows.filter((p) => p.meal_type === type && p.prepared).length,
  }));

  return {
    module: 'kitchen',
    title: 'Kitchen & diet',
    readOnly: true,
    kpis: [
      kpi('Meals planned today', stats.total),
      kpi('Prepared', stats.prepared),
      kpi('Dispensed', stats.dispensed),
      kpi('Pending prep', stats.pending),
    ],
    charts: [
      chart('bar', 'Meals by type', 'Planned today — all facilities', byType, { xKey: 'name', yKey: 'count' }),
      chart('bar', 'Meal pipeline', 'Prepared vs pending by type', byType.map((t) => ({
        name: t.name,
        prepared: t.prepared,
        pending: Math.max(0, t.count - t.prepared),
      })), { xKey: 'name', yKeys: ['prepared', 'pending'], stacked: true }),
      chart('bar', 'Dispensed meals', 'Served to patients', byType.map((t) => ({
        name: t.name,
        count: rows.filter((p) => p.meal_type === t.name && p.dispensed).length,
      })), { xKey: 'name', yKey: 'count' }),
      chart('pie', 'Kitchen status today', 'Overall meal state', [
        { name: 'Prepared', count: stats.prepared },
        { name: 'Pending prep', count: stats.pending },
        { name: 'Dispensed', count: stats.dispensed },
      ], { nameKey: 'name', valueKey: 'count' }),
    ],
  };
}

async function getVisitsTrend(days = 14) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (days - 1));
  startDate.setHours(0, 0, 0, 0);
  const rows = await Visit.findAll({
    attributes: [
      [sequelize.fn('DATE', sequelize.col('created_at')), 'date'],
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
    ],
    where: { created_at: { [Op.gte]: startDate } },
    group: [sequelize.fn('DATE', sequelize.col('created_at'))],
    order: [[sequelize.fn('DATE', sequelize.col('created_at')), 'ASC']],
    raw: true,
  });
  const byDate = Object.fromEntries(
    rows.map((r) => {
      const d = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10);
      return [d, parseInt(r.count, 10) || 0];
    })
  );
  const series = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    series.push({ date: key, count: byDate[key] || 0 });
  }
  return series;
}

const VISIT_TYPE_LABELS = { new: 'New', follow_up: 'Returning', emergency: 'Emergency' };

function labelEnum(value, labels = {}) {
  if (!value) return 'Unknown';
  return labels[value] || String(value).replace(/_/g, ' ');
}

async function groupedCount(Model, groupField, where = {}, labelMap = VISIT_TYPE_LABELS) {
  const rows = await Model.findAll({
    attributes: [groupField, [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    where,
    group: [groupField],
    raw: true,
  });
  return rows.map((r) => ({
    name: labelEnum(r[groupField], labelMap),
    count: parseInt(r.count, 10) || 0,
  }));
}

async function getEmergenciesTrend(days = 14) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (days - 1));
  startDate.setHours(0, 0, 0, 0);
  const rows = await Visit.findAll({
    attributes: [
      [sequelize.fn('DATE', sequelize.col('created_at')), 'date'],
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
    ],
    where: { visit_type: 'emergency', created_at: { [Op.gte]: startDate } },
    group: [sequelize.fn('DATE', sequelize.col('created_at'))],
    order: [[sequelize.fn('DATE', sequelize.col('created_at')), 'ASC']],
    raw: true,
  });
  const byDate = Object.fromEntries(
    rows.map((r) => {
      const d = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10);
      return [d, parseInt(r.count, 10) || 0];
    })
  );
  const series = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    series.push({ date: key, count: byDate[key] || 0 });
  }
  return series;
}

async function getRevenueDaily(days = 14) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (days - 1));
  startDate.setHours(0, 0, 0, 0);
  const rows = await Bill.findAll({
    attributes: [
      [sequelize.fn('DATE', sequelize.col('paid_at')), 'date'],
      [sequelize.fn('SUM', sequelize.col('paid_amount')), 'total'],
    ],
    where: { status: 'paid', paid_at: { [Op.gte]: startDate } },
    group: [sequelize.fn('DATE', sequelize.col('paid_at'))],
    order: [[sequelize.fn('DATE', sequelize.col('paid_at')), 'ASC']],
    raw: true,
  });
  const byDate = Object.fromEntries(
    rows.map((r) => {
      const d = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10);
      return [d, parseFloat(r.total) || 0];
    })
  );
  const series = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    series.push({ date: key, total: Math.round((byDate[key] || 0) * 100) / 100 });
  }
  return series;
}

async function getAdmissionDischargeTrend(days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (days - 1));
  startDate.setHours(0, 0, 0, 0);
  const [admRows, disRows] = await Promise.all([
    Admission.findAll({
      attributes: [
        [sequelize.fn('DATE', sequelize.col('admitted_at')), 'date'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      where: { admitted_at: { [Op.gte]: startDate } },
      group: [sequelize.fn('DATE', sequelize.col('admitted_at'))],
      raw: true,
    }),
    Admission.findAll({
      attributes: [
        [sequelize.fn('DATE', sequelize.col('discharged_at')), 'date'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      where: { discharged_at: { [Op.gte]: startDate } },
      group: [sequelize.fn('DATE', sequelize.col('discharged_at'))],
      raw: true,
    }),
  ]);
  const admMap = Object.fromEntries(
    admRows.map((r) => {
      const d = String(r.date).slice(0, 10);
      return [d, parseInt(r.count, 10) || 0];
    })
  );
  const disMap = Object.fromEntries(
    disRows.map((r) => {
      const d = String(r.date).slice(0, 10);
      return [d, parseInt(r.count, 10) || 0];
    })
  );
  const series = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    series.push({
      date: key,
      admissions: admMap[key] || 0,
      discharges: disMap[key] || 0,
    });
  }
  return series;
}

async function getStaffByFacility(limit = 10) {
  const rows = await User.findAll({
    attributes: ['facility_id', [sequelize.fn('COUNT', sequelize.col('User.id')), 'count']],
    where: { is_active: true },
    include: [{ model: Facility, as: 'facility', attributes: ['name'] }],
    group: ['facility_id', 'facility.id', 'facility.name'],
  });
  return rows
    .map((row) => {
      const plain = row.get({ plain: true });
      return {
        name: plain.facility?.name || 'Unknown',
        count: parseInt(plain.count, 10) || 0,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

async function getFacilitiesByTypeChart() {
  const rows = await Facility.findAll({
    attributes: ['type', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['type'],
    raw: true,
  });
  const labels = { hospital: 'State Hospital', clinic: 'Clinic', health_center: 'Health Center' };
  return rows.map((r) => ({
    name: labels[r.type] || r.type,
    count: parseInt(r.count, 10) || 0,
  }));
}

async function getOverviewPanel() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const [
    totalPatients, todayPatients, monthPatients, totalVisits, todayVisits, activeVisits,
    emergenciesToday, admittedNow, admissionsMonth, dischargesMonth, totalDeaths, deathsMonth,
    totalStaff, activeStaff, visitsTrend, emergenciesTrend, visitTypeMix, facilitiesByType,
    staffByFacility, queueWaiting,
  ] = await Promise.all([
    Patient.count(),
    Patient.count({ where: { created_at: { [Op.gte]: today } } }),
    Patient.count({ where: { created_at: { [Op.gte]: startOfMonth } } }),
    Visit.count(),
    Visit.count({ where: { created_at: { [Op.gte]: today } } }),
    Visit.count({ where: { status: 'in_progress' } }),
    Visit.count({ where: { visit_type: 'emergency', created_at: { [Op.gte]: today } } }),
    Admission.count({ where: { status: 'admitted' } }),
    Admission.count({ where: { admitted_at: { [Op.gte]: startOfMonth } } }),
    Admission.count({ where: { status: 'discharged', discharged_at: { [Op.gte]: startOfMonth } } }),
    MortuaryRecord.count(),
    MortuaryRecord.count({ where: { date_of_death: { [Op.gte]: startOfMonth } } }),
    User.count(),
    User.count({ where: { is_active: true } }),
    getVisitsTrend(14),
    getEmergenciesTrend(14),
    groupedCount(Visit, 'visit_type', { created_at: { [Op.gte]: startOfMonth } }),
    getFacilitiesByTypeChart(),
    getStaffByFacility(8),
    QueueEntry.count({ where: { status: 'waiting' } }),
  ]);

  return {
    module: 'overview',
    title: 'Executive overview',
    readOnly: true,
    kpis: [
      kpi('Total patients', totalPatients),
      kpi('Visits today', todayVisits),
      kpi('Active visits', activeVisits),
      kpi('Currently admitted', admittedNow),
      kpi('Active staff', activeStaff),
      kpi('Emergencies today', emergenciesToday),
    ],
    charts: [
      chart('line', 'Patient visits (14 days)', 'National daily volume', visitsTrend, { xKey: 'date', yKey: 'count' }),
      chart('line', 'Emergency visits (14 days)', 'Daily emergency attendances', emergenciesTrend, { xKey: 'date', yKey: 'count' }),
      chart('pie', 'Visit types (month)', 'New, returning, emergency', visitTypeMix, { nameKey: 'name', valueKey: 'count' }),
      chart('pie', 'Facilities by type', 'Network footprint', facilitiesByType, { nameKey: 'name', valueKey: 'count' }),
      chart('bar', 'Staff by facility', 'Active employees (top sites)', staffByFacility, { xKey: 'name', yKey: 'count', layout: 'vertical' }),
      chart('bar', 'Monthly activity', 'Key counters', [
        { name: 'New patients', count: monthPatients },
        { name: 'Admissions', count: admissionsMonth },
        { name: 'Discharges', count: dischargesMonth },
        { name: 'Deaths (month)', count: deathsMonth },
        { name: 'Queue waiting', count: queueWaiting },
      ], { xKey: 'name', yKey: 'count' }),
    ],
    summary: {
      totalVisits,
      totalStaff,
      todayRegistrations: todayPatients,
      totalDeaths,
    },
  };
}

async function getPatientsPanel() {
  const days = 30;
  const startDate = new Date(Date.now() - days * 86400000);
  const [byCategory, byPayment, bySex, dailyRegs, visitTypes, emergenciesTrend] = await Promise.all([
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
    Patient.findAll({
      attributes: ['sex', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['sex'],
      raw: true,
    }),
    Patient.findAll({
      attributes: [
        [sequelize.fn('DATE', sequelize.col('created_at')), 'date'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      where: { created_at: { [Op.gte]: startDate } },
      group: [sequelize.fn('DATE', sequelize.col('created_at'))],
      order: [[sequelize.fn('DATE', sequelize.col('created_at')), 'ASC']],
      raw: true,
    }),
    groupedCount(Visit, 'visit_type', { created_at: { [Op.gte]: startDate } }),
    getEmergenciesTrend(30),
  ]);

  const mapRows = (rows, key) =>
    rows.map((r) => ({
      name: r[key] ? String(r[key]).replace(/_/g, ' ') : 'Unknown',
      count: parseInt(r.count, 10) || 0,
    }));

  const regSeries = dailyRegs.map((r) => ({
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
    count: parseInt(r.count, 10) || 0,
  }));

  return {
    module: 'patients',
    title: 'Patients & registrations',
    readOnly: true,
    kpis: [
      kpi('Total patients', await Patient.count()),
      kpi('Registrations (30d)', regSeries.reduce((s, r) => s + r.count, 0)),
    ],
    charts: [
      chart('line', 'New registrations (30 days)', 'Daily patient registrations', regSeries, { xKey: 'date', yKey: 'count' }),
      chart('line', 'Emergency visits (30 days)', 'Daily emergency attendances', emergenciesTrend, { xKey: 'date', yKey: 'count' }),
      chart('pie', 'By category', 'Patient population', mapRows(byCategory, 'category'), { nameKey: 'name', valueKey: 'count' }),
      chart('pie', 'Visit types (30 days)', 'New, returning, emergency', visitTypes, { nameKey: 'name', valueKey: 'count' }),
      chart('bar', 'By payment type', 'Funding mix', mapRows(byPayment, 'payment_type'), { xKey: 'name', yKey: 'count' }),
      chart('bar', 'By sex', 'Demographics', mapRows(bySex, 'sex'), { xKey: 'name', yKey: 'count' }),
    ],
  };
}

async function getEmployeesPanel() {
  const byRoleRows = await User.findAll({
    attributes: [[sequelize.fn('COUNT', sequelize.col('User.id')), 'count']],
    include: [{ model: Role, as: 'role', attributes: ['name', 'display_name'] }],
    group: ['role_id', 'role.id', 'role.name', 'role.display_name'],
  });
  const roleChart = byRoleRows
    .map((row) => {
      const plain = row.get({ plain: true });
      return {
        name: plain.role?.display_name || plain.role?.name || 'Unknown',
        count: parseInt(plain.count, 10) || 0,
      };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  const activeVsInactive = await User.findAll({
    attributes: ['is_active', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['is_active'],
    raw: true,
  });
  const statusChart = activeVsInactive.map((r) => ({
    name: r.is_active ? 'Active' : 'Inactive',
    count: parseInt(r.count, 10) || 0,
  }));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [loggedInToday, staffByFacility, byFacilityInactive] = await Promise.all([
    User.count({ where: { last_login: { [Op.gte]: today } } }),
    getStaffByFacility(12),
    User.findAll({
      attributes: ['facility_id', [sequelize.fn('COUNT', sequelize.col('User.id')), 'count']],
      where: { is_active: false },
      include: [{ model: Facility, as: 'facility', attributes: ['name'] }],
      group: ['facility_id', 'facility.id', 'facility.name'],
    }),
  ]);

  const inactiveByFacility = byFacilityInactive
    .map((row) => {
      const plain = row.get({ plain: true });
      return {
        name: plain.facility?.name || 'Unknown',
        count: parseInt(plain.count, 10) || 0,
      };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    module: 'employees',
    title: 'Employees & workforce',
    readOnly: true,
    kpis: [
      kpi('Total staff', await User.count()),
      kpi('Active staff', await User.count({ where: { is_active: true } })),
      kpi('Logged in today', loggedInToday),
    ],
    charts: [
      chart('bar', 'Staff by role', 'All accounts', roleChart.slice(0, 12), { xKey: 'name', yKey: 'count', layout: 'vertical' }),
      chart('pie', 'Active vs inactive', 'Account status', statusChart, { nameKey: 'name', valueKey: 'count' }),
      chart('bar', 'Active staff by facility', 'Top sites', staffByFacility, { xKey: 'name', yKey: 'count', layout: 'vertical' }),
      chart('bar', 'Inactive by facility', 'Accounts disabled', inactiveByFacility, { xKey: 'name', yKey: 'count', layout: 'vertical' }),
    ],
  };
}

async function getRevenuePanel() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const [
    todayRev, monthRev, pendingBills, outstanding, discrepancies,
    revenueDaily, billStatus, cashMonth, eftMonth, shiftStatus,
  ] = await Promise.all([
    Bill.sum('paid_amount', { where: { status: 'paid', paid_at: { [Op.gte]: today } } }),
    Bill.sum('paid_amount', { where: { status: 'paid', paid_at: { [Op.gte]: startOfMonth } } }),
    Bill.count({ where: { status: 'pending_payment' } }),
    Bill.sum('total_amount', { where: { status: { [Op.in]: ['accumulating', 'pending_payment'] } } }),
    RevenueShift.count({ where: { status: 'discrepancy' } }),
    getRevenueDaily(14),
    groupedCount(Bill, 'status', {}, {
      accumulating: 'Accumulating',
      pending_payment: 'Pending payment',
      paid: 'Paid',
      waived: 'Waived',
    }),
    Bill.sum('cash_paid', { where: { status: 'paid', paid_at: { [Op.gte]: startOfMonth } } }),
    Bill.sum('eft_paid', { where: { status: 'paid', paid_at: { [Op.gte]: startOfMonth } } }),
    groupedCount(RevenueShift, 'status', {}, {
      open: 'Open',
      closed: 'Closed',
      reconciled: 'Reconciled',
      discrepancy: 'Discrepancy',
    }),
  ]);

  return {
    module: 'revenue',
    title: 'Revenue & billing',
    readOnly: true,
    kpis: [
      kpi('Revenue today (N$)', Number(todayRev || 0).toFixed(2)),
      kpi('Revenue this month (N$)', Number(monthRev || 0).toFixed(2)),
      kpi('Pending bills', pendingBills),
      kpi('Shift discrepancies', discrepancies),
    ],
    charts: [
      chart('line', 'Revenue collected (14 days)', 'Paid bills — N$', revenueDaily, { xKey: 'date', yKey: 'total', allowDecimals: true }),
      chart('pie', 'Bill status', 'All bills in system', billStatus, { nameKey: 'name', valueKey: 'count' }),
      chart('bar', 'Payment method (month)', 'Cash vs EFT collected', [
        { name: 'Cash', count: Number(cashMonth || 0) },
        { name: 'EFT', count: Number(eftMonth || 0) },
      ], { xKey: 'name', yKey: 'count', allowDecimals: true }),
      chart('bar', 'Billing snapshot', 'National totals', [
        { name: 'Collected today', count: Number(todayRev || 0) },
        { name: 'Collected (month)', count: Number(monthRev || 0) },
        { name: 'Outstanding', count: Number(outstanding || 0) },
        { name: 'Pending bills', count: pendingBills },
      ], { xKey: 'name', yKey: 'count', allowDecimals: true }),
      chart('pie', 'Revenue shift status', 'Billing clerk shifts', shiftStatus, { nameKey: 'name', valueKey: 'count' }),
    ],
  };
}

async function getDepartmentsPanel() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [waiting, completedToday, avgWait, inProgress, byPriority] = await Promise.all([
    QueueEntry.findAll({
      attributes: ['department', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      where: { status: 'waiting' },
      group: ['department'],
      raw: true,
    }),
    QueueEntry.findAll({
      attributes: ['department', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      where: { status: 'completed', completed_at: { [Op.gte]: today } },
      group: ['department'],
      raw: true,
    }),
    QueueEntry.findAll({
      attributes: [
        'department',
        [sequelize.fn('AVG', sequelize.literal('TIMESTAMPDIFF(MINUTE, created_at, started_at)')), 'avg_wait'],
      ],
      where: { status: 'completed', started_at: { [Op.ne]: null } },
      group: ['department'],
      raw: true,
    }),
    QueueEntry.findAll({
      attributes: ['department', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      where: { status: 'in_progress' },
      group: ['department'],
      raw: true,
    }),
    QueueEntry.findAll({
      attributes: ['priority', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      where: { status: 'waiting' },
      group: ['priority'],
      raw: true,
    }),
  ]);

  const mapDept = (rows) =>
    rows.map((r) => ({
      name: r.department,
      count: parseInt(r.count, 10) || 0,
      avg_wait: Math.round(Number(r.avg_wait) || 0),
    }));

  const priorityChart = byPriority.map((r) => ({
    name: r.priority || 'normal',
    count: parseInt(r.count, 10) || 0,
  }));

  return {
    module: 'departments',
    title: 'Departments & queues',
    readOnly: true,
    kpis: [
      kpi('Waiting now', waiting.reduce((s, r) => s + (parseInt(r.count, 10) || 0), 0)),
      kpi('In progress', inProgress.reduce((s, r) => s + (parseInt(r.count, 10) || 0), 0)),
      kpi('Completed today', completedToday.reduce((s, r) => s + (parseInt(r.count, 10) || 0), 0)),
    ],
    charts: [
      chart('bar', 'Currently waiting', 'By department', mapDept(waiting), { xKey: 'name', yKey: 'count' }),
      chart('bar', 'In progress now', 'Being served', mapDept(inProgress), { xKey: 'name', yKey: 'count' }),
      chart('bar', 'Completed today', 'Throughput', mapDept(completedToday), { xKey: 'name', yKey: 'count' }),
      chart('bar', 'Avg wait (minutes)', 'Completed entries', mapDept(avgWait), { xKey: 'name', yKey: 'avg_wait' }),
      chart('pie', 'Waiting by priority', 'Queue urgency', priorityChart, { nameKey: 'name', valueKey: 'count' }),
    ],
  };
}

async function getAdmissionsPanel() {
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [admitted, admissionsMonth, dischargesMonth, avgStay, flowTrend, byStatus] = await Promise.all([
    Admission.count({ where: { status: 'admitted' } }),
    Admission.count({ where: { admitted_at: { [Op.gte]: startOfMonth } } }),
    Admission.count({ where: { status: 'discharged', discharged_at: { [Op.gte]: startOfMonth } } }),
    Admission.findAll({
      attributes: [
        [sequelize.fn('AVG', sequelize.literal('TIMESTAMPDIFF(HOUR, admitted_at, discharged_at)')), 'avg_hours'],
      ],
      where: { status: 'discharged', discharged_at: { [Op.gte]: startOfMonth } },
      raw: true,
    }),
    getAdmissionDischargeTrend(30),
    groupedCount(Admission, 'status', {}, {
      admitted: 'Admitted',
      discharged: 'Discharged',
      pending_arrival: 'Pending arrival',
    }),
  ]);

  return {
    module: 'admissions',
    title: 'Admissions & discharges',
    readOnly: true,
    kpis: [
      kpi('Currently admitted', admitted),
      kpi('Admissions (month)', admissionsMonth),
      kpi('Discharges (month)', dischargesMonth),
      kpi('Avg stay (hours)', Math.round(Number(avgStay[0]?.avg_hours) || 0)),
    ],
    charts: [
      chart('line', 'Admissions & discharges (30 days)', 'Daily national flow', flowTrend, {
        xKey: 'date',
        yKeys: ['admissions', 'discharges'],
        multiLine: true,
      }),
      chart('bar', 'Monthly flow', 'Month to date', [
        { name: 'Admissions', count: admissionsMonth },
        { name: 'Discharges', count: dischargesMonth },
        { name: 'Currently in', count: admitted },
      ], { xKey: 'name', yKey: 'count' }),
      chart('pie', 'Admission status', 'All records', byStatus, { nameKey: 'name', valueKey: 'count' }),
    ],
  };
}

async function getMortalityPanel() {
  const startOfYear = new Date(new Date().getFullYear(), 0, 1);
  const [total, thisYear, monthly, byStatus] = await Promise.all([
    MortuaryRecord.count(),
    MortuaryRecord.count({ where: { date_of_death: { [Op.gte]: startOfYear } } }),
    MortuaryRecord.findAll({
      attributes: [
        [sequelize.fn('MONTH', sequelize.col('date_of_death')), 'month'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      where: { date_of_death: { [Op.gte]: startOfYear } },
      group: [sequelize.fn('MONTH', sequelize.col('date_of_death'))],
      order: [[sequelize.fn('MONTH', sequelize.col('date_of_death')), 'ASC']],
      raw: true,
    }),
    MortuaryRecord.findAll({
      attributes: ['body_status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['body_status'],
      raw: true,
    }),
  ]);

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthlyChart = monthly.map((r) => ({
    name: monthNames[(parseInt(r.month, 10) || 1) - 1],
    count: parseInt(r.count, 10) || 0,
  }));

  return {
    module: 'mortality',
    title: 'Mortality & mortuary',
    readOnly: true,
    kpis: [
      kpi('Total records', total),
      kpi('Deaths this year', thisYear),
    ],
    charts: [
      chart('bar', 'Deaths by month (YTD)', 'National', monthlyChart, { xKey: 'name', yKey: 'count' }),
      chart('line', 'Deaths trend (YTD)', 'Cumulative by month', monthlyChart.reduce((acc, row, i) => {
        const prev = acc[i - 1]?.cumulative || 0;
        acc.push({ name: row.name, cumulative: prev + row.count });
        return acc;
      }, []), { xKey: 'name', yKey: 'cumulative' }),
      chart('pie', 'Body status', 'Mortuary', byStatus.map((r) => ({
        name: r.body_status || 'unknown',
        count: parseInt(r.count, 10) || 0,
      })), { nameKey: 'name', valueKey: 'count' }),
      chart('bar', 'Mortuary summary', 'National', [
        { name: 'All-time records', count: total },
        { name: 'This year', count: thisYear },
      ], { xKey: 'name', yKey: 'count' }),
    ],
  };
}

async function getExecutivePanelPayload(moduleKey) {
  switch (moduleKey) {
    case 'overview':
      return getOverviewPanel();
    case 'patients':
      return getPatientsPanel();
    case 'employees':
      return getEmployeesPanel();
    case 'revenue':
      return getRevenuePanel();
    case 'departments':
      return getDepartmentsPanel();
    case 'admissions':
      return getAdmissionsPanel();
    case 'mortality':
      return getMortalityPanel();
    case 'pharmacy':
      return getPharmacyModule();
    case 'nursing':
      return getNursingModule();
    case 'doctor':
      return getDoctorModule();
    case 'front_office':
      return getFrontOfficeModule();
    case 'laboratory':
      return getLaboratoryModule();
    case 'radiology':
      return getRadiologyModule();
    case 'ward':
      return getWardModule();
    case 'kitchen':
      return getKitchenModule();
    default:
      return null;
  }
}

module.exports = {
  getExecutivePanelPayload,
  getExecutiveModulePayload: getExecutivePanelPayload,
  aggregateSupervisorMetrics,
};
