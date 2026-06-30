'use strict';

const { Op } = require('sequelize');
const {
  Visit,
  QueueEntry,
  Facility,
  ClinicHospitalTransfer,
  sequelize,
} = require('../models');
const { isClinicFacility } = require('../config/clinicRoles');
const {
  CLINIC_VISIT_MAX_MS,
  AUTO_CLOSE_QUEUE_NOTE,
} = require('../config/clinicVisitPolicy');
const { BOOKING_ROOM_DEPARTMENT } = require('../config/bookingRoomRouting');

const ACTIVE_QUEUE_STATUSES = ['waiting', 'in_progress'];
const OPEN_TRANSFER_STATUSES = ['pending_booking'];
const CLINIC_TRANSFER_HOLD_STATUSES = [
  'pending_booking',
  'transport_initiated',
  'external_in_transit',
  'departed_clinic',
  'arrived_hospital',
  'internal_in_transit',
  'delivered_to_department',
];

function visitIntakeAt(visit) {
  const row = visit?.toJSON ? visit.toJSON() : visit;
  return row?.created_at ? new Date(row.created_at) : null;
}

function visitExpiresAt(visit) {
  const intake = visitIntakeAt(visit);
  if (!intake || Number.isNaN(intake.getTime())) return null;
  return new Date(intake.getTime() + CLINIC_VISIT_MAX_MS);
}

function isVisitPastClinicDeadline(visit, now = new Date()) {
  const expiresAt = visitExpiresAt(visit);
  if (!expiresAt) return false;
  return expiresAt.getTime() <= now.getTime();
}

function getVisitExpiryInfo(visit, now = new Date()) {
  const expiresAt = visitExpiresAt(visit);
  if (!expiresAt) {
    return { expiresAt: null, expired: false, msRemaining: null };
  }
  const msRemaining = expiresAt.getTime() - now.getTime();
  return {
    expiresAt,
    expired: msRemaining <= 0,
    msRemaining: Math.max(0, msRemaining),
  };
}

async function isClinicVisit(visit, transaction = null) {
  if (!visit?.facility_id) return false;
  const facility = visit.facility
    || await Facility.findByPk(visit.facility_id, { transaction });
  return isClinicFacility(facility);
}

async function isClinicVisitHeldOpen(visitId, transaction = null) {
  const bookingEntry = await QueueEntry.findOne({
    where: {
      visit_id: visitId,
      department: BOOKING_ROOM_DEPARTMENT,
      status: { [Op.in]: ACTIVE_QUEUE_STATUSES },
    },
    transaction,
  });
  if (bookingEntry) return true;

  const openTransfer = await ClinicHospitalTransfer.findOne({
    where: {
      visit_id: visitId,
      transfer_status: { [Op.in]: CLINIC_TRANSFER_HOLD_STATUSES },
    },
    transaction,
  });
  return Boolean(openTransfer);
}

async function expireClinicVisit(visit, { transaction = null, now = new Date() } = {}) {
  if (!visit || visit.status !== 'in_progress') return false;
  if (!(await isClinicVisit(visit, transaction))) return false;
  if (await isClinicVisitHeldOpen(visit.id, transaction)) return false;
  if (!isVisitPastClinicDeadline(visit, now)) return false;

  const activeEntries = await QueueEntry.findAll({
    where: {
      visit_id: visit.id,
      status: { [Op.in]: ACTIVE_QUEUE_STATUSES },
    },
    transaction,
  });

  for (const entry of activeEntries) {
    const mergedNotes = [entry.notes, AUTO_CLOSE_QUEUE_NOTE].filter(Boolean).join(' | ');
    await entry.update({
      status: 'skipped',
      assigned_to: null,
      started_at: null,
      completed_at: now,
      notes: mergedNotes,
    }, { transaction });
  }

  await ClinicHospitalTransfer.update(
    { transfer_status: 'cancelled' },
    {
      where: {
        visit_id: visit.id,
        transfer_status: { [Op.in]: OPEN_TRANSFER_STATUSES },
      },
      transaction,
    }
  );

  await visit.update({
    status: 'completed',
    current_department: null,
    current_queue_position: null,
    completed_at: now,
  }, { transaction });

  return true;
}

async function expireStaleClinicVisitsAtFacility(facilityId, { transaction = null, now = new Date() } = {}) {
  if (!facilityId) return 0;

  const facility = await Facility.findByPk(facilityId, { transaction });
  if (!isClinicFacility(facility)) return 0;

  const cutoff = new Date(now.getTime() - CLINIC_VISIT_MAX_MS);
  const staleVisits = await Visit.findAll({
    where: {
      facility_id: facilityId,
      status: 'in_progress',
      created_at: { [Op.lt]: cutoff },
    },
    transaction,
  });

  let expired = 0;
  for (const visit of staleVisits) {
    if (await expireClinicVisit(visit, { transaction, now })) expired += 1;
  }
  return expired;
}

async function expireStaleClinicVisitsGlobally({ now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - CLINIC_VISIT_MAX_MS);
  const clinics = await Facility.findAll({ where: { type: 'clinic' }, attributes: ['id'] });
  if (!clinics.length) return 0;

  const staleVisits = await Visit.findAll({
    where: {
      facility_id: { [Op.in]: clinics.map((c) => c.id) },
      status: 'in_progress',
      created_at: { [Op.lt]: cutoff },
    },
  });

  let expired = 0;
  for (const visit of staleVisits) {
    if (await expireClinicVisit(visit, { now })) expired += 1;
  }
  return expired;
}

async function assertClinicVisitNotExpired(visit, { autoExpire = true, now = new Date() } = {}) {
  if (!visit || visit.status !== 'in_progress') return visit;
  if (!(await isClinicVisit(visit))) return visit;

  if (!isVisitPastClinicDeadline(visit, now)) return visit;

  if (await isClinicVisitHeldOpen(visit.id)) return visit;

  if (autoExpire) {
    await expireClinicVisit(visit, { now });
  }

  const err = new Error(
    'This clinic visit has ended — the 24-hour window from front office intake has expired. '
    + 'The patient must be registered again at the front office.'
  );
  err.statusCode = 410;
  err.code = 'CLINIC_VISIT_EXPIRED';
  throw err;
}

function startClinicVisitExpiryScheduler({ intervalMs = 15 * 60 * 1000 } = {}) {
  const run = async () => {
    try {
      const count = await expireStaleClinicVisitsGlobally();
      if (count > 0) {
        console.log(`Clinic visit expiry: auto-closed ${count} visit(s) past the 24-hour window`);
      }
    } catch (err) {
      console.error('Clinic visit expiry sweep error:', err.message);
    }
  };

  run();
  return setInterval(run, intervalMs);
}

module.exports = {
  visitIntakeAt,
  visitExpiresAt,
  isVisitPastClinicDeadline,
  getVisitExpiryInfo,
  isClinicVisitHeldOpen,
  expireClinicVisit,
  expireStaleClinicVisitsAtFacility,
  expireStaleClinicVisitsGlobally,
  assertClinicVisitNotExpired,
  startClinicVisitExpiryScheduler,
};
