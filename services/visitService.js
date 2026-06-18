'use strict';

/**
 * Visit / queue state helpers used across the whole hospital system
 * (clinic, emergency, maternity, billing, etc.).
 */

const { Op } = require('sequelize');const { Visit, QueueEntry } = require('../models');

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

async function countActiveQueuesForVisit(visitId, transaction = null) {
  if (!visitId) return 0;
  return QueueEntry.count({
    where: {
      visit_id: visitId,
      status: { [Op.in]: ACTIVE_QUEUE_STATUSES },
    },
    transaction,
  });
}

/**
 * Ward / maternity inpatient visits stay open between daily queue sign-offs.
 */
async function isInpatientVisit(visitId, transaction = null) {
  const { MaternityEpisode, Admission } = require('../models');

  const episode = await MaternityEpisode.findOne({
    where: { visit_id: visitId, status: 'active' },
    transaction,
  });
  if (episode?.current_ward) return true;

  const admission = await Admission.findOne({
    where: {
      visit_id: visitId,
      status: { [Op.in]: ['pending_arrival', 'admitted'] },
    },
    transaction,
  });
  return Boolean(admission);
}

/**
 * Fix visits left in_progress after all queue rows were completed.
 * - Inpatients: clear stale current_department only.
 * - Outpatients: close the visit so the patient can check in again.
 */
async function reconcileStaleQueueVisit(activeVisit, transaction = null) {
  if (!activeVisit || activeVisit.status !== 'in_progress') return false;

  const activeQueueCount = await countActiveQueuesForVisit(activeVisit.id, transaction);
  if (activeQueueCount > 0) return false;

  const inpatient = await isInpatientVisit(activeVisit.id, transaction);

  if (inpatient) {
    if (!activeVisit.current_department && activeVisit.current_queue_position == null) {
      return false;
    }
    await activeVisit.update(
      {
        current_department: null,
        current_queue_position: null,
      },
      { transaction }
    );
    return true;
  }

  await activeVisit.update(
    {
      status: 'completed',
      current_department: null,
      current_queue_position: null,
      completed_at: activeVisit.completed_at || new Date(),
    },
    { transaction }
  );
  return true;
}

/**
 * Reconcile in-progress visits at a facility that no longer have queue rows.
 * Used on patient lookup so stale locations are cleared system-wide.
 */
async function reconcileFacilityStaleVisits(facilityId, transaction = null) {
  if (!facilityId) return 0;

  const visits = await Visit.findAll({
    where: {
      facility_id: facilityId,
      status: { [Op.in]: ACTIVE_VISIT_STATUSES },
    },
    transaction,
  });

  let fixed = 0;
  for (const visit of visits) {
    if (await reconcileStaleQueueVisit(visit, transaction)) fixed += 1;
  }
  return fixed;
}

/**
 * Reconcile visits still marked for a department when loading that queue.
 */
async function reconcileDepartmentStaleVisits(facilityId, department, transaction = null) {
  if (!facilityId || !department) return 0;

  const visits = await Visit.findAll({
    where: {
      facility_id: facilityId,
      status: { [Op.in]: ACTIVE_VISIT_STATUSES },
      current_department: department,
    },
    transaction,
  });

  let fixed = 0;
  for (const visit of visits) {
    if (await reconcileStaleQueueVisit(visit, transaction)) fixed += 1;
  }
  return fixed;
}

/** @deprecated use reconcileStaleQueueVisit */
const reconcileStaleMaternityQueueVisit = reconcileStaleQueueVisit;

async function getActiveVisitContext(patientId, facilityId, transaction = null) {
  let activeVisit = await findActiveVisitForPatient(patientId, facilityId, transaction);
  if (activeVisit) {
    await reconcileStaleQueueVisit(activeVisit, transaction);
    activeVisit = await findActiveVisitForPatient(patientId, facilityId, transaction);
  }

  const activeQueue = activeVisit
    ? await findActiveQueueEntryForPatient(patientId, facilityId, transaction)
    : null;

  return { activeVisit, activeQueue };
}

function formatDepartmentLabel(department) {
  if (!department) return 'the facility';
  return String(department).replace(/_/g, ' ');
}

/**
 * Reject starting a new visit/registration when the patient is already in an active consultation.
 */
async function assertNoActiveVisitForPatient(patientId, facilityId, transaction = null) {
  const { activeVisit, activeQueue } = await getActiveVisitContext(
    patientId,
    facilityId,
    transaction
  );
  if (!activeVisit) return null;

  const location = activeQueue?.department || activeVisit.current_department;
  const locationLabel = formatDepartmentLabel(location);

  const err = new Error(
    `Patient already has an active visit (${activeVisit.visit_number})`
    + (locationLabel ? ` and is currently in ${locationLabel}` : '')
    + '. Complete or discharge the current visit before starting a new one.'
  );
  err.statusCode = 409;
  err.activeVisit = activeVisit;
  err.queueEntry = activeQueue;
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
    is_stale_location: Boolean(!queueEntry && row.current_department),
  };
}

module.exports = {
  ACTIVE_VISIT_STATUSES,
  ACTIVE_QUEUE_STATUSES,
  findActiveVisitForPatient,
  findActiveQueueEntryForPatient,
  countActiveQueuesForVisit,
  isInpatientVisit,
  reconcileStaleQueueVisit,
  reconcileStaleMaternityQueueVisit,
  reconcileFacilityStaleVisits,
  reconcileDepartmentStaleVisits,
  getActiveVisitContext,
  assertNoActiveVisitForPatient,
  serializeActiveVisitSummary,
};
