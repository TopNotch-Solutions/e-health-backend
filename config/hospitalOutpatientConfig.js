'use strict';

const { ROLES } = require('./roles');

/** Hospital outpatient queue department slugs (receiving departments for clinic referrals). */
const HOSPITAL_OUTPATIENT_DEPARTMENTS = {
  PEDIATRIC: 'pediatric_outpatient',
  ENT: 'ent_outpatient',
  EMERGENCY: 'hospital_emergency_unit',
  EYE: 'eye_outpatient',
  ORTHOPEDIC: 'orthopedic_outpatient',
  ADULT: 'adult_outpatient',
  PHYSIOTHERAPY: 'physiotherapy_rehabilitation',
  BIG_ROOM: 'big_room_specialist',
  UROLOGY: 'urology_outpatient',
  MENTAL_HEALTH: 'mental_health_outpatient',
};

const HOSPITAL_OUTPATIENT_DEFINITIONS = [
  { key: ROLES.PEDIATRIC_OUTPATIENT_NURSE, department: HOSPITAL_OUTPATIENT_DEPARTMENTS.PEDIATRIC, label: 'Pediatric Outpatient', nurseLabel: 'Pediatric Outpatient Nurse' },
  { key: ROLES.ENT_NURSE, department: HOSPITAL_OUTPATIENT_DEPARTMENTS.ENT, label: 'Ear, Nose and Throat', nurseLabel: 'ENT Nurse' },
  { key: ROLES.HOSPITAL_EMERGENCY_NURSE, department: HOSPITAL_OUTPATIENT_DEPARTMENTS.EMERGENCY, label: 'Emergency Unit', nurseLabel: 'Emergency Unit Nurse' },
  { key: ROLES.EYE_NURSE, department: HOSPITAL_OUTPATIENT_DEPARTMENTS.EYE, label: 'Eye', nurseLabel: 'Eye Nurse' },
  { key: ROLES.ORTHOPEDIC_OUTPATIENT_NURSE, department: HOSPITAL_OUTPATIENT_DEPARTMENTS.ORTHOPEDIC, label: 'Orthopedic Outpatient', nurseLabel: 'Orthopedic Outpatient Nurse' },
  { key: ROLES.ADULT_OUTPATIENT_NURSE, department: HOSPITAL_OUTPATIENT_DEPARTMENTS.ADULT, label: 'Adult Outpatient', nurseLabel: 'Adult Outpatient Nurse' },
  { key: ROLES.PHYSIOTHERAPY_NURSE, department: HOSPITAL_OUTPATIENT_DEPARTMENTS.PHYSIOTHERAPY, label: 'Physiotherapy and Rehabilitation', nurseLabel: 'Physiotherapy Nurse' },
  { key: ROLES.BIG_ROOM_SPECIALIST_NURSE, department: HOSPITAL_OUTPATIENT_DEPARTMENTS.BIG_ROOM, label: 'Big Room Specialist', nurseLabel: 'Big Room Specialist Nurse' },
  { key: ROLES.UROLOGY_NURSE, department: HOSPITAL_OUTPATIENT_DEPARTMENTS.UROLOGY, label: 'Urology', nurseLabel: 'Urology Nurse' },
  { key: ROLES.MENTAL_HEALTH_NURSE, department: HOSPITAL_OUTPATIENT_DEPARTMENTS.MENTAL_HEALTH, label: 'Mental Health', nurseLabel: 'Mental Health Nurse' },
];

const HOSPITAL_OUTPATIENT_ROLE_SLUGS = HOSPITAL_OUTPATIENT_DEFINITIONS.map((d) => d.key);

const DEPARTMENT_BY_ROLE = Object.fromEntries(
  HOSPITAL_OUTPATIENT_DEFINITIONS.map((d) => [d.key, d.department])
);

const ROLE_BY_DEPARTMENT = Object.fromEntries(
  HOSPITAL_OUTPATIENT_DEFINITIONS.map((d) => [d.department, d.key])
);

const DEPARTMENT_LABELS = Object.fromEntries(
  HOSPITAL_OUTPATIENT_DEFINITIONS.map((d) => [d.department, d.label])
);

const ROLE_LABELS = Object.fromEntries(
  HOSPITAL_OUTPATIENT_DEFINITIONS.map((d) => [d.key, d.nurseLabel])
);

/** Departments master doctor / emergency doctor may select (age-filtered). */
const CLINIC_DOCTOR_HOSPITAL_DEPARTMENTS = [
  HOSPITAL_OUTPATIENT_DEPARTMENTS.PEDIATRIC,
  HOSPITAL_OUTPATIENT_DEPARTMENTS.ENT,
  HOSPITAL_OUTPATIENT_DEPARTMENTS.EMERGENCY,
  HOSPITAL_OUTPATIENT_DEPARTMENTS.EYE,
  HOSPITAL_OUTPATIENT_DEPARTMENTS.ORTHOPEDIC,
  HOSPITAL_OUTPATIENT_DEPARTMENTS.ADULT,
  HOSPITAL_OUTPATIENT_DEPARTMENTS.PHYSIOTHERAPY,
  HOSPITAL_OUTPATIENT_DEPARTMENTS.BIG_ROOM,
  HOSPITAL_OUTPATIENT_DEPARTMENTS.UROLOGY,
  HOSPITAL_OUTPATIENT_DEPARTMENTS.MENTAL_HEALTH,
];

/** Social worker may only refer to these hospital departments. */
const SOCIAL_WORKER_HOSPITAL_DEPARTMENTS = [
  HOSPITAL_OUTPATIENT_DEPARTMENTS.UROLOGY,
  HOSPITAL_OUTPATIENT_DEPARTMENTS.MENTAL_HEALTH,
];

const PEDIATRIC_DEPARTMENT = HOSPITAL_OUTPATIENT_DEPARTMENTS.PEDIATRIC;

const ADULT_ELIGIBLE_DEPARTMENTS = CLINIC_DOCTOR_HOSPITAL_DEPARTMENTS.filter(
  (d) => d !== PEDIATRIC_DEPARTMENT
);

function calculateAgeYears(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age;
}

/** Children under 12 → pediatric; adults 12+ → non-pediatric departments. */
function allowedHospitalDepartmentsForPatient({ dateOfBirth, sourceRole }) {
  const age = calculateAgeYears(dateOfBirth);
  if (sourceRole === 'social_worker') {
    return [...SOCIAL_WORKER_HOSPITAL_DEPARTMENTS];
  }
  if (age != null && age < 12) {
    return [PEDIATRIC_DEPARTMENT];
  }
  return [...ADULT_ELIGIBLE_DEPARTMENTS];
}

function isValidHospitalDepartment(value) {
  return Boolean(DEPARTMENT_LABELS[value]);
}

function departmentLabel(value) {
  return DEPARTMENT_LABELS[value] || value;
}

function departmentForRole(roleName) {
  return DEPARTMENT_BY_ROLE[roleName] || null;
}

function routingOptionsForPatient({ dateOfBirth, sourceRole }) {
  const allowed = allowedHospitalDepartmentsForPatient({ dateOfBirth, sourceRole });
  return allowed.map((value) => ({ value, label: departmentLabel(value) }));
}

module.exports = {
  HOSPITAL_OUTPATIENT_DEPARTMENTS,
  HOSPITAL_OUTPATIENT_DEFINITIONS,
  HOSPITAL_OUTPATIENT_ROLE_SLUGS,
  DEPARTMENT_BY_ROLE,
  ROLE_BY_DEPARTMENT,
  DEPARTMENT_LABELS,
  ROLE_LABELS,
  CLINIC_DOCTOR_HOSPITAL_DEPARTMENTS,
  SOCIAL_WORKER_HOSPITAL_DEPARTMENTS,
  PEDIATRIC_DEPARTMENT,
  calculateAgeYears,
  allowedHospitalDepartmentsForPatient,
  isValidHospitalDepartment,
  departmentLabel,
  departmentForRole,
  routingOptionsForPatient,
};
