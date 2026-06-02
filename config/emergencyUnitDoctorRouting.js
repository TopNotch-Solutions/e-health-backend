const EMERGENCY_UNIT_DOCTOR_DEPARTMENT = 'emergency_unit_doctor';

const DOCTOR_DISPOSITIONS = [
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'booking_room', label: 'Booking Room' },
];

const DISPOSITION_SET = new Set(DOCTOR_DISPOSITIONS.map((d) => d.value));

function isValidDisposition(value) {
  return DISPOSITION_SET.has(value);
}

function dispositionLabel(value) {
  return DOCTOR_DISPOSITIONS.find((d) => d.value === value)?.label || value;
}

function validateDiagnosis(diagnosis) {
  if (!diagnosis || !String(diagnosis).trim()) {
    return 'Diagnosis / assessment is required before routing.';
  }
  return null;
}

module.exports = {
  EMERGENCY_UNIT_DOCTOR_DEPARTMENT,
  DOCTOR_DISPOSITIONS,
  isValidDisposition,
  dispositionLabel,
  validateDiagnosis,
};
