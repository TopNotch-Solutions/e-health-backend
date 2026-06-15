const EMERGENCY_UNIT_NURSE_DEPARTMENT = 'emergency_unit';
const EMERGENCY_UNIT_DOCTOR_DEPARTMENT = 'emergency_unit_doctor';

const NURSE_ROUTING_DESTINATIONS = [
  { value: 'pharmacy', label: 'Pharmacist', buttonClass: 'pharmacy' },
  { value: 'emergency_unit_doctor', label: 'Emergency Unit Doctor', buttonClass: 'primary' },
];

const DESTINATION_SET = new Set(NURSE_ROUTING_DESTINATIONS.map((d) => d.value));

const EMERGENCY_UNIT_VISIT_CLASSIFICATION = 'sick';

const {
  validateVitalsForClassification,
} = require('./parameterNurseRouting');
const { validateAssessmentFields } = require('./screeningNurseRouting');

function isValidNurseDestination(value) {
  return DESTINATION_SET.has(value);
}

function routingLabel(value) {
  return NURSE_ROUTING_DESTINATIONS.find((d) => d.value === value)?.label || value;
}

function validateInterventions(interventions) {
  if (!interventions || !String(interventions).trim()) {
    return 'Clinical interventions are required.';
  }
  return null;
}

function validateEmergencyUnitNurseIntake(body) {
  const vitalError = validateVitalsForClassification(
    EMERGENCY_UNIT_VISIT_CLASSIFICATION,
    { ...body, visit_classification: EMERGENCY_UNIT_VISIT_CLASSIFICATION }
  );
  if (vitalError) return vitalError;

  return validateAssessmentFields(body);
}

module.exports = {
  EMERGENCY_UNIT_NURSE_DEPARTMENT,
  EMERGENCY_UNIT_DOCTOR_DEPARTMENT,
  EMERGENCY_UNIT_VISIT_CLASSIFICATION,
  NURSE_ROUTING_DESTINATIONS,
  isValidNurseDestination,
  routingLabel,
  validateInterventions,
  validateEmergencyUnitNurseIntake,
};
