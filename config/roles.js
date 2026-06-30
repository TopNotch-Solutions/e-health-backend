const ROLES = {
  // Shared (state hospital + clinic)
  FRONT_OFFICE: 'front_office',
  // State hospital roles
  FRONT_OFFICE_SUPERVISOR: 'front_office_supervisor',
  NURSE: 'nurse',
  NURSE_SUPERVISOR: 'nurse_supervisor',
  DOCTOR: 'doctor',
  DOCTOR_SUPERVISOR: 'doctor_supervisor',
  PHARMACIST: 'pharmacist',
  PHARMACY_SUPERVISOR: 'pharmacy_supervisor',
  LAB_TECHNICIAN: 'lab_technician',
  LABORATORY_SUPERVISOR: 'laboratory_supervisor',
  RADIOLOGIST: 'radiologist',
  RADIOLOGIST_SUPERVISOR: 'radiologist_supervisor',
  WARD_SUPERVISOR: 'ward_supervisor',
  WARD_STAFF: 'ward_staff',
  GENERAL_WARD_NURSE: 'general_ward_nurse',
  PEDIATRIC_WARD_NURSE: 'pediatric_ward_nurse',
  ICU_WARD_NURSE: 'icu_ward_nurse',
  SURGICAL_COMPLEX_NURSE: 'surgical_complex_nurse',
  SPECIALIZED_INPATIENT_NURSE: 'specialized_inpatient_nurse',
  OUTPATIENT_SPECIALIST_NURSE: 'outpatient_specialist_nurse',
  PSYCHIATRIC_WARD_NURSE: 'psychiatric_ward_nurse',
  /** @deprecated use INTERNAL_PORTER — legacy slug kept for existing accounts */
  PORTER: 'porter',
  INTERNAL_PORTER: 'internal_porter',
  EXTERNAL_PORTER: 'external_porter',
  KITCHEN_STAFF: 'kitchen_staff',
  KITCHEN_MANAGER: 'kitchen_manager',
  BILLING_CLERK: 'billing_clerk',
  REVENUE_OFFICER: 'revenue_officer',
  MORTUARY_STAFF: 'mortuary_staff',
  SOCIAL_WORKER: 'social_worker',
  DATA_ANALYST: 'data_analyst',
  SYSTEM_ADMIN: 'system_admin',
  EXECUTIVE: 'executive',
  // Clinic-only roles (see config/clinicRoles.js)
  PARAMETER_NURSE: 'parameter_nurse',
  SCREENING_NURSE: 'screening_nurse',
  ANC_NURSE: 'anc_nurse',
  PEDIATRIC_CORNER: 'pediatric_corner',
  PREP_SUITE: 'prep_suite',
  PAP_SMEAR_SUITE: 'pap_smear_suite',
  FAMILY_PLANNER: 'family_planner',
  HIV_TESTER: 'hiv_tester',
  EMERGENCY_UNIT_NURSE: 'emergency_unit_nurse',
  EMERGENCY_UNIT_DOCTOR: 'emergency_unit_doctor',
  MASTER_DOCTOR: 'master_doctor',
  BOOKING_ROOM: 'booking_room',
  ART_NURSE: 'art_nurse',
  DERMATOLOGIST: 'dermatologist',
  // Maternity hospital roles
  MATERNITY_FRONT_OFFICER: 'maternity_front_officer',
  MATERNITY_ANC_STAFF: 'maternity_anc_staff',
  MATERNITY_ANW_STAFF: 'maternity_anw_staff',
  MATERNITY_PNW_STAFF: 'maternity_pnw_staff',
  MATERNITY_ICU_STAFF: 'maternity_icu_staff',
  MATERNITY_NICU_STAFF: 'maternity_nicu_staff',
  // Hospital outpatient receiving departments (clinic referrals)
  PEDIATRIC_OUTPATIENT_NURSE: 'pediatric_outpatient_nurse',
  ENT_NURSE: 'ent_nurse',
  HOSPITAL_EMERGENCY_NURSE: 'hospital_emergency_nurse',
  EYE_NURSE: 'eye_nurse',
  ORTHOPEDIC_OUTPATIENT_NURSE: 'orthopedic_outpatient_nurse',
  ADULT_OUTPATIENT_NURSE: 'adult_outpatient_nurse',
  PHYSIOTHERAPY_NURSE: 'physiotherapy_nurse',
  BIG_ROOM_SPECIALIST_NURSE: 'big_room_specialist_nurse',
  UROLOGY_NURSE: 'urology_nurse',
  MENTAL_HEALTH_NURSE: 'mental_health_nurse',
};

const PERMISSIONS = {
  patient: ['create', 'read', 'update', 'delete'],
  vitals: ['create', 'read', 'update', 'delete'],
  consultation: ['create', 'read', 'update', 'delete'],
  prescription: ['create', 'read', 'update'],
  lab_request: ['create', 'read', 'update'],
  lab_result: ['create', 'read', 'update', 'delete'],
  sonar_request: ['create', 'read', 'update'],
  sonar_result: ['create', 'read', 'update', 'delete'],
  ward: ['create', 'read', 'update', 'delete'],
  bed: ['create', 'read', 'update', 'delete'],
  admission: ['create', 'read', 'update'],
  transport: ['create', 'read', 'update'],
  diet: ['create', 'read', 'update', 'delete'],
  meal_plan: ['create', 'read', 'update'],
  billing: ['create', 'read', 'update'],
  revenue: ['create', 'read', 'update'],
  inventory: ['create', 'read', 'update', 'delete'],
  mortuary: ['create', 'read', 'update'],
  social_worker_case: ['create', 'read', 'update'],
  referral: ['create', 'read', 'update'],
  queue: ['create', 'read', 'update', 'push'],
  audit_log: ['read'],
  user: ['create', 'read', 'update', 'delete'],
  facility: ['create', 'read', 'update'],
  analytics: ['read'],
  user_report: ['create', 'read', 'update'],
};

// Maps each role to its allowed permissions: { resource: [actions] }
const ROLE_PERMISSIONS = {
  [ROLES.SYSTEM_ADMIN]: {
    patient: ['create', 'read', 'update', 'delete'],
    vitals: ['read'],
    consultation: ['read'],
    prescription: ['read'],
    lab_request: ['read'],
    lab_result: ['read'],
    sonar_request: ['read'],
    sonar_result: ['read'],
    ward: ['create', 'read', 'update', 'delete'],
    bed: ['create', 'read', 'update', 'delete'],
    admission: ['read'],
    transport: ['read'],
    diet: ['read'],
    meal_plan: ['read'],
    billing: ['create', 'read', 'update'],
    revenue: ['create', 'read', 'update'],
    inventory: ['create', 'read', 'update', 'delete'],
    mortuary: ['read'],
    social_worker_case: ['read'],
    referral: ['read'],
    queue: ['create', 'read', 'update', 'push'],
    audit_log: ['read'],
    user: ['create', 'read', 'update', 'delete'],
    facility: ['create', 'read', 'update'],
    analytics: ['read'],
  },
  [ROLES.FRONT_OFFICE]: {
    patient: ['create', 'read', 'update'],
    queue: ['create', 'read', 'push'],
    referral: ['read'],
  },
  [ROLES.FRONT_OFFICE_SUPERVISOR]: {
    patient: ['read'],
    queue: ['read'],
    analytics: ['read'],
    transport: ['create', 'read'],
  },
  [ROLES.NURSE]: {
    patient: ['read'],
    vitals: ['create', 'read', 'update', 'delete'],
    consultation: ['read'],
    lab_request: ['read', 'update'],
    queue: ['read', 'push', 'update'],
  },
  [ROLES.NURSE_SUPERVISOR]: {
    patient: ['read'],
    vitals: ['read'],
    queue: ['read'],
    analytics: ['read'],
    billing: ['read', 'update'],
  },
  [ROLES.DOCTOR]: {
    patient: ['read'],
    vitals: ['read'],
    consultation: ['create', 'read', 'update', 'delete'],
    prescription: ['create', 'read'],
    lab_request: ['create', 'read'],
    lab_result: ['read'],
    sonar_request: ['create', 'read'],
    sonar_result: ['read'],
    ward: ['read'],
    bed: ['read'],
    admission: ['create', 'read'],
    transport: ['create', 'read'],
    diet: ['create', 'read', 'update', 'delete'],
    inventory: ['read'],
    referral: ['create', 'read'],
    queue: ['read', 'push', 'update'],
  },
  [ROLES.DOCTOR_SUPERVISOR]: {
    patient: ['read'],
    vitals: ['read'],
    consultation: ['read'],
    prescription: ['read'],
    lab_request: ['read'],
    lab_result: ['read'],
    admission: ['read'],
    analytics: ['read'],
    inventory: ['read'],
    queue: ['read'],
    billing: ['read', 'update'],
  },
  [ROLES.PHARMACIST]: {
    patient: ['read'],
    consultation: ['read'],
    prescription: ['read', 'update'],
    inventory: ['read'],
    referral: ['create', 'read'],
    queue: ['read'],
  },
  [ROLES.PHARMACY_SUPERVISOR]: {
    patient: ['read'],
    consultation: ['read'],
    prescription: ['read'],
    inventory: ['create', 'read', 'update'],
    billing: ['read'],
  },
  [ROLES.LAB_TECHNICIAN]: {
    patient: ['read'],
    consultation: ['read'],
    lab_request: ['read', 'update'],
    lab_result: ['create', 'read', 'update', 'delete'],
    queue: ['read'],
  },
  [ROLES.LABORATORY_SUPERVISOR]: {
    patient: ['read'],
    lab_request: ['read'],
    lab_result: ['read'],
    analytics: ['read'],
    queue: ['read'],
  },
  [ROLES.RADIOLOGIST]: {
    patient: ['read'],
    sonar_request: ['read', 'update'],
    sonar_result: ['create', 'read', 'update', 'delete'],
    queue: ['read'],
  },
  [ROLES.RADIOLOGIST_SUPERVISOR]: {
    patient: ['read'],
    sonar_request: ['read'],
    sonar_result: ['read'],
    analytics: ['read'],
    queue: ['read'],
    billing: ['read', 'update'],
  },
  [ROLES.WARD_SUPERVISOR]: {
    patient: ['read'],
    vitals: ['read'],
    consultation: ['read'],
    ward: ['create', 'read', 'update', 'delete'],
    bed: ['create', 'read', 'update', 'delete'],
    admission: ['read', 'update'],
    transport: ['read'],
    diet: ['read'],
    billing: ['read', 'update'],
  },
  [ROLES.WARD_STAFF]: {
    patient: ['read'],
    vitals: ['read'],
    consultation: ['read'],
    ward: ['read'],
    bed: ['read', 'update'],
    admission: ['read', 'update'],
    transport: ['read'],
    diet: ['read'],
  },
  [ROLES.PORTER]: {
    patient: ['read'],
    transport: ['read', 'update'],
    queue: ['read'],
  },
  [ROLES.INTERNAL_PORTER]: {
    patient: ['read'],
    transport: ['read', 'update', 'create'],
    queue: ['read'],
  },
  [ROLES.EXTERNAL_PORTER]: {
    patient: ['read'],
    transport: ['read', 'update', 'create'],
    queue: ['read'],
  },
  [ROLES.KITCHEN_STAFF]: {
    diet: ['read'],
    meal_plan: ['read', 'update'],
    inventory: ['read', 'update'],
  },
  [ROLES.KITCHEN_MANAGER]: {
    diet: ['read'],
    meal_plan: ['create', 'read', 'update'],
    inventory: ['create', 'read', 'update', 'delete'],
  },
  [ROLES.BILLING_CLERK]: {
    patient: ['read'],
    billing: ['create', 'read', 'update'],
    revenue: ['read', 'create', 'update'],
    queue: ['read'],
  },
  [ROLES.REVENUE_OFFICER]: {
    billing: ['read'],
    revenue: ['create', 'read', 'update'],
    analytics: ['read'],
  },
  [ROLES.MORTUARY_STAFF]: {
    patient: ['read'],
    mortuary: ['create', 'read', 'update'],
  },
  [ROLES.SOCIAL_WORKER]: {
    patient: ['read'],
    vitals: ['create', 'read', 'update'],
    queue: ['read', 'update'],
    social_worker_case: ['create', 'read', 'update'],
  },
  [ROLES.DATA_ANALYST]: {
    analytics: ['read'],
    patient: ['read'],
  },
  [ROLES.EXECUTIVE]: {
    analytics: ['read'],
    patient: ['read'],
    user: ['read'],
    revenue: ['read'],
    billing: ['read'],
    queue: ['read'],
    admission: ['read'],
    mortuary: ['read'],
  },
};

// Clinic nurse roles share the same clinical permissions as ward nurses.
const CLINIC_NURSE_PERMISSIONS = ROLE_PERMISSIONS[ROLES.NURSE];
const CLINIC_DOCTOR_PERMISSIONS = ROLE_PERMISSIONS[ROLES.DOCTOR];
const CLINIC_FRONT_OFFICE_PERMISSIONS = ROLE_PERMISSIONS[ROLES.FRONT_OFFICE];

[
  ROLES.PARAMETER_NURSE,
  ROLES.SCREENING_NURSE,
  ROLES.ANC_NURSE,
  ROLES.PEDIATRIC_CORNER,
  ROLES.PREP_SUITE,
  ROLES.PAP_SMEAR_SUITE,
  ROLES.HIV_TESTER,
  ROLES.EMERGENCY_UNIT_NURSE,
  ROLES.ART_NURSE,
].forEach((role) => {
  ROLE_PERMISSIONS[role] = CLINIC_NURSE_PERMISSIONS;
});

// Emergency unit nurse prescribes immediate meds — needs catalog + stock lookup
ROLE_PERMISSIONS[ROLES.EMERGENCY_UNIT_NURSE] = {
  ...CLINIC_NURSE_PERMISSIONS,
  inventory: ['read'],
  prescription: ['create', 'read'],
};

ROLE_PERMISSIONS[ROLES.EMERGENCY_UNIT_DOCTOR] = CLINIC_DOCTOR_PERMISSIONS;
ROLE_PERMISSIONS[ROLES.MASTER_DOCTOR] = CLINIC_DOCTOR_PERMISSIONS;
ROLE_PERMISSIONS[ROLES.DERMATOLOGIST] = CLINIC_DOCTOR_PERMISSIONS;
ROLE_PERMISSIONS[ROLES.FAMILY_PLANNER] = {
  patient: ['read'],
  vitals: ['create', 'read', 'update'],
  consultation: ['create', 'read', 'update'],
  prescription: ['create', 'read'],
  inventory: ['read'],
  queue: ['read', 'update'],
};
ROLE_PERMISSIONS[ROLES.BOOKING_ROOM] = {
  ...CLINIC_FRONT_OFFICE_PERMISSIONS,
  patient: ['create', 'read', 'update'],
  consultation: ['read'],
  referral: ['create', 'read', 'update'],
  mortuary: ['create', 'read'],
  queue: ['read', 'update'],
  transport: ['create', 'read', 'update'],
};

// Hospital outpatient receiving nurses — inbound clinic referral queue
const HOSPITAL_OUTPATIENT_NURSE_PERMISSIONS = {
  patient: ['read'],
  vitals: ['read', 'create'],
  consultation: ['read', 'create'],
  referral: ['read', 'update'],
  queue: ['read', 'update'],
  transport: ['read'],
  bed: ['read'],
  admission: ['create'],
};

[
  ROLES.PEDIATRIC_OUTPATIENT_NURSE,
  ROLES.ENT_NURSE,
  ROLES.HOSPITAL_EMERGENCY_NURSE,
  ROLES.EYE_NURSE,
  ROLES.ORTHOPEDIC_OUTPATIENT_NURSE,
  ROLES.PHYSIOTHERAPY_NURSE,
  ROLES.BIG_ROOM_SPECIALIST_NURSE,
  ROLES.UROLOGY_NURSE,
  ROLES.MENTAL_HEALTH_NURSE,
].forEach((role) => {
  ROLE_PERMISSIONS[role] = HOSPITAL_OUTPATIENT_NURSE_PERMISSIONS;
});

// Maternity hospital staff — nurse-like clinical queue permissions + ward tracking
const MATERNITY_NURSE_PERMISSIONS = {
  patient: ['read'],
  vitals: ['create', 'read', 'update'],
  ward: ['read'],
  bed: ['read'],
  admission: ['read', 'update'],
  queue: ['read', 'push', 'update'],
};

ROLE_PERMISSIONS[ROLES.MATERNITY_FRONT_OFFICER] = {
  patient: ['create', 'read', 'update'],
  queue: ['create', 'read', 'push', 'update'],
};

[
  ROLES.MATERNITY_ANC_STAFF,
  ROLES.MATERNITY_ANW_STAFF,
  ROLES.MATERNITY_PNW_STAFF,
  ROLES.MATERNITY_ICU_STAFF,
  ROLES.MATERNITY_NICU_STAFF,
].forEach((role) => {
  ROLE_PERMISSIONS[role] = MATERNITY_NURSE_PERMISSIONS;
});

const { WARD_STAFF_ROLE_SLUGS } = require('./wardStaffConfig');
const WARD_STAFF_PERMISSIONS = ROLE_PERMISSIONS[ROLES.WARD_STAFF];
WARD_STAFF_ROLE_SLUGS.forEach((role) => {
  ROLE_PERMISSIONS[role] = WARD_STAFF_PERMISSIONS;
});

ROLE_PERMISSIONS[ROLES.ICU_WARD_NURSE] = {
  ...WARD_STAFF_PERMISSIONS,
  transport: ['read', 'create'],
  mortuary: ['create'],
};

ROLE_PERMISSIONS[ROLES.SURGICAL_COMPLEX_NURSE] = {
  ...WARD_STAFF_PERMISSIONS,
  transport: ['read', 'create'],
  mortuary: ['create'],
};

ROLE_PERMISSIONS[ROLES.SPECIALIZED_INPATIENT_NURSE] = {
  ...WARD_STAFF_PERMISSIONS,
  transport: ['read', 'create'],
  mortuary: ['create'],
};

ROLE_PERMISSIONS[ROLES.ADULT_OUTPATIENT_NURSE] = {
  ...WARD_STAFF_PERMISSIONS,
  transport: ['read', 'create'],
  mortuary: ['create'],
};

// Every authenticated user can submit and track reports; system admin can manage all.
Object.keys(ROLE_PERMISSIONS).forEach((role) => {
  if (role === ROLES.SYSTEM_ADMIN) {
    ROLE_PERMISSIONS[role].user_report = ['create', 'read', 'update'];
  } else {
    ROLE_PERMISSIONS[role].user_report = ['create', 'read'];
  }
});

module.exports = { ROLES, PERMISSIONS, ROLE_PERMISSIONS };
