'use strict';

const { getClinicalMedicalHistory } = require('./patientMedicalHistoryService');
const { MATERNITY_DEPARTMENTS, isMaternityDepartment } = require('../config/maternityConfig');

const MATERNITY_DEPT_SET = new Set(Object.values(MATERNITY_DEPARTMENTS));

/**
 * Maternity pathway history for a patient — maternity queue stops and clinical captures only.
 */
async function getMaternityMedicalHistory(patientId, facilityId) {
  const full = await getClinicalMedicalHistory(patientId, facilityId);

  const visits = (full.visits || [])
    .map((visit) => ({
      ...visit,
      stops: (visit.stops || []).filter((stop) => MATERNITY_DEPT_SET.has(stop.department)),
    }))
    .filter((visit) => visit.stops.length > 0);

  return {
    visits,
    meta: {
      scope: 'maternity',
      visit_count: visits.length,
      departments: [...MATERNITY_DEPT_SET],
    },
  };
}

function isMaternityStop(department) {
  return isMaternityDepartment(department);
}

module.exports = {
  getMaternityMedicalHistory,
  isMaternityStop,
  MATERNITY_DEPT_SET,
};
