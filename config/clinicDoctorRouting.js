const CLINIC_DOCTOR_DEPARTMENT = 'master_doctor';

const CLINIC_DISPOSITIONS = [
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'follow_up', label: 'Follow-up appointment' },
  { value: 'booking_room', label: 'Booking Room' },
  { value: 'emergency_unit', label: 'Emergency Unit' },
];

const DISPOSITION_VALUE_SET = new Set(CLINIC_DISPOSITIONS.map((d) => d.value));

function isValidDisposition(value) {
  return DISPOSITION_VALUE_SET.has(value);
}

function dispositionLabel(value) {
  return CLINIC_DISPOSITIONS.find((d) => d.value === value)?.label || value;
}

function validateDiagnosis(diagnosis) {
  if (!diagnosis || !String(diagnosis).trim()) {
    return 'Diagnosis is required before disposition.';
  }
  return null;
}

module.exports = {
  CLINIC_DOCTOR_DEPARTMENT,
  CLINIC_DISPOSITIONS,
  isValidDisposition,
  dispositionLabel,
  validateDiagnosis,
};
