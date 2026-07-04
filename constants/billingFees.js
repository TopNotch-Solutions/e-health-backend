const {
  HOSPITAL_DEPARTMENT_VISIT_FEES,
  departmentVisitFeeKey,
  parseDepartmentVisitFeeKey,
  departmentVisitLabel,
} = require('../config/billingDepartmentFees');

const FEE_KEYS = {
  ADMISSION: 'admission_fee',
  /** Flat fee for private patients at clinics (covers all activities). */
  CLINIC_VISIT: 'clinic_visit_fee',
  DOCTOR_CONSULTATION: 'doctor_consultation',
  WARD_DAILY: 'ward_daily',
  SONAR_30MIN: 'sonar_per_30min',
  MATERNITY_FRONT_OFFICE: 'maternity_front_office_visit',
  MATERNITY_WARD_DAILY: 'maternity_ward_daily',
};

const FEE_LABELS = {
  [FEE_KEYS.ADMISSION]: 'Admission fee (NAD)',
  [FEE_KEYS.CLINIC_VISIT]: 'Clinic visit fee — all activities (NAD)',
  [FEE_KEYS.DOCTOR_CONSULTATION]: 'Doctor consultation fee (NAD)',
  [FEE_KEYS.WARD_DAILY]: 'Ward stay per day (NAD)',
  [FEE_KEYS.SONAR_30MIN]: 'Ultrasound per 30 minutes (NAD)',
  [FEE_KEYS.MATERNITY_FRONT_OFFICE]: 'Maternity front office visit (NAD)',
  [FEE_KEYS.MATERNITY_WARD_DAILY]: 'Maternity ward stay per day — ANW/PNW/ICU (NAD)',
};

for (const row of HOSPITAL_DEPARTMENT_VISIT_FEES) {
  FEE_LABELS[departmentVisitFeeKey(row.slug)] = `${row.label} visit (NAD)`;
}

/** Which supervisor role may update each fee key. */
const FEE_SUPERVISOR_ROLE = {
  [FEE_KEYS.ADMISSION]: 'nurse_supervisor',
  [FEE_KEYS.CLINIC_VISIT]: 'nurse_supervisor',
  [FEE_KEYS.DOCTOR_CONSULTATION]: 'doctor_supervisor',
  [FEE_KEYS.WARD_DAILY]: 'ward_supervisor',
  [FEE_KEYS.SONAR_30MIN]: 'radiologist_supervisor',
  [FEE_KEYS.MATERNITY_FRONT_OFFICE]: 'nurse_supervisor',
  [FEE_KEYS.MATERNITY_WARD_DAILY]: 'ward_supervisor',
};

const DEFAULT_FEE_AMOUNTS = {
  [FEE_KEYS.ADMISSION]: 35,
  [FEE_KEYS.CLINIC_VISIT]: 15,
  [FEE_KEYS.DOCTOR_CONSULTATION]: 30,
  [FEE_KEYS.WARD_DAILY]: 250,
  [FEE_KEYS.SONAR_30MIN]: 75,
  [FEE_KEYS.MATERNITY_FRONT_OFFICE]: 50,
  [FEE_KEYS.MATERNITY_WARD_DAILY]: 500,
};

for (const row of HOSPITAL_DEPARTMENT_VISIT_FEES) {
  DEFAULT_FEE_AMOUNTS[departmentVisitFeeKey(row.slug)] = 0;
}

/** National default prices for all clinics. */
const CLINIC_NATIONAL_FEE_KEYS = [FEE_KEYS.CLINIC_VISIT];

/** Per-clinic optional overrides (same keys as national). */
const CLINIC_FACILITY_OVERRIDE_KEYS = [FEE_KEYS.CLINIC_VISIT];

/** National default prices for all hospitals. */
const HOSPITAL_NATIONAL_FEE_KEYS = [
  FEE_KEYS.ADMISSION,
  ...HOSPITAL_DEPARTMENT_VISIT_FEES.map((row) => departmentVisitFeeKey(row.slug)),
];

/** Per-hospital optional overrides. */
const HOSPITAL_FACILITY_OVERRIDE_KEYS = [
  FEE_KEYS.ADMISSION,
  ...HOSPITAL_DEPARTMENT_VISIT_FEES.map((row) => departmentVisitFeeKey(row.slug)),
  FEE_KEYS.DOCTOR_CONSULTATION,
  FEE_KEYS.WARD_DAILY,
  FEE_KEYS.SONAR_30MIN,
  FEE_KEYS.MATERNITY_FRONT_OFFICE,
  FEE_KEYS.MATERNITY_WARD_DAILY,
];

function feeLabel(feeKey) {
  if (FEE_LABELS[feeKey]) return FEE_LABELS[feeKey];
  const slug = parseDepartmentVisitFeeKey(feeKey);
  if (slug) return `${departmentVisitLabel(slug)} visit (NAD)`;
  return feeKey;
}

function feeKeysForNationalScope(scope) {
  if (scope === 'clinic') return CLINIC_NATIONAL_FEE_KEYS;
  if (scope === 'hospital') return HOSPITAL_NATIONAL_FEE_KEYS;
  return [];
}

function feeKeysForFacilityOverrides(facilityType) {
  if (facilityType === 'clinic') return CLINIC_FACILITY_OVERRIDE_KEYS;
  if (facilityType === 'hospital' || facilityType === 'health_center') return HOSPITAL_FACILITY_OVERRIDE_KEYS;
  return [];
}

/** @deprecated */
function feeKeysForFacilityType(facilityType) {
  return feeKeysForFacilityOverrides(facilityType);
}

module.exports = {
  FEE_KEYS,
  FEE_LABELS,
  FEE_SUPERVISOR_ROLE,
  DEFAULT_FEE_AMOUNTS,
  CLINIC_NATIONAL_FEE_KEYS,
  HOSPITAL_NATIONAL_FEE_KEYS,
  CLINIC_FACILITY_OVERRIDE_KEYS,
  HOSPITAL_FACILITY_OVERRIDE_KEYS,
  CLINIC_FEE_KEYS: CLINIC_FACILITY_OVERRIDE_KEYS,
  HOSPITAL_FEE_KEYS: HOSPITAL_FACILITY_OVERRIDE_KEYS,
  feeLabel,
  feeKeysForNationalScope,
  feeKeysForFacilityOverrides,
  feeKeysForFacilityType,
};
