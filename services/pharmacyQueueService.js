'use strict';

const { Op } = require('sequelize');
const { Prescription, Visit, Patient, QueueEntry, Facility } = require('../models');

const OPEN_PRESCRIPTION_STATUSES = ['pending', 'partially_dispensed'];
const ACTIVE_QUEUE_STATUSES = ['waiting', 'in_progress'];

/** Patients currently waiting in pharmacy at this facility (may be collecting elsewhere-prescribed meds). */
async function getPatientIdsInPharmacyQueueAtFacility(facilityId, transaction = null) {
  const entries = await QueueEntry.findAll({
    where: {
      department: 'pharmacy',
      status: { [Op.in]: ACTIVE_QUEUE_STATUSES },
    },
    include: [{
      model: Visit,
      as: 'visit',
      where: { facility_id: facilityId },
      attributes: ['patient_id'],
      required: true,
    }],
    attributes: [],
    transaction,
  });

  return [...new Set(entries.map((entry) => entry.visit?.patient_id).filter(Boolean))];
}

function buildVisitWhereForPharmacyQueue(queuePatientIds) {
  if (!queuePatientIds.length) {
    return { patient_id: { [Op.in]: [] } };
  }
  return { patient_id: { [Op.in]: queuePatientIds } };
}

/**
 * Open prescriptions for patients currently in the pharmacy queue at this facility
 * (includes cross-facility collection when the patient is queued here).
 */
async function findOpenPrescriptionsForPharmacyQueue(facilityId, transaction = null) {
  const queuePatientIds = await getPatientIdsInPharmacyQueueAtFacility(facilityId, transaction);
  if (!queuePatientIds.length) return [];

  return Prescription.findAll({
    where: { status: { [Op.in]: OPEN_PRESCRIPTION_STATUSES } },
    include: [
      {
        association: 'visit',
        where: buildVisitWhereForPharmacyQueue(queuePatientIds),
        include: [
          {
            model: Patient,
            as: 'patient',
            attributes: ['id', 'first_name', 'last_name', 'patient_number'],
          },
          {
            model: Facility,
            as: 'facility',
            attributes: ['id', 'name', 'type'],
          },
        ],
      },
      { association: 'items' },
      { association: 'prescribedBy', attributes: ['id', 'first_name', 'last_name'] },
    ],
    order: [['created_at', 'ASC']],
    transaction,
  });
}

module.exports = {
  OPEN_PRESCRIPTION_STATUSES,
  findOpenPrescriptionsForPharmacyQueue,
  getPatientIdsInPharmacyQueueAtFacility,
};
