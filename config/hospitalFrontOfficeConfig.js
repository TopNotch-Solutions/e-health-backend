'use strict';

/** Hospital state front office — patients are always sent to the nurse intake queue. */
const HOSPITAL_FRONT_OFFICE_DEPARTMENT = 'nurse';

const HOSPITAL_FRONT_OFFICE_ROUTING = [
  { value: HOSPITAL_FRONT_OFFICE_DEPARTMENT, label: 'Nurse' },
];

const HOSPITAL_FRONT_OFFICE_ROUTING_SET = new Set(
  HOSPITAL_FRONT_OFFICE_ROUTING.map((row) => row.value)
);

function isValidHospitalFrontOfficeRouting(value) {
  return HOSPITAL_FRONT_OFFICE_ROUTING_SET.has(value);
}

module.exports = {
  HOSPITAL_FRONT_OFFICE_DEPARTMENT,
  HOSPITAL_FRONT_OFFICE_ROUTING,
  isValidHospitalFrontOfficeRouting,
};
