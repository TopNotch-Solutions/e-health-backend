'use strict';

const {
  FRONT_OFFICE_ROUTING,
  EMERGENCY_UNIT_DEPARTMENT,
  routingLabel,
} = require('../config/clinicQueueDepartments');
const { SCREENING_DESTINATIONS } = require('../config/screeningNurseRouting');
const { VISIT_CLASSIFICATIONS } = require('../config/parameterNurseRouting');
const { getActiveQueueDepartmentsForFacility, getHospitalFrontOfficeRoutingForFacility } = require('./clinicFacilityDepartmentService');
const { isHospitalFacility } = require('../config/clinicRoles');
const { Facility } = require('../models');

function filterByActiveQueues(options, activeQueues) {
  if (!activeQueues) return options;
  return options.filter((opt) => activeQueues.has(opt.value));
}

async function getClinicRoutingOptionsForFacility(facilityId) {
  const facility = facilityId ? await Facility.findByPk(facilityId) : null;

  if (facility && isHospitalFacility(facility)) {
    const front_office = await getHospitalFrontOfficeRoutingForFacility(facilityId);
    return {
      is_clinic: false,
      is_hospital: true,
      active_queue_departments: front_office.map((row) => row.value),
      emergency_unit_available: front_office.some((row) => row.value === 'hospital_emergency_unit'),
      front_office,
      screening_nurse: [],
      parameter_nurse: {},
    };
  }

  const activeQueues = facilityId
    ? await getActiveQueueDepartmentsForFacility(facilityId)
    : null;

  const parameterNurse = {};
  for (const [key, cfg] of Object.entries(VISIT_CLASSIFICATIONS)) {
    parameterNurse[key] = {
      label: cfg.label,
      destinations: filterByActiveQueues(
        cfg.allowedDestinations.map((value) => ({
          value,
          label: routingLabel(value),
        })),
        activeQueues
      ),
    };
  }

  return {
    is_clinic: Boolean(activeQueues),
    is_hospital: false,
    active_queue_departments: activeQueues ? [...activeQueues] : null,
    emergency_unit_available: activeQueues ? activeQueues.has(EMERGENCY_UNIT_DEPARTMENT) : true,
    front_office: filterByActiveQueues(FRONT_OFFICE_ROUTING, activeQueues),
    screening_nurse: filterByActiveQueues(SCREENING_DESTINATIONS, activeQueues),
    parameter_nurse: parameterNurse,
  };
}

module.exports = {
  getClinicRoutingOptionsForFacility,
};
