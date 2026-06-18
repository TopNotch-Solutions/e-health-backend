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

module.exports = {
  FEE_KEYS,
  FEE_LABELS,
  FEE_SUPERVISOR_ROLE,
  DEFAULT_FEE_AMOUNTS,
};
