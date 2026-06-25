const BOOKING_ROOM_DEPARTMENT = 'booking_room';
const BOOKING_PATHWAY_DERMATOLOGIST = 'pathway:dermatologist';
const BOOKING_PATHWAY_SOCIAL_WORKER = 'pathway:social_worker';

function isBookingRoomDepartment(department) {
  return department === BOOKING_ROOM_DEPARTMENT;
}

const DERMATOLOGIST_PATHWAY_DISPOSITIONS = [
  { value: 'state_hospital', label: 'Transfer to State Hospital', buttonClass: 'primary' },
];

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

function validateStateHospital({ destination_facility_id }) {
  if (!destination_facility_id?.trim()) return 'Select a state hospital facility.';
  return null;
}

function isDermatologistBookingPathway(notes) {
  return (notes || '').includes(BOOKING_PATHWAY_DERMATOLOGIST);
}

function isSocialWorkerBookingPathway(notes) {
  return (notes || '').includes(BOOKING_PATHWAY_SOCIAL_WORKER);
}

function dispositionsForPathway(pathwayRestricted) {
  return pathwayRestricted ? DERMATOLOGIST_PATHWAY_DISPOSITIONS : FINAL_DISPOSITIONS;
}

function validateMortuary({ cause_of_death, date_of_death }) {
  if (!date_of_death) return 'Date of death is required.';
  return null;
}

module.exports = {
  BOOKING_ROOM_DEPARTMENT,
  BOOKING_PATHWAY_DERMATOLOGIST,
  BOOKING_PATHWAY_SOCIAL_WORKER,
  isBookingRoomDepartment,
  FINAL_DISPOSITIONS,
  DERMATOLOGIST_PATHWAY_DISPOSITIONS,
  isDermatologistBookingPathway,
  isSocialWorkerBookingPathway,
  dispositionsForPathway,
  isValidDisposition,
  dispositionLabel,
  validateStateHospital,
  validateMortuary,
};
