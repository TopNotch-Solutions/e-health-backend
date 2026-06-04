/**
 * Clinic Pediatric Corner — age-restricted triage and Master Doctor routing.
 */

const PEDIATRIC_DEPARTMENT = 'pediatric';
const MASTER_DOCTOR_DEPARTMENT = 'master_doctor';
const MAX_PEDIATRIC_AGE_EXCLUSIVE = 12;

function ageFromDateOfBirth(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

function pediatricEligibilityForPatient(patient) {
  const age = ageFromDateOfBirth(patient?.date_of_birth);
  if (age == null) {
    return {
      eligible: false,
      age: null,
      message: 'Patient date of birth is required. Pediatric Corner only accepts children under 12 years.',
    };
  }
  if (age >= MAX_PEDIATRIC_AGE_EXCLUSIVE) {
    return {
      eligible: false,
      age,
      message: `This patient is ${age} years old. Pediatric Corner is only for patients under ${MAX_PEDIATRIC_AGE_EXCLUSIVE} years.`,
    };
  }
  return {
    eligible: true,
    age,
    message: null,
  };
}

function validateAssessmentFields(body) {
  const temp = body.temperature;
  if (temp == null || temp === '' || Number.isNaN(Number(temp))) {
    return 'Temperature is required';
  }
  const weight = body.weight;
  if (weight == null || weight === '' || Number.isNaN(Number(weight))) {
    return 'Weight is required';
  }
  if (!(body.general_assessment || '').trim()) {
    return 'General assessment narrative is required';
  }
  return null;
}

function isSessionFinalized(assessment) {
  if (!assessment) return false;
  return Boolean(assessment.routed_to_master_doctor_at);
}

module.exports = {
  PEDIATRIC_DEPARTMENT,
  MASTER_DOCTOR_DEPARTMENT,
  MAX_PEDIATRIC_AGE_EXCLUSIVE,
  ageFromDateOfBirth,
  pediatricEligibilityForPatient,
  validateAssessmentFields,
  isSessionFinalized,
};
