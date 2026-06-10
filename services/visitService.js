'use strict';

const { Op } = require('sequelize');
const { Visit, QueueEntry } = require('../models');

const ACTIVE_VISIT_STATUSES = ['in_progress'];
const ACTIVE_QUEUE_STATUSES = ['waiting', 'in_progress'];

/**
 * Latest in-progress visit for a patient at a facility.
 */
async function findActiveVisitForPatient(patientId, facilityId, transaction = null) {
  if (!patientId || !facilityId) return null;

  return Visit.findOne({
    where: {
      patient_id: patientId,
      facility_id: facilityId,
      status: { [Op.in]: ACTIVE_VISIT_STATUSES },
    },
    order: [['created_at', 'DESC']],
    transaction,
  });
}

/**
 * Any active queue row for this patient at the facility (any department).
 */
async function findActiveQueueEntryForPatient(patientId, facilityId, transaction = null) {
  if (!patientId || !facilityId) return null;

  return QueueEntry.findOne({
    where: {
      status: { [Op.in]: ACTIVE_QUEUE_STATUSES },
    },
    include: [
      {
        association: 'visit',
        where: {
          patient_id: patientId,
          facility_id: facilityId,
          status: { [Op.in]: ACTIVE_VISIT_STATUSES },
        },
        required: true,
        attributes: ['id', 'visit_number', 'current_department', 'status'],
      },
    ],
    order: [['created_at', 'DESC']],
    transaction,
  });
}

function formatDepartmentLabel(department) {
  if (!department) return 'the facility';
  return String(department).replace(/_/g, ' ');
}

/**
 * Reject starting a new visit/registration when the patient is already in an active consultation.
 */
async function assertNoActiveVisitForPatient(patientId, facilityId, transaction = null) {
  const activeVisit = await findActiveVisitForPatient(patientId, facilityId, transaction);
  if (!activeVisit) return null;

  const queueEntry = await findActiveQueueEntryForPatient(patientId, facilityId, transaction);
  const location = queueEntry?.department || activeVisit.current_department;
  const locationLabel = formatDepartmentLabel(location);

  const err = new Error(
    `Patient already has an active visit (${activeVisit.visit_number})`
    + (locationLabel ? ` and is currently in ${locationLabel}` : '')
    + '. Complete or discharge the current visit before starting a new one.'
  );
  err.statusCode = 409;
  err.activeVisit = activeVisit;
  err.queueEntry = queueEntry;
  throw err;
}

function serializeActiveVisitSummary(visit, queueEntry = null) {
  if (!visit) return null;
  const row = visit.toJSON ? visit.toJSON() : visit;
  return {
    id: row.id,
    visit_number: row.visit_number,
    status: row.status,
    current_department: row.current_department,
    queue_department: queueEntry?.department || null,
    queue_status: queueEntry?.status || null,
  };
}

module.exports = {
  ACTIVE_VISIT_STATUSES,
  findActiveVisitForPatient,
  findActiveQueueEntryForPatient,
  assertNoActiveVisitForPatient,
  serializeActiveVisitSummary,
};
