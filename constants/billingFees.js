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
  SONAR_BILLING_INTERVAL_MINUTES: 'sonar_billing_interval_minutes',
  MATERNITY_FRONT_OFFICE: 'maternity_front_office_visit',
  MATERNITY_ANW_DAILY: 'maternity_anw_daily',
  MATERNITY_PNW_DAILY: 'maternity_pnw_daily',
  MATERNITY_ICU_DAILY: 'maternity_icu_daily',
};

const FEE_LABELS = {
  [FEE_KEYS.ADMISSION]: 'Admission fee (NAD)',
  [FEE_KEYS.CLINIC_VISIT]: 'Clinic visit fee — all activities (NAD)',
  [FEE_KEYS.DOCTOR_CONSULTATION]: 'Doctor consultation fee (NAD)',
  [FEE_KEYS.WARD_DAILY]: 'Ward stay per day (NAD)',
  [FEE_KEYS.SONAR_30MIN]: 'Ultrasound rate per billing interval (NAD)',
  [FEE_KEYS.SONAR_BILLING_INTERVAL_MINUTES]: 'Ultrasound billing interval (minutes)',
  [FEE_KEYS.MATERNITY_FRONT_OFFICE]: 'Maternity front office visit (NAD)',
  [FEE_KEYS.MATERNITY_ANW_DAILY]: 'Maternity ANW ward stay per day (NAD)',
  [FEE_KEYS.MATERNITY_PNW_DAILY]: 'Maternity PNW ward stay per day (NAD)',
  [FEE_KEYS.MATERNITY_ICU_DAILY]: 'Maternity ICU ward stay per day (NAD)',
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
  [FEE_KEYS.SONAR_BILLING_INTERVAL_MINUTES]: 'radiologist_supervisor',
  [FEE_KEYS.MATERNITY_FRONT_OFFICE]: 'nurse_supervisor',
  [FEE_KEYS.MATERNITY_ANW_DAILY]: 'ward_supervisor',
  [FEE_KEYS.MATERNITY_PNW_DAILY]: 'ward_supervisor',
  [FEE_KEYS.MATERNITY_ICU_DAILY]: 'ward_supervisor',
};

const DEFAULT_FEE_AMOUNTS = {
  [FEE_KEYS.ADMISSION]: 35,
  [FEE_KEYS.CLINIC_VISIT]: 15,
  [FEE_KEYS.DOCTOR_CONSULTATION]: 30,
  [FEE_KEYS.WARD_DAILY]: 250,
  [FEE_KEYS.SONAR_30MIN]: 75,
  [FEE_KEYS.SONAR_BILLING_INTERVAL_MINUTES]: 30,
  [FEE_KEYS.MATERNITY_FRONT_OFFICE]: 50,
  [FEE_KEYS.MATERNITY_ANW_DAILY]: 500,
  [FEE_KEYS.MATERNITY_PNW_DAILY]: 500,
  [FEE_KEYS.MATERNITY_ICU_DAILY]: 500,
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
  FEE_KEYS.MATERNITY_ANW_DAILY,
  FEE_KEYS.MATERNITY_PNW_DAILY,
  FEE_KEYS.MATERNITY_ICU_DAILY,
  FEE_KEYS.SONAR_30MIN,
  FEE_KEYS.SONAR_BILLING_INTERVAL_MINUTES,
];

/** Per-hospital optional overrides. */
const HOSPITAL_FACILITY_OVERRIDE_KEYS = [
  FEE_KEYS.ADMISSION,
  ...HOSPITAL_DEPARTMENT_VISIT_FEES.map((row) => departmentVisitFeeKey(row.slug)),
  FEE_KEYS.DOCTOR_CONSULTATION,
  FEE_KEYS.WARD_DAILY,
  FEE_KEYS.SONAR_30MIN,
  FEE_KEYS.SONAR_BILLING_INTERVAL_MINUTES,
  FEE_KEYS.MATERNITY_FRONT_OFFICE,
  FEE_KEYS.MATERNITY_ANW_DAILY,
  FEE_KEYS.MATERNITY_PNW_DAILY,
  FEE_KEYS.MATERNITY_ICU_DAILY,
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

const MATERNITY_WARD_FEE_KEYS = {
  anw: FEE_KEYS.MATERNITY_ANW_DAILY,
  pnw: FEE_KEYS.MATERNITY_PNW_DAILY,
  icu: FEE_KEYS.MATERNITY_ICU_DAILY,
};

function maternityWardFeeKey(ward) {
  return MATERNITY_WARD_FEE_KEYS[String(ward || '').toLowerCase()] || FEE_KEYS.MATERNITY_ANW_DAILY;
}

/** currency (NAD) or minutes — stored in facility_billing_fees.amount */
const FEE_VALUE_KIND = {
  [FEE_KEYS.SONAR_BILLING_INTERVAL_MINUTES]: 'minutes',
};

function feeValueKind(feeKey) {
  return FEE_VALUE_KIND[feeKey] || 'currency';
}

function normalizeFeeValue(feeKey, amount) {
  if (feeValueKind(feeKey) === 'minutes') {
    const n = Math.round(parseFloat(amount));
    if (!Number.isFinite(n) || n < 1 || n > 240) {
      const err = new Error('Billing interval must be between 1 and 240 minutes');
      err.statusCode = 400;
      throw err;
    }
    return n;
  }
  const n = parseFloat(amount);
  if (n == null || Number.isNaN(n) || n < 0) {
    const err = new Error('Valid amount is required');
    err.statusCode = 400;
    throw err;
  }
  return n;
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
  MATERNITY_WARD_FEE_KEYS,
  feeLabel,
  feeValueKind,
  normalizeFeeValue,
  maternityWardFeeKey,
  feeKeysForNationalScope,
  feeKeysForFacilityOverrides,
  feeKeysForFacilityType,
};
