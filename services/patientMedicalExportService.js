'use strict';

const XLSX = require('xlsx');
const { Patient, Facility, Visit, QueueEntry } = require('../models');
const patientMedicalHistoryService = require('./patientMedicalHistoryService');
const { getMaternityMedicalHistory } = require('./maternityMedicalHistoryService');
const { MATERNITY_DEPARTMENTS } = require('../config/maternityConfig');

const MATERNITY_DEPT_SET = new Set(Object.values(MATERNITY_DEPARTMENTS));
const USER_ATTRS = ['id', 'first_name', 'last_name'];

function userName(user) {
  if (!user) return '';
  return [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
}

function formatTs(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

function formatScalar(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return '';
  return String(value).trim();
}

function flattenObjectLines(obj, prefix = '') {
  const lines = [];
  if (!obj || typeof obj !== 'object') return lines;

  Object.entries(obj).forEach(([key, value]) => {
    if (value == null || value === '') return;
    const label = prefix
      ? `${prefix} · ${key.replace(/_/g, ' ')}`
      : key.replace(/_/g, ' ');

    if (Array.isArray(value)) {
      if (!value.length) return;
      const text = value.map((item) => {
        if (item && typeof item === 'object') {
          return flattenObjectLines(item).map((l) => `${l.label}: ${l.value}`).join('; ');
        }
        return formatScalar(item) || String(item);
      }).filter(Boolean).join('; ');
      if (text) lines.push({ label, value: text });
      return;
    }

    if (typeof value === 'object') {
      lines.push(...flattenObjectLines(value, label));
      return;
    }

    const scalar = formatScalar(value);
    if (scalar) lines.push({ label, value: scalar });
  });

  return lines;
}

function clinicalDetailLines(clinical) {
  if (!clinical || typeof clinical !== 'object') return [];
  return flattenObjectLines(clinical);
}

async function loadVisitsWithStaff(patientId, facilityId) {
  const where = { patient_id: patientId };
  if (facilityId) where.facility_id = facilityId;

  return Visit.findAll({
    where,
    include: [
      { association: 'facility', attributes: ['id', 'name'] },
      { association: 'vitals', include: [{ association: 'recordedBy', attributes: USER_ATTRS }] },
      { association: 'screeningAssessment', include: [{ association: 'recordedBy', attributes: USER_ATTRS }] },
      { association: 'consultations', include: [{ association: 'doctor', attributes: USER_ATTRS }] },
      { association: 'emergencyInterventions', include: [{ association: 'recordedBy', attributes: USER_ATTRS }] },
      { association: 'maternityAncSessions', separate: true, include: [{ association: 'recordedBy', attributes: USER_ATTRS }] },
      { association: 'maternityAnwRecords', separate: true, include: [{ association: 'recordedBy', attributes: USER_ATTRS }] },
      { association: 'maternityPnwRecords', separate: true, include: [{ association: 'recordedBy', attributes: USER_ATTRS }] },
      { association: 'maternityIcuRecords', separate: true, include: [{ association: 'recordedBy', attributes: USER_ATTRS }] },
      { association: 'maternityNicuRecords', separate: true, include: [{ association: 'recordedBy', attributes: USER_ATTRS }] },
      { association: 'familyPlanningRecord', include: [{ association: 'recordedBy', attributes: USER_ATTRS }] },
      { association: 'prescriptions', include: [{ association: 'items' }] },
      { association: 'labRequests' },
      { association: 'sonarRequests' },
      { association: 'maternityEpisode' },
      { association: 'prepEpisode' },
      { association: 'artEpisode' },
      { association: 'dermatologyAssessment' },
      { association: 'papSmearScreening' },
      { association: 'socialWorkerAssessment' },
      { association: 'pediatricAssessment' },
      { association: 'hivTestResult' },
    ],
    order: [['created_at', 'DESC']],
  });
}

function collectMaternityRecorders(visit, department) {
  const names = new Set();
  const push = (user) => {
    const n = userName(user);
    if (n) names.add(n);
  };

  if (department === MATERNITY_DEPARTMENTS.ANC) {
    (visit.maternityAncSessions || []).forEach((row) => push(row.recordedBy));
  }
  if (department === MATERNITY_DEPARTMENTS.ANW) {
    (visit.maternityAnwRecords || []).forEach((row) => push(row.recordedBy));
  }
  if (department === MATERNITY_DEPARTMENTS.PNW) {
    (visit.maternityPnwRecords || []).forEach((row) => push(row.recordedBy));
  }
  if (department === MATERNITY_DEPARTMENTS.ICU) {
    (visit.maternityIcuRecords || []).forEach((row) => push(row.recordedBy));
  }
  if (department === MATERNITY_DEPARTMENTS.NICU) {
    (visit.maternityNicuRecords || []).forEach((row) => push(row.recordedBy));
  }

  return [...names];
}

function resolveAttendees(entry, visit, department) {
  const names = new Set();
  const add = (user) => {
    const n = userName(user);
    if (n) names.add(n);
  };

  if (entry?.assignedTo) add(entry.assignedTo);

  if (['parameter_nurse', 'nurse', 'anc_nurse'].includes(department)) {
    add(visit.vitals?.recordedBy);
  }
  if (department === 'emergency_unit') {
    add(visit.vitals?.recordedBy);
    add(visit.screeningAssessment?.recordedBy);
    (visit.emergencyInterventions || []).forEach((row) => add(row.recordedBy));
  }
  if (['master_doctor', 'doctor', 'emergency_unit_doctor'].includes(department)) {
    (visit.consultations || []).forEach((row) => add(row.doctor));
  }
  if (department === 'family_planning') {
    add(visit.familyPlanningRecord?.recordedBy);
  }
  if (MATERNITY_DEPT_SET.has(department)) {
    collectMaternityRecorders(visit, department).forEach((n) => names.add(n));
  }

  return [...names].join('; ');
}

function filterHistoryByScope(history, scope) {
  if (!history?.visits) return history;
  if (scope === 'all') return history;

  const visits = history.visits
    .map((visit) => ({
      ...visit,
      stops: (visit.stops || []).filter((stop) => {
        const isMaternity = MATERNITY_DEPT_SET.has(stop.department);
        if (scope === 'maternity') return isMaternity;
        if (scope === 'clinic') return !isMaternity;
        return true;
      }),
    }))
    .filter((visit) => visit.stops.length > 0);

  return { ...history, visits, meta: { ...(history.meta || {}), scope } };
}

async function getAdminMedicalHistory(patientId, facilityId, scope = 'all') {
  const resolvedFacilityId = facilityId || null;
  const base = scope === 'maternity'
    ? await getMaternityMedicalHistory(patientId, resolvedFacilityId)
    : await patientMedicalHistoryService.getClinicalMedicalHistory(patientId, resolvedFacilityId);

  return filterHistoryByScope(base, scope === 'maternity' ? 'maternity' : scope);
}

async function loadQueueEntriesByVisit(visitIds) {
  if (!visitIds.length) return new Map();

  const entries = await QueueEntry.findAll({
    where: { visit_id: visitIds },
    include: [
      { association: 'assignedTo', attributes: USER_ATTRS },
      { association: 'pushedBy', attributes: USER_ATTRS },
    ],
    order: [['created_at', 'ASC']],
  });

  const index = new Map();
  entries.forEach((entry) => {
    const key = `${entry.visit_id}:${entry.department}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(entry);
  });
  return index;
}

function attachQueueEntriesToHistory(history, entryIndex) {
  return {
    ...history,
    visits: (history.visits || []).map((visit) => ({
      ...visit,
      stops: (visit.stops || []).map((stop, idx) => {
        const key = `${visit.id}:${stop.department}`;
        const matches = entryIndex.get(key) || [];
        const entry = matches[idx] || matches[0] || null;
        return {
          ...stop,
          assigned_to_name: entry ? userName(entry.assignedTo) : '',
          routed_by: entry ? userName(entry.pushedBy) : '',
          _queueEntry: entry,
        };
      }),
    })),
  };
}

async function attachQueueStaffToHistory(patientId, facilityId, history) {
  const visitIds = (history.visits || []).map((v) => v.id);
  const entryIndex = await loadQueueEntriesByVisit(visitIds);
  const visitsWithStaff = await loadVisitsWithStaff(patientId, facilityId || null);
  const visitById = new Map(visitsWithStaff.map((v) => [v.id, v]));

  const enriched = attachQueueEntriesToHistory(history, entryIndex);

  return {
    ...enriched,
    visits: (enriched.visits || []).map((visit) => ({
      ...visit,
      stops: (visit.stops || []).map((stop) => {
        const visitModel = visitById.get(visit.id);
        return {
          ...stop,
          attendees: visitModel
            ? resolveAttendees(stop._queueEntry, visitModel, stop.department)
            : stop.assigned_to_name,
        };
      }),
    })),
  };
}

function scopeLabel(scope) {
  if (scope === 'maternity') return 'Maternity';
  if (scope === 'clinic') return 'Clinic (all departments)';
  return 'All records';
}

function buildRowsFromHistory({ patient, facilityLabel, history, visitById, scope }) {
  const patientLabel = [patient.first_name, patient.last_name].filter(Boolean).join(' ').trim();
  const label = scopeLabel(scope);
  const rows = [];

  (history.visits || []).forEach((visit) => {
    const visitModel = visitById.get(visit.id);
    const visitFacility = visit.facility_name || visitModel?.facility?.name || facilityLabel || '';
    (visit.stops || []).forEach((stop) => {
      const attendees = visitModel
        ? resolveAttendees(stop._queueEntry, visitModel, stop.department)
        : (stop.assigned_to_name || '');
      const routedBy = stop._queueEntry
        ? userName(stop._queueEntry.pushedBy)
        : (stop.routed_by || '');
      const details = clinicalDetailLines(stop.clinical);

      const base = {
        'Patient Number': patient.patient_number || '',
        'Patient Name': patientLabel,
        'National ID': patient.id_number || '',
        Facility: visitFacility,
        Scope: label,
        'Visit Number': visit.visit_number || '',
        'Visit Date': formatTs(visit.created_at),
        'Visit Type': visit.visit_type || '',
        'Visit Status': visit.status || '',
        Department: stop.department_label || stop.department || '',
        'Arrived At': formatTs(stop.arrived_at),
        'Started At': formatTs(stop.started_at),
        'Completed At': formatTs(stop.completed_at),
        'Attended By': attendees,
        'Routed By': routedBy,
      };

      if (!details.length) {
        rows.push({ ...base, 'Clinical Field': '', 'Clinical Value': stop.notes || '' });
        return;
      }

      details.forEach((detail) => {
        rows.push({ ...base, 'Clinical Field': detail.label, 'Clinical Value': detail.value });
      });
    });
  });

  return rows;
}

async function buildMedicalHistoryXlsx(patientId, facilityId, scope = 'all') {
  const [patient, history, visits] = await Promise.all([
    Patient.findByPk(patientId),
    getAdminMedicalHistory(patientId, facilityId || null, scope),
    loadVisitsWithStaff(patientId, facilityId || null),
  ]);

  if (!patient) {
    const err = new Error('Patient not found');
    err.status = 404;
    throw err;
  }

  let facilityLabel = 'All facilities';
  if (facilityId) {
    const facility = await Facility.findByPk(facilityId, { attributes: ['id', 'name'] });
    if (!facility) {
      const err = new Error('Facility not found');
      err.status = 404;
      throw err;
    }
    facilityLabel = facility.name;
  }

  const visitIds = (history.visits || []).map((v) => v.id);
  const entryIndex = await loadQueueEntriesByVisit(visitIds);
  const enriched = attachQueueEntriesToHistory(history, entryIndex);
  const visitById = new Map(visits.map((v) => [v.id, v]));

  const rows = buildRowsFromHistory({
    patient,
    facilityLabel,
    history: enriched,
    visitById,
    scope,
  });

  const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{
    'Patient Number': patient.patient_number,
    'Patient Name': [patient.first_name, patient.last_name].filter(Boolean).join(' '),
    Note: 'No clinical records found for this scope.',
  }]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Medical Card');

  const infoRows = [
    { Field: 'Exported At', Value: formatTs(new Date().toISOString()) },
    { Field: 'Patient Number', Value: patient.patient_number || '' },
    { Field: 'Patient Name', Value: [patient.first_name, patient.last_name].filter(Boolean).join(' ') },
    { Field: 'Facility', Value: facilityLabel },
    { Field: 'Scope', Value: scopeLabel(scope) },
    { Field: 'Total Rows', Value: String(rows.length) },
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(infoRows), 'Summary');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  getAdminMedicalHistory,
  attachQueueStaffToHistory,
  buildMedicalHistoryXlsx,
  filterHistoryByScope,
  loadVisitsWithStaff,
  loadQueueEntriesByVisit,
  attachQueueEntriesToHistory,
  resolveAttendees,
  clinicalDetailLines,
  userName,
  formatTs,
};
