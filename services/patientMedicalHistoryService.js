'use strict';

const { Visit, QueueEntry } = require('../models');
const { routingLabel } = require('../config/clinicQueueDepartments');

const VITAL_FIELDS = [
  'temperature',
  'blood_pressure_systolic',
  'blood_pressure_diastolic',
  'pulse_rate',
  'respiratory_rate',
  'weight',
  'height',
  'oxygen_saturation',
  'allergies',
  'chief_complaint',
  'onset_at',
  'aggravating_factors',
  'alleviating_factors',
  'current_medications',
  'immunization_status',
  'social_history',
  'physical_examination',
  'notes',
  'visit_classification',
];

function pick(obj, keys) {
  if (!obj) return null;
  const row = obj.toJSON ? obj.toJSON() : obj;
  const out = {};
  keys.forEach((key) => {
    if (row[key] !== undefined && row[key] !== null) out[key] = row[key];
  });
  return Object.keys(out).length ? out : null;
}

function sanitizeVitals(vitals) {
  return pick(vitals, VITAL_FIELDS);
}

function clinicalForDepartment(visit, department) {
  const v = visit;
  const dept = department;

  if (['parameter_nurse', 'nurse', 'emergency_unit'].includes(dept)) {
    return { vitals: sanitizeVitals(v.vitals) };
  }
  if (dept === 'screening_nurse' && v.screeningAssessment) {
    return pick(v.screeningAssessment, ['symptoms', 'reason', 'diagnosis', 'notes']);
  }
  if (['master_doctor', 'doctor', 'emergency_unit_doctor', 'dermatologist'].includes(dept)) {
    const rows = (v.consultations || []).map((c) =>
      pick(c, ['diagnosis', 'notes', 'actions_taken', 'created_at'])
    ).filter(Boolean);
    return rows.length ? { consultations: rows } : null;
  }
  if (dept === 'pap_smear' && v.papSmearScreening) {
    return pick(v.papSmearScreening, [
      'clinical_findings',
      'result',
      'recommendation',
      'notes',
    ]);
  }
  if (dept === 'social_worker' && v.socialWorkerAssessment) {
    return pick(v.socialWorkerAssessment, ['case_history', 'clinical_notes', 'notes']);
  }
  if (dept === 'pediatric' && v.pediatricAssessment) {
    return pick(v.pediatricAssessment, ['weight', 'height', 'findings', 'notes']);
  }
  if (dept === 'hiv_tester' && v.hivTestResult) {
    return pick(v.hivTestResult, ['result', 'test_type', 'notes']);
  }
  if (dept === 'lab' && v.labRequests?.length) {
    return {
      lab_requests: v.labRequests.map((r) => pick(r, ['test_type', 'status', 'clinical_notes'])).filter(Boolean),
    };
  }
  if (dept === 'sonar' && v.sonarRequests?.length) {
    return {
      imaging_requests: v.sonarRequests.map((r) => pick(r, ['scan_type', 'status', 'clinical_notes'])).filter(Boolean),
    };
  }
  if (dept === 'pharmacy' && v.prescriptions?.length) {
    return {
      prescriptions: v.prescriptions.map((rx) => ({
        status: rx.status,
        items: (rx.items || []).map((item) =>
          pick(item, ['medication_name', 'dosage', 'frequency', 'quantity', 'instructions'])
        ),
      })),
    };
  }

  return null;
}

function serializeStop(entry, visit) {
  return {
    department: entry.department,
    department_label: routingLabel(entry.department),
    status: entry.status,
    priority: entry.priority,
    arrived_at: entry.created_at,
    started_at: entry.started_at,
    completed_at: entry.completed_at,
    notes: entry.notes || null,
    clinical: clinicalForDepartment(visit, entry.department),
  };
}

function serializeVisit(visit, queueEntries) {
  const row = visit.toJSON ? visit.toJSON() : visit;
  const stops = (queueEntries || [])
    .filter((e) => e.visit_id === visit.id)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((entry) => serializeStop(entry, visit));

  return {
    id: row.id,
    visit_number: row.visit_number,
    visit_type: row.visit_type,
    status: row.status,
    created_at: row.created_at,
    completed_at: row.completed_at,
    current_department: row.current_department,
    vitals: sanitizeVitals(visit.vitals),
    stops,
  };
}

/**
 * Patient medical history: all visits, queue stops, vitals — no staff identities.
 */
async function getClinicalMedicalHistory(patientId, facilityId) {
  const visits = await Visit.findAll({
    where: { patient_id: patientId, facility_id: facilityId },
    include: [
      { association: 'vitals' },
      { association: 'screeningAssessment' },
      { association: 'papSmearScreening' },
      { association: 'socialWorkerAssessment' },
      { association: 'pediatricAssessment' },
      { association: 'hivTestResult' },
      { association: 'consultations' },
      { association: 'prescriptions', include: [{ association: 'items' }] },
      { association: 'labRequests' },
      { association: 'sonarRequests' },
    ],
    order: [['created_at', 'DESC']],
  });

  if (!visits.length) return { visits: [] };

  const visitIds = visits.map((v) => v.id);
  const queueEntries = await QueueEntry.findAll({
    where: { visit_id: visitIds },
    attributes: [
      'id',
      'visit_id',
      'department',
      'status',
      'priority',
      'position',
      'notes',
      'started_at',
      'completed_at',
      'created_at',
    ],
    order: [['created_at', 'ASC']],
  });

  return {
    visits: visits.map((visit) => serializeVisit(visit, queueEntries)),
  };
}

module.exports = {
  getClinicalMedicalHistory,
  sanitizeVitals,
};
