'use strict';

const { HOSPITAL_OUTPATIENT_DEPARTMENTS } = require('./hospitalOutpatientConfig');

const VITALS_PROFILES = {
  temperature_pulse: {
    required: ['temperature', 'pulse_rate'],
    labels: {
      temperature: 'Temperature',
      pulse_rate: 'Pulse',
    },
    units: {
      temperature: '°C',
      pulse_rate: 'bpm',
    },
  },
  saturation_heart_rate: {
    required: ['oxygen_saturation', 'pulse_rate'],
    labels: {
      oxygen_saturation: 'Oxygen saturation',
      pulse_rate: 'Heart rate',
    },
    units: {
      oxygen_saturation: '%',
      pulse_rate: 'bpm',
    },
  },
  emergency_triage: {
    required: [
      'blood_pressure_systolic',
      'blood_pressure_diastolic',
      'respiratory_rate',
      'gcs_score',
      'oxygen_saturation',
      'pulse_rate',
    ],
    labels: {
      blood_pressure_systolic: 'Blood pressure (systolic)',
      blood_pressure_diastolic: 'Blood pressure (diastolic)',
      respiratory_rate: 'Respiratory rate',
      gcs_score: 'GCS',
      oxygen_saturation: 'Oxygen saturation',
      pulse_rate: 'Heart rate',
    },
    units: {
      blood_pressure_systolic: 'mmHg',
      blood_pressure_diastolic: 'mmHg',
      respiratory_rate: '/min',
      gcs_score: '',
      oxygen_saturation: '%',
      pulse_rate: 'bpm',
    },
  },
  blood_pressure_pain: {
    required: ['blood_pressure_systolic', 'blood_pressure_diastolic', 'pain_score'],
    labels: {
      blood_pressure_systolic: 'Blood pressure (systolic)',
      blood_pressure_diastolic: 'Blood pressure (diastolic)',
      pain_score: 'Pain score',
    },
    units: {
      blood_pressure_systolic: 'mmHg',
      blood_pressure_diastolic: 'mmHg',
      pain_score: '/10',
    },
  },
  blood_pressure_weight_glucose: {
    required: ['blood_pressure_systolic', 'blood_pressure_diastolic', 'weight', 'blood_glucose'],
    labels: {
      blood_pressure_systolic: 'Blood pressure (systolic)',
      blood_pressure_diastolic: 'Blood pressure (diastolic)',
      weight: 'Weight',
      blood_glucose: 'Blood glucose',
    },
    units: {
      blood_pressure_systolic: 'mmHg',
      blood_pressure_diastolic: 'mmHg',
      weight: 'kg',
      blood_glucose: 'mmol/L',
    },
  },
  big_room_vitals: {
    required: [
      'oxygen_saturation',
      'pulse_rate',
      'temperature',
      'blood_pressure_systolic',
      'blood_pressure_diastolic',
    ],
    labels: {
      oxygen_saturation: 'Oxygen saturation',
      pulse_rate: 'Heart rate',
      temperature: 'Temperature',
      blood_pressure_systolic: 'Blood pressure (systolic)',
      blood_pressure_diastolic: 'Blood pressure (diastolic)',
    },
    units: {
      oxygen_saturation: '%',
      pulse_rate: 'bpm',
      temperature: '°C',
      blood_pressure_systolic: 'mmHg',
      blood_pressure_diastolic: 'mmHg',
    },
  },
  blood_pressure_temperature: {
    required: ['blood_pressure_systolic', 'blood_pressure_diastolic', 'temperature'],
    labels: {
      blood_pressure_systolic: 'Blood pressure (systolic)',
      blood_pressure_diastolic: 'Blood pressure (diastolic)',
      temperature: 'Temperature',
    },
    units: {
      blood_pressure_systolic: 'mmHg',
      blood_pressure_diastolic: 'mmHg',
      temperature: '°C',
    },
  },
  mental_health_vitals: {
    required: ['pulse_rate', 'blood_pressure_systolic', 'blood_pressure_diastolic', 'pupillary_check'],
    labels: {
      pulse_rate: 'Pulse',
      blood_pressure_systolic: 'Blood pressure (systolic)',
      blood_pressure_diastolic: 'Blood pressure (diastolic)',
      pupillary_check: 'Pupillary check',
    },
    units: {
      pulse_rate: 'bpm',
      blood_pressure_systolic: 'mmHg',
      blood_pressure_diastolic: 'mmHg',
      pupillary_check: '',
    },
  },
};

const CLINICAL_DEPARTMENT_CONFIG = {
  [HOSPITAL_OUTPATIENT_DEPARTMENTS.PEDIATRIC]: {
    vitalsProfile: 'temperature_pulse',
    dischargeDiagnosis: 'Discharged from pediatric outpatient',
  },
  [HOSPITAL_OUTPATIENT_DEPARTMENTS.ENT]: {
    vitalsProfile: 'saturation_heart_rate',
    dischargeDiagnosis: 'Discharged from ENT outpatient',
  },
  [HOSPITAL_OUTPATIENT_DEPARTMENTS.EMERGENCY]: {
    vitalsProfile: 'emergency_triage',
    dischargeDiagnosis: 'Discharged from emergency unit',
  },
  [HOSPITAL_OUTPATIENT_DEPARTMENTS.ORTHOPEDIC]: {
    vitalsProfile: 'blood_pressure_pain',
    dischargeDiagnosis: 'Discharged from orthopedic outpatient',
    admitWardTypes: ['specialized_inpatient', 'surgical_complex'],
  },
  [HOSPITAL_OUTPATIENT_DEPARTMENTS.ADULT]: {
    vitalsProfile: 'blood_pressure_weight_glucose',
    dischargeDiagnosis: 'Discharged from adult outpatient',
    admitWardTypes: ['specialized_inpatient', 'surgical_complex'],
  },
  [HOSPITAL_OUTPATIENT_DEPARTMENTS.PHYSIOTHERAPY]: {
    vitalsProfile: 'saturation_heart_rate',
    dischargeDiagnosis: 'Discharged from physiotherapy and rehabilitation',
    admitWardTypes: ['specialized_inpatient'],
  },
  [HOSPITAL_OUTPATIENT_DEPARTMENTS.BIG_ROOM]: {
    vitalsProfile: 'big_room_vitals',
    dischargeDiagnosis: 'Discharged from big room specialist',
    admitWardTypes: ['specialized_inpatient'],
  },
  [HOSPITAL_OUTPATIENT_DEPARTMENTS.UROLOGY]: {
    vitalsProfile: 'blood_pressure_temperature',
    dischargeDiagnosis: 'Discharged from urology outpatient',
    admitWardTypes: ['icu', 'outpatient_specialist', 'surgical_complex'],
  },
  [HOSPITAL_OUTPATIENT_DEPARTMENTS.MENTAL_HEALTH]: {
    vitalsProfile: 'mental_health_vitals',
    dischargeDiagnosis: 'Discharged from mental health outpatient',
    admitWardTypes: ['specialized_inpatient', 'outpatient_specialist'],
  },
};

function clinicalConfigForDepartment(department) {
  return CLINICAL_DEPARTMENT_CONFIG[department] || null;
}

function vitalsProfileForDepartment(department) {
  const cfg = clinicalConfigForDepartment(department);
  if (!cfg) return null;
  return VITALS_PROFILES[cfg.vitalsProfile] || null;
}

function hasClinicalWorkspace(department) {
  return Boolean(clinicalConfigForDepartment(department));
}

function admitWardTypesForDepartment(department) {
  const cfg = clinicalConfigForDepartment(department);
  return cfg?.admitWardTypes || null;
}

function assertVitalsForProfile(vitals, profile) {
  if (!profile) throw new Error('Vitals profile not configured');
  for (const field of profile.required) {
    const value = vitals?.[field];
    if (value == null || value === '') {
      const label = profile.labels[field] || field;
      throw Object.assign(new Error(`${label} is required`), { statusCode: 400 });
    }
  }
}

function formatVitalsSummary(vitals, profile) {
  if (!profile || !vitals) return '';
  return profile.required
    .map((field) => {
      const label = profile.labels[field] || field;
      const unit = profile.units[field] || '';
      const value = vitals[field];
      return `${label}: ${value}${unit ? ` ${unit}` : ''}`;
    })
    .join('\n');
}

module.exports = {
  CLINICAL_DEPARTMENT_CONFIG,
  VITALS_PROFILES,
  clinicalConfigForDepartment,
  vitalsProfileForDepartment,
  hasClinicalWorkspace,
  admitWardTypesForDepartment,
  assertVitalsForProfile,
  formatVitalsSummary,
};
