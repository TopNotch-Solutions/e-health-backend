'use strict';

const { ROLES } = require('./roles');

/** Default temporary password for new clinic employees. */
const CLINIC_DEFAULT_PASSWORD = 'Demo123!';

/** Shared across state hospitals and clinics. */
const SHARED_ROLE_SLUGS = [ROLES.FRONT_OFFICE];

/** State hospital roles (assignable at hospital and health_center facilities). */
const HOSPITAL_ROLE_SLUGS = [
  ROLES.FRONT_OFFICE_SUPERVISOR,
  ROLES.NURSE,
  ROLES.NURSE_SUPERVISOR,
  ROLES.DOCTOR,
  ROLES.DOCTOR_SUPERVISOR,
  ROLES.PHARMACIST,
  ROLES.PHARMACY_SUPERVISOR,
  ROLES.LAB_TECHNICIAN,
  ROLES.LABORATORY_SUPERVISOR,
  ROLES.RADIOLOGIST,
  ROLES.RADIOLOGIST_SUPERVISOR,
  ROLES.WARD_SUPERVISOR,
  ROLES.WARD_STAFF,
  ROLES.PORTER,
  ROLES.KITCHEN_STAFF,
  ROLES.KITCHEN_MANAGER,
  ROLES.BILLING_CLERK,
  ROLES.REVENUE_OFFICER,
  ROLES.MORTUARY_STAFF,
  ROLES.SOCIAL_WORKER,
  ROLES.DATA_ANALYST,
];

/** Clinic-only roles (plus shared front_office). */
const CLINIC_ONLY_ROLE_SLUGS = [
  ROLES.PARAMETER_NURSE,
  ROLES.SCREENING_NURSE,
  ROLES.ANC_NURSE,
  ROLES.PEDIATRIC_CORNER,
  ROLES.PREP_SUITE,
  ROLES.PAP_SMEAR_SUITE,
  ROLES.FAMILY_PLANNER,
  ROLES.HIV_TESTER,
  ROLES.EMERGENCY_UNIT_NURSE,
  ROLES.EMERGENCY_UNIT_DOCTOR,
  ROLES.MASTER_DOCTOR,
  ROLES.BOOKING_ROOM,
  ROLES.ART_NURSE,
];

const CLINIC_ROLE_SLUGS = [
  ...SHARED_ROLE_SLUGS,
  ...CLINIC_ONLY_ROLE_SLUGS,
  ROLES.PHARMACIST,
  ROLES.PHARMACY_SUPERVISOR,
];

const HOSPITAL_ASSIGNABLE_ROLE_SLUGS = [...SHARED_ROLE_SLUGS, ...HOSPITAL_ROLE_SLUGS];

/**
 * Authorized clinic module roles (slug → display label).
 * front_office is shared; all others are clinic-specific suites/stations.
 */
const AUTHORIZED_CLINIC_ROLES = {
  [ROLES.FRONT_OFFICE]: 'Front Office / Reception',
  [ROLES.PARAMETER_NURSE]: 'Parameter Nurse',
  [ROLES.SCREENING_NURSE]: 'Screening Nurse',
  [ROLES.ANC_NURSE]: 'ANC Nurse',
  [ROLES.PEDIATRIC_CORNER]: 'Pediatric Corner',
  [ROLES.PREP_SUITE]: 'PrEP Suite',
  [ROLES.PAP_SMEAR_SUITE]: 'Pap Smear Suite',
  [ROLES.FAMILY_PLANNER]: 'Family Planner',
  [ROLES.HIV_TESTER]: 'HIV Tester',
  [ROLES.EMERGENCY_UNIT_NURSE]: 'Emergency Unit Nurse',
  [ROLES.EMERGENCY_UNIT_DOCTOR]: 'Emergency Unit Doctor',
  [ROLES.MASTER_DOCTOR]: 'Master Doctor',
  [ROLES.BOOKING_ROOM]: 'Booking Room',
  [ROLES.ART_NURSE]: 'ART Nurse',
  [ROLES.PHARMACIST]: 'Pharmacist',
  [ROLES.PHARMACY_SUPERVISOR]: 'Pharmacy Supervisor',
};

function isAuthorizedClinicRole(roleName) {
  return CLINIC_ROLE_SLUGS.includes(roleName);
}

function isSharedRole(roleName) {
  return SHARED_ROLE_SLUGS.includes(roleName);
}

function isClinicFacility(facility) {
  return facility?.type === 'clinic';
}

function isHospitalFacility(facility) {
  return facility?.type === 'hospital' || facility?.type === 'health_center';
}

function getAllowedRoleSlugsForFacility(facility) {
  if (isClinicFacility(facility)) {
    return CLINIC_ROLE_SLUGS;
  }
  if (isHospitalFacility(facility)) {
    return HOSPITAL_ASSIGNABLE_ROLE_SLUGS;
  }
  return [];
}

function isRoleAllowedAtFacility(roleName, facility) {
  if (!roleName || !facility) return false;
  return getAllowedRoleSlugsForFacility(facility).includes(roleName);
}

module.exports = {
  CLINIC_DEFAULT_PASSWORD,
  SHARED_ROLE_SLUGS,
  HOSPITAL_ROLE_SLUGS,
  HOSPITAL_ASSIGNABLE_ROLE_SLUGS,
  AUTHORIZED_CLINIC_ROLES,
  CLINIC_ROLE_SLUGS,
  CLINIC_ONLY_ROLE_SLUGS,
  isAuthorizedClinicRole,
  isSharedRole,
  isClinicFacility,
  isHospitalFacility,
  getAllowedRoleSlugsForFacility,
  isRoleAllowedAtFacility,
};
