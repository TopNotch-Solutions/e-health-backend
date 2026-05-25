const FEE_KEYS = {
  ADMISSION: 'admission_fee',
  DOCTOR_CONSULTATION: 'doctor_consultation',
  WARD_DAILY: 'ward_daily',
  SONAR_30MIN: 'sonar_per_30min',
};

const FEE_LABELS = {
  [FEE_KEYS.ADMISSION]: 'Admission fee (NAD)',
  [FEE_KEYS.DOCTOR_CONSULTATION]: 'Doctor consultation fee (NAD)',
  [FEE_KEYS.WARD_DAILY]: 'Ward stay per day (NAD)',
  [FEE_KEYS.SONAR_30MIN]: 'Ultrasound per 30 minutes (NAD)',
};

/** Which supervisor role may update each fee key. */
const FEE_SUPERVISOR_ROLE = {
  [FEE_KEYS.ADMISSION]: 'nurse_supervisor',
  [FEE_KEYS.DOCTOR_CONSULTATION]: 'doctor_supervisor',
  [FEE_KEYS.WARD_DAILY]: 'ward_supervisor',
  [FEE_KEYS.SONAR_30MIN]: 'radiologist_supervisor',
};

const DEFAULT_FEE_AMOUNTS = {
  [FEE_KEYS.ADMISSION]: 35,
  [FEE_KEYS.DOCTOR_CONSULTATION]: 30,
  [FEE_KEYS.WARD_DAILY]: 250,
  [FEE_KEYS.SONAR_30MIN]: 75,
};

module.exports = {
  FEE_KEYS,
  FEE_LABELS,
  FEE_SUPERVISOR_ROLE,
  DEFAULT_FEE_AMOUNTS,
};
