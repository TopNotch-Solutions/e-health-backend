'use strict';

/** Standard state-hospital clinical queue departments (not clinic-referral outpatient units). */
const HOSPITAL_CORE_QUEUE_DEPARTMENTS = [
  'nurse',
  'doctor',
  'pharmacy',
  'lab',
  'sonar',
  'billing',
  'transport',
];

const HOSPITAL_CORE_QUEUE_SET = new Set(HOSPITAL_CORE_QUEUE_DEPARTMENTS);

function isHospitalCoreQueueDepartment(department) {
  return HOSPITAL_CORE_QUEUE_SET.has(department);
}

module.exports = {
  HOSPITAL_CORE_QUEUE_DEPARTMENTS,
  isHospitalCoreQueueDepartment,
};
