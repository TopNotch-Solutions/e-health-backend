/**
 * Clinic front office routing destinations and queue department slugs.
 * Used when sending patients from reception to clinic stations.
 */

const EMERGENCY_UNIT_DEPARTMENT = 'emergency_unit';

const {
  MATERNITY_DEPARTMENTS,
  DEPARTMENT_LABELS: MATERNITY_DEPT_LABELS,
} = require('./maternityConfig');

const FRONT_OFFICE_ROUTING = [
  { value: 'parameter_nurse', label: 'Parameter Nurse' },
  { value: 'anc_nurse', label: 'ANC Nurse' },
  { value: 'pediatric', label: 'Pediatric' },
  { value: 'prep', label: 'PrEP' },
  { value: 'pap_smear', label: 'Pap Smear' },
  { value: 'social_worker', label: 'Social Worker' },
  { value: 'pharmacy', label: 'Pharmacist' },
  { value: 'family_planning', label: 'Family Planning' },
];

const ROUTING_VALUE_SET = new Set(FRONT_OFFICE_ROUTING.map((r) => r.value));

const DEPARTMENT_LABELS = {
  nurse: 'Nurse',
  doctor: 'Doctor',
  master_doctor: 'Master Doctor',
  pharmacy: 'Pharmacy',
  lab: 'Lab',
  sonar: 'Sonar',
  billing: 'Billing',
  transport: 'Transport',
  [EMERGENCY_UNIT_DEPARTMENT]: 'Emergency Unit',
  parameter_nurse: 'Parameter Nurse',
  anc_nurse: 'ANC Nurse',
  pediatric: 'Pediatric',
  prep: 'PrEP',
  pap_smear: 'Pap Smear',
  social_worker: 'Social Worker',
  screening_nurse: 'Screening Nurse',
  hiv_tester: 'HIV Testing Room',
  art_nurse: 'ART — Antiretroviral Therapy',
  emergency_unit_doctor: 'Emergency Unit Doctor',
  family_planning: 'Family Planning',
  booking_room: 'Booking Room',
  dermatologist: 'Dermatologist',
  pediatric_outpatient: 'Pediatric Outpatient',
  ent_outpatient: 'Ear, Nose and Throat',
  hospital_emergency_unit: 'Emergency Unit',
  eye_outpatient: 'Eye',
  orthopedic_outpatient: 'Orthopedic Outpatient',
  adult_outpatient: 'Adult Outpatient',
  physiotherapy_rehabilitation: 'Physiotherapy and Rehabilitation',
  big_room_specialist: 'Big Room Specialist',
  urology_outpatient: 'Urology',
  mental_health_outpatient: 'Mental Health',
  ...MATERNITY_DEPT_LABELS,
};

const ALL_QUEUE_DEPARTMENTS = [
  'nurse',
  'doctor',
  'master_doctor',
  'pharmacy',
  'lab',
  'sonar',
  'billing',
  'transport',
  EMERGENCY_UNIT_DEPARTMENT,
  'screening_nurse',
  'hiv_tester',
  'art_nurse',
  'emergency_unit_doctor',
  'booking_room',
  'dermatologist',
  ...Object.values(MATERNITY_DEPARTMENTS),
  ...FRONT_OFFICE_ROUTING.map((r) => r.value),
];

function isValidRoutingDestination(value) {
  return ROUTING_VALUE_SET.has(value);
}

function routingLabel(value) {
  return DEPARTMENT_LABELS[value] || value;
}

module.exports = {
  EMERGENCY_UNIT_DEPARTMENT,
  FRONT_OFFICE_ROUTING,
  DEPARTMENT_LABELS,
  ALL_QUEUE_DEPARTMENTS,
  isValidRoutingDestination,
  routingLabel,
};
