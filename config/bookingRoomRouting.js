const BOOKING_ROOM_DEPARTMENT = 'booking_room';

const FINAL_DISPOSITIONS = [
  { value: 'state_hospital', label: 'Transfer to State Hospital', buttonClass: 'primary' },
  { value: 'mortuary', label: 'Process to Mortuary', buttonClass: 'emergency' },
];

const DISPOSITION_SET = new Set(FINAL_DISPOSITIONS.map((d) => d.value));

function isValidDisposition(value) {
  return DISPOSITION_SET.has(value);
}

function dispositionLabel(value) {
  return FINAL_DISPOSITIONS.find((d) => d.value === value)?.label || value;
}

function validateStateHospital({ destination_facility_id, reason }) {
  if (!destination_facility_id?.trim()) return 'Select a state hospital facility.';
  if (!reason?.trim()) return 'Transfer reason is required.';
  return null;
}

function validateMortuary({ cause_of_death, date_of_death }) {
  if (!date_of_death) return 'Date of death is required.';
  return null;
}

module.exports = {
  BOOKING_ROOM_DEPARTMENT,
  FINAL_DISPOSITIONS,
  isValidDisposition,
  dispositionLabel,
  validateStateHospital,
  validateMortuary,
};
