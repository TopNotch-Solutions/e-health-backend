'use strict';

const {
  FRONT_OFFICE_ROUTING,
  EMERGENCY_UNIT_DEPARTMENT,
  routingLabel,
} = require('../config/clinicQueueDepartments');
const { SCREENING_DESTINATIONS } = require('../config/screeningNurseRouting');
const { VISIT_CLASSIFICATIONS } = require('../config/parameterNurseRouting');
const { getActiveQueueDepartmentsForFacility } = require('./clinicFacilityDepartmentService');

function filterByActiveQueues(options, activeQueues) {
  if (!activeQueues) return options;
  return options.filter((opt) => activeQueues.has(opt.value));
}

async function getClinicRoutingOptionsForFacility(facilityId) {
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
