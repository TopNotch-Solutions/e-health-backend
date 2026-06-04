/**
 * Clinic Social Worker Suite — counseling queue and booking room escalation.
 */

const SOCIAL_WORKER_DEPARTMENT = 'social_worker';
const BOOKING_ROOM_DEPARTMENT = 'booking_room';
const BOOKING_PATHWAY_SOCIAL_WORKER = 'pathway:social_worker';

const REQUIRED_ASSESSMENT_FIELDS = [
  'social_assessment_details',
  'case_history',
  'clinical_notes',
];

function isValidSeverity(value) {
  return value === 'routine' || value === 'severe';
}

function validateAssessmentFields(body) {
  for (const field of REQUIRED_ASSESSMENT_FIELDS) {
    if (!(body[field] || '').trim()) {
      return `Missing required field: ${field.replace(/_/g, ' ')}`;
    }
  }
  if (!body.severity || !isValidSeverity(body.severity)) {
    return 'Severity classification is required (routine or severe)';
  }
  return null;
}

function isSessionFinalized(assessment) {
  if (!assessment) return false;
  return Boolean(
    assessment.session_completed_at
    || assessment.escalated_to_booking_at
  );
}

module.exports = {
  SOCIAL_WORKER_DEPARTMENT,
  BOOKING_ROOM_DEPARTMENT,
  BOOKING_PATHWAY_SOCIAL_WORKER,
  REQUIRED_ASSESSMENT_FIELDS,
  isValidSeverity,
  validateAssessmentFields,
  isSessionFinalized,
};
