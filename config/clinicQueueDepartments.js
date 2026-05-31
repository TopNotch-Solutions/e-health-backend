/**
 * Clinic front office routing destinations and queue department slugs.
 * Used when sending patients from reception to clinic stations.
 */

const EMERGENCY_UNIT_DEPARTMENT = 'emergency_unit';

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
  family_planning: 'Family Planning',
  booking_room: 'Booking Room',
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
  'booking_room',
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
