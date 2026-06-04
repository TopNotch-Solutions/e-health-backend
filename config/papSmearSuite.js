/**
 * Clinic Pap Smear Suite — screening queue and high-risk escalation.
 */

const PAP_SMEAR_DEPARTMENT = 'pap_smear';
const MASTER_DOCTOR_DEPARTMENT = 'master_doctor';

const SEVERITY_LEVELS = [
  { value: 'routine', label: 'Not severe — finalize session' },
  { value: 'severe', label: 'Severe — escalate to Master Doctor' },
];

const REQUIRED_SCREENING_FIELDS = [
  'screening_details',
  'test_observations',
  'clinical_findings',
];

function isValidSeverity(value) {
  return value === 'routine' || value === 'severe';
}

function validateScreeningFields(body) {
  for (const field of REQUIRED_SCREENING_FIELDS) {
    if (!(body[field] || '').trim()) {
      return `Missing required field: ${field.replace(/_/g, ' ')}`;
    }
  }
  if (!body.severity || !isValidSeverity(body.severity)) {
    return 'Severity classification is required (routine or severe)';
  }
  return null;
}

function isSessionFinalized(screening) {
  if (!screening) return false;
  return Boolean(
    screening.session_completed_at
    || screening.escalated_to_master_doctor_at
  );
}

module.exports = {
  PAP_SMEAR_DEPARTMENT,
  MASTER_DOCTOR_DEPARTMENT,
  SEVERITY_LEVELS,
  REQUIRED_SCREENING_FIELDS,
  isValidSeverity,
  validateScreeningFields,
  isSessionFinalized,
};
