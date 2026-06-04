/**
 * Clinic Dermatologist — consultation queue and booking room pathway.
 */

const DERMATOLOGIST_DEPARTMENT = 'dermatologist';
const BOOKING_ROOM_DEPARTMENT = 'booking_room';
const BOOKING_PATHWAY_DERMATOLOGIST = 'pathway:dermatologist';

const PHARMACY_DEPARTMENT = 'pharmacy';

const DERMATOLOGIST_DISPOSITIONS = [
  { value: 'complete_session', label: 'Save & complete session' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'booking_room', label: 'Booking Room' },
];

const REQUIRED_OBSERVATION_FIELDS = ['clinical_observations', 'skin_assessment'];

function isSessionFinalized(assessment) {
  if (!assessment) return false;
  return Boolean(
    assessment.session_completed_at
    || assessment.routed_to_booking_at
    || assessment.routed_to_pharmacy_at
  );
}

function isDermatologistBookingPathway(notes) {
  return (notes || '').includes(BOOKING_PATHWAY_DERMATOLOGIST);
}

function validateObservationFields(body) {
  for (const field of REQUIRED_OBSERVATION_FIELDS) {
    if (!(body[field] || '').trim()) {
      return `Missing required field: ${field.replace(/_/g, ' ')}`;
    }
  }
  return null;
}

module.exports = {
  DERMATOLOGIST_DEPARTMENT,
  BOOKING_ROOM_DEPARTMENT,
  PHARMACY_DEPARTMENT,
  BOOKING_PATHWAY_DERMATOLOGIST,
  DERMATOLOGIST_DISPOSITIONS,
  REQUIRED_OBSERVATION_FIELDS,
  isDermatologistBookingPathway,
  isSessionFinalized,
  validateObservationFields,
};
