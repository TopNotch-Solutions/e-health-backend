const PARAMETER_NURSE_DEPARTMENT = 'parameter_nurse';

const VISIT_CLASSIFICATIONS = {
  follow_up: {
    label: 'Follow-Up',
    allowedDestinations: ['master_doctor', 'pharmacy'],
    requiredVitals: ['blood_pressure_systolic', 'blood_pressure_diastolic', 'pulse_rate'],
  },
  sick: {
    label: 'Sick',
    allowedDestinations: ['screening_nurse', 'emergency_unit'],
    requiredVitals: [
      'temperature',
      'blood_pressure_systolic',
      'blood_pressure_diastolic',
      'oxygen_saturation',
    ],
  },
};

function isValidClassification(value) {
  return Boolean(VISIT_CLASSIFICATIONS[value]);
}

function isValidDestination(classification, destination) {
  const cfg = VISIT_CLASSIFICATIONS[classification];
  return cfg ? cfg.allowedDestinations.includes(destination) : false;
}

function validateVitalsForClassification(classification, attrs) {
  const cfg = VISIT_CLASSIFICATIONS[classification];
  if (!cfg) return 'Invalid visit classification';

  for (const field of cfg.requiredVitals) {
    const val = attrs[field];
    if (val === null || val === undefined || val === '') {
      return `Missing required vital: ${field.replace(/_/g, ' ')}`;
    }
  }
  return null;
}

module.exports = {
  PARAMETER_NURSE_DEPARTMENT,
  VISIT_CLASSIFICATIONS,
  isValidClassification,
  isValidDestination,
  validateVitalsForClassification,
};
