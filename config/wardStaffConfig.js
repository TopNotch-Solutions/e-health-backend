'use strict';

/** Ward types that use dedicated ward nurse roles (maternity uses ANC/ANW/PNW staff). */
const WARD_STAFF_DEFINITIONS = [
  { key: 'general_ward_nurse', wardType: 'general', label: 'General Ward', nurseLabel: 'General Ward Nurse' },
  { key: 'pediatric_ward_nurse', wardType: 'pediatric', label: 'Pediatric Ward', nurseLabel: 'Pediatric Ward Nurse' },
  { key: 'icu_ward_nurse', wardType: 'icu', label: 'ICU', nurseLabel: 'ICU Nurse' },
  { key: 'surgical_complex_nurse', wardType: 'surgical_complex', label: 'Surgical Complex', nurseLabel: 'Surgical Complex Nurse' },
  { key: 'specialized_inpatient_nurse', wardType: 'specialized_inpatient', label: 'Specialized Inpatient', nurseLabel: 'Specialized Inpatient Nurse' },
  { key: 'outpatient_specialist_nurse', wardType: 'outpatient_specialist', label: 'Outpatient Specialist', nurseLabel: 'Outpatient Specialist Nurse' },
  { key: 'psychiatric_ward_nurse', wardType: 'psychiatric', label: 'Psychiatric Ward', nurseLabel: 'Psychiatric Ward Nurse' },
];

const WARD_TYPE_BY_ROLE = Object.fromEntries(
  WARD_STAFF_DEFINITIONS.map((d) => [d.key, d.wardType])
);

const ROLE_BY_WARD_TYPE = Object.fromEntries(
  WARD_STAFF_DEFINITIONS.map((d) => [d.wardType, d.key])
);

const WARD_STAFF_ROLE_LABELS = Object.fromEntries(
  WARD_STAFF_DEFINITIONS.map((d) => [d.key, d.nurseLabel])
);

const WARD_STAFF_ROLE_SLUGS = WARD_STAFF_DEFINITIONS.map((d) => d.key);

function wardTypeForRole(roleName) {
  return WARD_TYPE_BY_ROLE[roleName] || null;
}

function isTypedWardStaffRole(roleName) {
  return Boolean(WARD_TYPE_BY_ROLE[roleName]);
}

function isAnyWardStaffRole(roleName) {
  return roleName === 'ward_staff' || isTypedWardStaffRole(roleName);
}

function wardStaffLabelForRole(roleName) {
  return WARD_STAFF_ROLE_LABELS[roleName] || 'Ward Staff';
}

module.exports = {
  WARD_STAFF_DEFINITIONS,
  WARD_STAFF_ROLE_SLUGS,
  WARD_STAFF_ROLE_LABELS,
  WARD_TYPE_BY_ROLE,
  ROLE_BY_WARD_TYPE,
  wardTypeForRole,
  isTypedWardStaffRole,
  isAnyWardStaffRole,
  wardStaffLabelForRole,
};
