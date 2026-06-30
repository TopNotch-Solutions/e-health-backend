'use strict';

const { Visit, QueueEntry, Admission } = require('../models');
const { routingLabel } = require('../config/clinicQueueDepartments');
const {
  HOSPITAL_OUTPATIENT_DEPARTMENTS,
  departmentLabel: hospitalDepartmentLabel,
} = require('../config/hospitalOutpatientConfig');
const { departmentLabel, MATERNITY_DEPARTMENTS } = require('../config/maternityConfig');
const { serializeTransfer } = require('./clinicHospitalTransferService');

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

const HOSPITAL_VITAL_FIELDS = [
  ...VITAL_FIELDS,
  'gcs_score',
  'pain_score',
  'blood_glucose',
  'pupillary_check',
];

const HOSPITAL_OUTPATIENT_DEPT_SET = new Set(Object.values(HOSPITAL_OUTPATIENT_DEPARTMENTS));

const ICU_DAILY_RECORD_FIELDS = [
  'record_date',
  'heart_rate',
  'oxygen_saturation',
  'respiration_rate',
  'body_temperature',
  'blood_pressure_systolic',
  'blood_pressure_diastolic',
  'ventilator_pressures_volumes',
  'urine_output',
  'arterial_blood_gases',
  'neurological_checks',
  'created_at',
];

const SC_DAILY_RECORD_FIELDS = [
  'record_date',
  'heart_rate',
  'oxygen_saturation',
  'respiration_rate',
  'body_temperature',
  'blood_pressure_systolic',
  'blood_pressure_diastolic',
  'pulse_oximetry_spo2',
  'capnography_etco2',
  'fio2',
  'anesthesia_neuro_monitoring',
  'neuromuscular_tof',
  'pain_sedation_scores',
  'created_at',
];

const SI_DAILY_RECORD_FIELDS = [
  'record_date',
  'heart_rate',
  'oxygen_saturation',
  'respiration_rate',
  'body_temperature',
  'blood_pressure_systolic',
  'blood_pressure_diastolic',
  'created_at',
];

const AO_DAILY_RECORD_FIELDS = [
  'record_date',
  'heart_rate',
  'oxygen_saturation',
  'respiration_rate',
  'body_temperature',
  'blood_pressure_systolic',
  'blood_pressure_diastolic',
  'created_at',
];

const WARD_TYPE_LABELS = {
  icu: 'ICU',
  specialized_inpatient: 'Specialized inpatient',
  surgical_complex: 'Surgical complex',
  outpatient_specialist: 'Outpatient specialist',
  adult_outpatient: 'Adult outpatient',
};

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

function sanitizeHospitalOutpatientVitals(vitals) {
  return pick(vitals, HOSPITAL_VITAL_FIELDS);
}

function parseActionsTaken(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

function hospitalOutpatientConsultations(visit) {
  return (visit.consultations || [])
    .map((c) => {
      const actions = parseActionsTaken(c.actions_taken);
      if (!actions?.hospital_outpatient_disposition) return null;
      return pick(c, ['diagnosis', 'notes', 'actions_taken', 'created_at']);
    })
    .filter(Boolean);
}

function hospitalOutpatientClinical(visit) {
  const out = {};
  const vitals = sanitizeHospitalOutpatientVitals(visit.vitals);
  if (vitals) out.hospital_outpatient_vitals = vitals;

  const consultations = hospitalOutpatientConsultations(visit);
  if (consultations.length) out.hospital_outpatient_consultations = consultations;

  const transfer = clinicalTransferForHistory(visit.clinicHospitalTransfer);
  if (transfer) out.hospital_transfer = transfer;

  return Object.keys(out).length ? out : null;
}

function wardLabelForType(wardType, wardName) {
  if (wardType === 'icu') return 'ICU';
  if (wardName) return wardName;
  return WARD_TYPE_LABELS[wardType] ? `${WARD_TYPE_LABELS[wardType]} Ward` : 'Ward';
}

function wardDepartmentSlug(wardType) {
  if (wardType === 'icu') return 'icu_ward';
  if (wardType === 'surgical_complex') return 'surgical_complex_ward';
  if (wardType === 'specialized_inpatient') return 'specialized_inpatient_ward';
  if (wardType === 'adult_outpatient') return 'adult_outpatient_ward';
  return `ward_${wardType || 'inpatient'}`;
}

function serializeAdmissionStop(admission) {
  const ward = admission.bed?.ward;
  const wardType = ward?.ward_type;
  const department = wardDepartmentSlug(wardType);

  const clinical = {
    ward_admission: pick(admission, ['status', 'admitted_at', 'discharged_at', 'discharge_notes']),
    ward_location: pick(
      {
        ward_name: ward?.name || null,
        ward_type: wardType || null,
        room_number: admission.bed?.room_number || null,
        bed_number: admission.bed?.bed_number || null,
      },
      ['ward_name', 'ward_type', 'room_number', 'bed_number']
    ),
  };

  const icuRecords = (admission.icuDailyRecords || [])
    .map((row) => pick(row, ICU_DAILY_RECORD_FIELDS))
    .filter(Boolean);
  if (icuRecords.length) clinical.icu_daily_records = icuRecords;

  const scRecords = (admission.surgicalComplexDailyRecords || [])
    .map((row) => pick(row, SC_DAILY_RECORD_FIELDS))
    .filter(Boolean);
  if (scRecords.length) clinical.surgical_complex_daily_records = scRecords;

  const siRecords = (admission.specializedInpatientDailyRecords || [])
    .map((row) => pick(row, SI_DAILY_RECORD_FIELDS))
    .filter(Boolean);
  if (siRecords.length) clinical.specialized_inpatient_daily_records = siRecords;

  const aoRecords = (admission.adultOutpatientDailyRecords || [])
    .map((row) => pick(row, AO_DAILY_RECORD_FIELDS))
    .filter(Boolean);
  if (aoRecords.length) clinical.adult_outpatient_daily_records = aoRecords;

  const firstRecordAt =
    admission.icuDailyRecords?.[0]?.created_at
    || admission.surgicalComplexDailyRecords?.[0]?.created_at
    || admission.specializedInpatientDailyRecords?.[0]?.created_at
    || admission.adultOutpatientDailyRecords?.[0]?.created_at
    || null;

  return {
    department,
    department_label: wardLabelForType(wardType, ward?.name),
    status: admission.status,
    priority: null,
    arrived_at: admission.admitted_at || firstRecordAt || null,
    started_at: admission.admitted_at,
    completed_at: admission.discharged_at,
    notes: null,
    clinical: Object.keys(clinical).length ? clinical : null,
  };
}

function screeningAssessmentClinical(assessment) {
  const row = pick(assessment, ['symptoms', 'reason', 'diagnosis', 'notes']);
  return row ? { screening_assessment: row } : null;
}

function consultationsClinical(visit) {
  const rows = (visit.consultations || []).map((c) =>
    pick(c, ['diagnosis', 'notes', 'actions_taken', 'created_at'])
  ).filter(Boolean);
  return rows.length ? { consultations: rows } : null;
}

function clinicalTransferForHistory(transfer) {
  if (!transfer) return null;
  const plain = serializeTransfer(transfer, { includeTimeline: false });
  const row = pick(plain, [
    'destination_department',
    'transfer_status',
    'transfer_reason',
    'equipment_required',
    'equipment_notes',
    'equipment_checklist',
    'external_porter_notes',
    'internal_porter_notes',
    'critical_notes',
  ]);
  if (!row) return null;
  if (transfer.hospitalFacility?.name) {
    row.destination_hospital = transfer.hospitalFacility.name;
  }
  if (row.destination_department) {
    row.destination_department_label = hospitalDepartmentLabel(row.destination_department);
  }
  return row;
}

function latestReferralClinical(referrals) {
  const rows = (referrals || [])
    .map((r) => pick(r, ['referral_type', 'reason', 'destination', 'status', 'created_at']))
    .filter(Boolean)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  return rows[0] ? { referral: rows[0] } : null;
}

function resolvePrepEpisode(visit) {
  return visit.prepEpisode || null;
}

function hivTestResultClinical(testResult) {
  if (!testResult) return null;
  const row = pick(testResult, ['result', 'test_method', 'kit_batch', 'notes', 'created_at']);
  if (!row) return null;
  if (row.result === 'positive') row.result_label = 'Positive';
  if (row.result === 'negative') row.result_label = 'Negative';
  return row;
}

function hivTesterRoutingOutcome(visit, testResult) {
  if (!testResult?.result) return null;
  if (testResult.result === 'positive') return 'Escalated to ART nurse';
  if (resolvePrepEpisode(visit)) return 'Routed to PrEP Suite';
  return 'Testing session complete';
}

function hivTesterClinical(visit) {
  const hivTest = hivTestResultClinical(visit.hivTestResult);
  if (!hivTest) return null;
  const out = { hiv_test_result: hivTest };
  const routing = hivTesterRoutingOutcome(visit, visit.hivTestResult);
  if (routing) out.routing_outcome = routing;
  return out;
}

function prepEpisodeClinical(visit) {
  const episode = resolvePrepEpisode(visit);
  if (!episode) return null;
  const row = pick(episode, [
    'status',
    'injection_administered',
    'session_data',
    'enrolled_at',
    'injection_administered_at',
    'completed_at',
  ]);
  if (!row) return null;
  const out = { prep_episode: row };
  const hivTest = hivTestResultClinical(visit.hivTestResult);
  if (hivTest) out.hiv_test_result = hivTest;
  return out;
}

function routingLabelForDepartment(dept) {
  if (Object.values(MATERNITY_DEPARTMENTS).includes(dept)) {
    return departmentLabel(dept);
  }
  return routingLabel(dept);
}

function serializeMaternityRecords(records, fields) {
  return (records || [])
    .map((row) => pick(row, fields))
    .filter(Boolean);
}

function maternityClinicalForDepartment(visit, department) {
  const v = visit;

  if (department === MATERNITY_DEPARTMENTS.ANC) {
    const sessions = serializeMaternityRecords(v.maternityAncSessions, [
      'session_number', 'is_first_visit', 'baseline_history', 'general_physical_exam',
      'special_investigations', 'delivery_details', 'no_further_session_required',
      'follow_up_date', 'signed_off_at',
    ]);
    return sessions.length ? { maternity_anc_sessions: sessions } : null;
  }

  if (department === MATERNITY_DEPARTMENTS.ANW) {
    const records = serializeMaternityRecords(v.maternityAnwRecords, [
      'record_date', 'is_admission_day', 'admission_reason', 'mode_of_arrival',
      'vitals', 'abdominal_update', 'active_labour', 'serial_progress', 'signed_off_at',
    ]);
    return records.length ? { maternity_anw_daily_records: records } : null;
  }

  if (department === MATERNITY_DEPARTMENTS.PNW) {
    const records = serializeMaternityRecords(v.maternityPnwRecords, [
      'record_date', 'is_post_delivery_day', 'delivery_type', 'post_op_recovery',
      'vitals', 'uterine_index', 'physiological_output', 'breast_examination', 'signed_off_at',
    ]);
    const episode = v.maternityEpisode
      ? pick(v.maternityEpisode, [
        'feeding_counselling_done', 'six_week_follow_up_date', 'discharged_at', 'current_ward',
      ])
      : null;
    const out = {};
    if (records.length) out.maternity_pnw_daily_records = records;
    if (episode) out.maternity_episode = episode;
    return Object.keys(out).length ? out : null;
  }

  if (department === MATERNITY_DEPARTMENTS.ICU) {
    const records = serializeMaternityRecords(v.maternityIcuRecords, [
      'record_date', 'extreme_indicators', 'continuous_parameters',
      'multiple_origin_tracking', 'signed_off_at',
    ]);
    return records.length ? { maternity_icu_daily_records: records } : null;
  }

  if (department === MATERNITY_DEPARTMENTS.NICU) {
    const records = serializeMaternityRecords(v.maternityNicuRecords, [
      'date_time_of_birth', 'sex', 'name', 'gestation_weeks',
      'clinical_status', 'apgar_matrix', 'child_patient_id',
    ]);
    return records.length ? { maternity_nicu_records: records } : null;
  }

  if (department === MATERNITY_DEPARTMENTS.FRONT_OFFICE && v.maternityEpisode) {
    return pick(v.maternityEpisode, [
      'current_ward', 'admitted_at', 'discharged_at', 'front_office_visits',
      'anw_days', 'pnw_days', 'icu_days', 'status',
    ]);
  }

  return null;
}

function clinicalForDepartment(visit, department) {
  const v = visit;
  const dept = department;

  const maternityClinical = maternityClinicalForDepartment(v, dept);
  if (maternityClinical) return maternityClinical;

  if (['parameter_nurse', 'nurse', 'anc_nurse'].includes(dept)) {
    const vitals = sanitizeVitals(v.vitals);
    return vitals ? { vitals } : null;
  }
  if (dept === 'emergency_unit') {
    const out = {};
    const vitals = sanitizeVitals(v.vitals);
    if (vitals) out.vitals = vitals;
    const screening = screeningAssessmentClinical(v.screeningAssessment);
    if (screening) Object.assign(out, screening);
    if (v.emergencyInterventions?.length) {
      out.emergency_interventions = v.emergencyInterventions.map((row) =>
        pick(row, ['interventions', 'notes', 'created_at'])
      ).filter(Boolean);
    }
    return Object.keys(out).length ? out : null;
  }
  if (dept === 'screening_nurse') {
    return screeningAssessmentClinical(v.screeningAssessment);
  }
  if (dept === 'dermatologist' && v.dermatologyAssessment) {
    const assessment = pick(v.dermatologyAssessment, [
      'clinical_observations',
      'skin_assessment',
      'differential_diagnosis',
      'treatment_plan',
    ]);
    return assessment ? { dermatology_assessment: assessment } : null;
  }
  if (['master_doctor', 'doctor', 'emergency_unit_doctor'].includes(dept)) {
    return consultationsClinical(v);
  }
  if (dept === 'booking_room') {
    const out = {};
    const transfer = clinicalTransferForHistory(v.clinicHospitalTransfer);
    if (transfer) out.hospital_transfer = transfer;
    const referral = latestReferralClinical(v.referrals);
    if (referral) Object.assign(out, referral);
    if (v.mortuaryRecord) {
      const mortuary = pick(v.mortuaryRecord, ['cause_of_death', 'date_of_death', 'notes']);
      if (mortuary) out.mortuary = mortuary;
    }
    return Object.keys(out).length ? out : null;
  }
  if (dept === 'family_planning' && v.familyPlanningRecord) {
    const record = pick(v.familyPlanningRecord, [
      'intervention_type',
      'subdermal_insertion_date',
      'subdermal_insertion_notes',
      'subdermal_replacement_date',
      'subdermal_replacement_notes',
      'device_type',
      'device_insertion_date',
      'device_insertion_notes',
      'device_removal_date',
      'device_removal_notes',
      'oral_contraceptive_log',
      'circumcision_surgical_criteria',
      'circumcision_procedure_notes',
      'circumcision_post_op_metrics',
      'session_completed_at',
    ]);
    return record ? { family_planning: record } : null;
  }
  if (dept === 'prep') {
    return prepEpisodeClinical(v);
  }
  if (dept === 'art_nurse' && v.artEpisode) {
    const episode = pick(v.artEpisode, [
      'pathway_state',
      'status',
      'pathway_data',
      'enrolled_at',
      'state_entered_at',
    ]);
    return episode ? { art_episode: episode } : null;
  }
  if (dept === 'pap_smear' && v.papSmearScreening) {
    const screening = pick(v.papSmearScreening, [
      'clinical_findings',
      'result',
      'recommendation',
      'notes',
    ]);
    return screening ? { pap_smear_screening: screening } : null;
  }
  if (dept === 'social_worker' && v.socialWorkerAssessment) {
    const assessment = pick(v.socialWorkerAssessment, ['case_history', 'clinical_notes', 'notes']);
    return assessment ? { social_worker_assessment: assessment } : null;
  }
  if (dept === 'pediatric' && v.pediatricAssessment) {
    const assessment = pick(v.pediatricAssessment, ['weight', 'height', 'findings', 'notes']);
    return assessment ? { pediatric_assessment: assessment } : null;
  }
  if (dept === 'hiv_tester') {
    return hivTesterClinical(v);
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
  if (HOSPITAL_OUTPATIENT_DEPT_SET.has(dept)) {
    return hospitalOutpatientClinical(v);
  }

  return null;
}

function serializeStop(entry, visit) {
  return {
    department: entry.department,
    department_label: routingLabelForDepartment(entry.department),
    status: entry.status,
    priority: entry.priority,
    arrived_at: entry.created_at,
    started_at: entry.started_at,
    completed_at: entry.completed_at,
    notes: entry.notes || null,
    clinical: clinicalForDepartment(visit, entry.department),
  };
}

function stopSortTime(stop) {
  return new Date(stop.arrived_at || stop.started_at || 0).getTime();
}

function serializeVisit(visit, queueEntries, admissions = []) {
  const row = visit.toJSON ? visit.toJSON() : visit;
  const queueStops = (queueEntries || [])
    .filter((e) => e.visit_id === visit.id)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((entry) => serializeStop(entry, visit));

  const admissionStops = (admissions || [])
    .filter((a) => a.visit_id === visit.id)
    .map((admission) => serializeAdmissionStop(admission));

  const stops = [...queueStops, ...admissionStops].sort((a, b) => stopSortTime(a) - stopSortTime(b));

  return {
    id: row.id,
    visit_number: row.visit_number,
    visit_type: row.visit_type,
    status: row.status,
    facility_id: row.facility_id || visit.facility_id || null,
    facility_name: visit.facility?.name || row.facility?.name || null,
    created_at: row.created_at,
    completed_at: row.completed_at,
    current_department: row.current_department,
    vitals: sanitizeVitals(visit.vitals),
    stops,
  };
}

/**
 * Patient medical history: all visits, queue stops, vitals — no staff identities.
 * @param {string} patientId
 * @param {string|null|undefined} facilityId — omit or null for all facilities (system admin)
 */
async function getClinicalMedicalHistory(patientId, facilityId) {
  const where = { patient_id: patientId };
  if (facilityId) where.facility_id = facilityId;

  const visits = await Visit.findAll({
    where,
    include: [
      { association: 'facility', attributes: ['id', 'name'] },
      { association: 'vitals', required: false },
      { association: 'screeningAssessment' },
      { association: 'papSmearScreening' },
      { association: 'socialWorkerAssessment' },
      { association: 'pediatricAssessment' },
      { association: 'hivTestResult' },
      { association: 'familyPlanningRecord' },
      { association: 'prepEpisode' },
      { association: 'artEpisode' },
      { association: 'dermatologyAssessment' },
      { association: 'emergencyInterventions' },
      { association: 'consultations' },
      { association: 'prescriptions', include: [{ association: 'items' }] },
      { association: 'labRequests' },
      { association: 'sonarRequests' },
      { association: 'maternityEpisode' },
      { association: 'maternityAncSessions', separate: true, order: [['session_number', 'ASC']] },
      { association: 'maternityAnwRecords', separate: true, order: [['record_date', 'ASC']] },
      { association: 'maternityPnwRecords', separate: true, order: [['record_date', 'ASC']] },
      { association: 'maternityIcuRecords', separate: true, order: [['record_date', 'ASC']] },
      { association: 'maternityNicuRecords', separate: true, order: [['created_at', 'ASC']] },
      {
        association: 'clinicHospitalTransfer',
        required: false,
        include: [{ association: 'hospitalFacility', attributes: ['id', 'name'] }],
      },
      { association: 'referrals', required: false },
      { association: 'mortuaryRecord', required: false },
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

  const admissions = await Admission.findAll({
    where: { visit_id: visitIds },
    include: [
      {
        association: 'bed',
        attributes: ['id', 'bed_number', 'room_number', 'ward_id'],
        include: [{ association: 'ward', attributes: ['id', 'name', 'ward_type'] }],
      },
      {
        association: 'icuDailyRecords',
        separate: true,
        order: [['record_date', 'ASC'], ['created_at', 'ASC']],
      },
      {
        association: 'surgicalComplexDailyRecords',
        separate: true,
        order: [['record_date', 'ASC'], ['created_at', 'ASC']],
      },
      {
        association: 'specializedInpatientDailyRecords',
        separate: true,
        order: [['record_date', 'ASC'], ['created_at', 'ASC']],
      },
      {
        association: 'adultOutpatientDailyRecords',
        separate: true,
        order: [['record_date', 'ASC'], ['created_at', 'ASC']],
      },
    ],
    order: [['admitted_at', 'ASC']],
  });

  return {
    visits: visits.map((visit) => serializeVisit(visit, queueEntries, admissions)),
  };
}

module.exports = {
  getClinicalMedicalHistory,
  sanitizeVitals,
};
