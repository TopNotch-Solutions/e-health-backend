'use strict';

const {
  buildHospitalFrontOfficeRouting,
  FULL_HOSPITAL_TEMPLATE_KEYS,
  hospitalFrontOfficeRoutingLabel,
  isValidHospitalFrontOfficeRouting,
} = require('./hospitalFacilityDepartments');

/** @deprecated static list — use buildHospitalFrontOfficeRouting(activeDepartmentKeys) */
const HOSPITAL_FRONT_OFFICE_DEPARTMENT = 'nurse';

/** Default full-template front office routes (all routable departments active). */
const HOSPITAL_FRONT_OFFICE_ROUTING = buildHospitalFrontOfficeRouting(FULL_HOSPITAL_TEMPLATE_KEYS);

const HOSPITAL_FRONT_OFFICE_ROUTING_SET = new Set(
  HOSPITAL_FRONT_OFFICE_ROUTING.map((row) => row.value)
);

function isValidHospitalFrontOfficeRoutingValue(value, allowedRoutes) {
  if (allowedRoutes) {
    return allowedRoutes.some((row) => row.value === value);
  }
  return isValidHospitalFrontOfficeRouting(value, HOSPITAL_FRONT_OFFICE_ROUTING);
}

module.exports = {
  HOSPITAL_FRONT_OFFICE_DEPARTMENT,
  HOSPITAL_FRONT_OFFICE_ROUTING,
  isValidHospitalFrontOfficeRouting: isValidHospitalFrontOfficeRoutingValue,
  buildHospitalFrontOfficeRouting,
  hospitalFrontOfficeRoutingLabel,
};
