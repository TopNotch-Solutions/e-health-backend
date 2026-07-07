'use strict';

const { Op } = require('sequelize');
const { Prescription, Visit } = require('../models');
const { OPEN_PRESCRIPTION_STATUSES } = require('./pharmacyQueueService');

/**
 * True when the patient has at least one open prescription at any facility
 * (medication can be collected at whichever clinic or hospital they attend).
 */
async function patientHasPendingMedication(patientId, _facilityId = null, transaction = null) {
  if (!patientId) return false;

  const count = await Prescription.count({
    where: { status: { [Op.in]: OPEN_PRESCRIPTION_STATUSES } },
    include: [{
      model: Visit,
      as: 'visit',
      where: { patient_id: patientId },
      attributes: [],
      required: true,
    }],
    transaction,
  });

  return count > 0;
}

/** Batch lookup for patient search — returns Map patientId -> boolean */
async function pendingMedicationFlagsForPatients(patientIds, _facilityId = null, transaction = null) {
  const flags = new Map((patientIds || []).map((id) => [id, false]));
  if (!patientIds?.length) return flags;

  const rows = await Prescription.findAll({
    attributes: [],
    where: { status: { [Op.in]: OPEN_PRESCRIPTION_STATUSES } },
    include: [{
      model: Visit,
      as: 'visit',
      where: { patient_id: { [Op.in]: patientIds } },
      attributes: ['patient_id'],
      required: true,
    }],
    transaction,
  });

  for (const row of rows) {
    const patientId = row.visit?.patient_id;
    if (patientId) flags.set(patientId, true);
  }

  return flags;
}

module.exports = {
  OPEN_PRESCRIPTION_STATUSES,
  patientHasPendingMedication,
  pendingMedicationFlagsForPatients,
};
