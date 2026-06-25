'use strict';

const { ROLES } = require('./roles');
const { AUTHORIZED_CLINIC_ROLES } = require('./clinicRoles');

/**
 * Clinic facility department template — each department maps to one staff role.
 * queue_department is used for day-to-day queue activity stats (when applicable).
 */
const CLINIC_DEPARTMENT_DEFINITIONS = [
  { key: ROLES.FRONT_OFFICE, label: 'Front Office', queue_department: null, activity_mode: 'intake' },
  { key: ROLES.PARAMETER_NURSE, label: 'Parameter Nurse', queue_department: 'parameter_nurse', activity_mode: 'queue' },
  { key: ROLES.SCREENING_NURSE, label: 'Screening Nurse', queue_department: 'screening_nurse', activity_mode: 'queue' },
  { key: ROLES.MASTER_DOCTOR, label: 'Master Doctor', queue_department: 'master_doctor', activity_mode: 'queue' },
  { key: ROLES.ANC_NURSE, label: 'ANC Nurse', queue_department: 'anc_nurse', activity_mode: 'queue' },
  { key: ROLES.PEDIATRIC_CORNER, label: 'Pediatric Corner', queue_department: 'pediatric', activity_mode: 'queue' },
  { key: ROLES.PREP_SUITE, label: 'PrEP Suite', queue_department: 'prep', activity_mode: 'queue' },
  { key: ROLES.PAP_SMEAR_SUITE, label: 'Pap Smear Suite', queue_department: 'pap_smear', activity_mode: 'queue' },
  { key: ROLES.SOCIAL_WORKER, label: 'Social Worker', queue_department: 'social_worker', activity_mode: 'queue' },
  { key: ROLES.FAMILY_PLANNER, label: 'Family Planning', queue_department: 'family_planning', activity_mode: 'queue' },
  { key: ROLES.HIV_TESTER, label: 'HIV Testing Room', queue_department: 'hiv_tester', activity_mode: 'queue' },
  { key: ROLES.ART_NURSE, label: 'ART Nurse', queue_department: 'art_nurse', activity_mode: 'queue' },
  { key: ROLES.EMERGENCY_UNIT_NURSE, label: 'Emergency Unit Nurse', queue_department: 'emergency_unit', activity_mode: 'queue' },
  { key: ROLES.EMERGENCY_UNIT_DOCTOR, label: 'Emergency Unit Doctor', queue_department: 'emergency_unit_doctor', activity_mode: 'queue' },
  { key: ROLES.BOOKING_ROOM, label: 'Booking Room', queue_department: 'booking_room', activity_mode: 'queue' },
  { key: ROLES.DERMATOLOGIST, label: 'Dermatologist', queue_department: 'dermatologist', activity_mode: 'queue' },
  { key: ROLES.PHARMACIST, label: 'Pharmacy', queue_department: 'pharmacy', activity_mode: 'queue' },
  { key: ROLES.PHARMACY_SUPERVISOR, label: 'Pharmacy Supervisor', queue_department: 'pharmacy', activity_mode: 'queue' },
  { key: ROLES.BILLING_CLERK, label: 'Billing', queue_department: 'billing', activity_mode: 'queue' },
  { key: ROLES.REVENUE_OFFICER, label: 'Revenue Office', queue_department: 'billing', activity_mode: 'queue' },
];

const DEPARTMENT_BY_KEY = Object.fromEntries(
  CLINIC_DEPARTMENT_DEFINITIONS.map((d) => [d.key, d])
);

const VALID_DEPARTMENT_KEYS = new Set(CLINIC_DEPARTMENT_DEFINITIONS.map((d) => d.key));

/** Foundation departments — always required for every clinic. */
const FOUNDATION_CLINIC_DEPARTMENT_KEYS = [
  ROLES.FRONT_OFFICE,
  ROLES.PARAMETER_NURSE,
  ROLES.SCREENING_NURSE,
  ROLES.MASTER_DOCTOR,
];

/** @deprecated use FOUNDATION_CLINIC_DEPARTMENT_KEYS */
const MINIMAL_CLINIC_TEMPLATE_KEYS = FOUNDATION_CLINIC_DEPARTMENT_KEYS;

const FOUNDATION_DEPARTMENT_SET = new Set(FOUNDATION_CLINIC_DEPARTMENT_KEYS);

/** Full clinic template — all authorized clinic departments. */
const FULL_CLINIC_TEMPLATE_KEYS = CLINIC_DEPARTMENT_DEFINITIONS.map((d) => d.key);

/** Departments that require another department to be active. */
const DEPARTMENT_REQUIRES = {
  [ROLES.REVENUE_OFFICER]: ROLES.BILLING_CLERK,
};

/** When a department is removed, these dependent departments are removed automatically. */
const REMOVAL_CASCADE = {
  [ROLES.BILLING_CLERK]: [ROLES.REVENUE_OFFICER],
};

function getRequiredDepartment(departmentKey) {
  return DEPARTMENT_REQUIRES[departmentKey] || null;
}

function getCascadeRemovals(departmentKey) {
  return REMOVAL_CASCADE[departmentKey] ? [...REMOVAL_CASCADE[departmentKey]] : [];
}

function isFoundationDepartment(key) {
  return FOUNDATION_DEPARTMENT_SET.has(key);
}

function ensureFoundationDepartments(keys) {
  return [...new Set([...FOUNDATION_CLINIC_DEPARTMENT_KEYS, ...keys.filter(isValidDepartmentKey)])];
}

function normalizeCustomDepartmentKeys(keys) {
  const normalized = ensureFoundationDepartments(keys);
  if (!normalized.includes(ROLES.BILLING_CLERK)) {
    return normalized.filter((k) => k !== ROLES.REVENUE_OFFICER);
  }
  return normalized;
}

function departmentLabel(key) {
  return DEPARTMENT_BY_KEY[key]?.label || AUTHORIZED_CLINIC_ROLES[key] || key;
}

function isValidDepartmentKey(key) {
  return VALID_DEPARTMENT_KEYS.has(key);
}

function resolveTemplateKeys(template, customKeys) {
  if (template === 'full') return [...FULL_CLINIC_TEMPLATE_KEYS];
  if (template === 'custom' && Array.isArray(customKeys)) {
    return normalizeCustomDepartmentKeys(customKeys);
  }
  // Legacy minimal template + default
  if (template === 'minimal') return [...FOUNDATION_CLINIC_DEPARTMENT_KEYS];
  return [...FULL_CLINIC_TEMPLATE_KEYS];
}

module.exports = {
  CLINIC_DEPARTMENT_DEFINITIONS,
  DEPARTMENT_BY_KEY,
  FOUNDATION_CLINIC_DEPARTMENT_KEYS,
  MINIMAL_CLINIC_TEMPLATE_KEYS,
  FULL_CLINIC_TEMPLATE_KEYS,
  FOUNDATION_DEPARTMENT_SET,
  VALID_DEPARTMENT_KEYS,
  departmentLabel,
  isValidDepartmentKey,
  isFoundationDepartment,
  ensureFoundationDepartments,
  normalizeCustomDepartmentKeys,
  getRequiredDepartment,
  getCascadeRemovals,
  DEPARTMENT_REQUIRES,
  REMOVAL_CASCADE,
  resolveTemplateKeys,
};
