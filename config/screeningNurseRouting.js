const SCREENING_NURSE_DEPARTMENT = 'screening_nurse';

const SCREENING_DESTINATIONS = [
  { value: 'master_doctor', label: 'Master Doctor' },
  { value: 'dermatologist', label: 'Dermatologist' },
  { value: 'hiv_tester', label: 'HIV Testing Room' },
  { value: 'emergency_unit', label: 'Emergency Unit' },
];

const DESTINATION_VALUE_SET = new Set(SCREENING_DESTINATIONS.map((d) => d.value));

const REQUIRED_FIELDS = ['symptoms', 'reason', 'diagnosis'];

function isValidDestination(value) {
  return DESTINATION_VALUE_SET.has(value);
}

function routingLabel(value) {
  return SCREENING_DESTINATIONS.find((d) => d.value === value)?.label || value;
}

function validateAssessmentFields(body) {
  for (const field of REQUIRED_FIELDS) {
    const val = (body[field] || '').trim();
    if (!val) {
      return `Missing required field: ${field.replace(/_/g, ' ')}`;
    }
  }
  return null;
}

module.exports = {
  SCREENING_NURSE_DEPARTMENT,
  SCREENING_DESTINATIONS,
  REQUIRED_FIELDS,
  isValidDestination,
  routingLabel,
  validateAssessmentFields,
};
