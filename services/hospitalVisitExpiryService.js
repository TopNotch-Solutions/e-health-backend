'use strict';

const { Op } = require('sequelize');
const {
  Visit,
  QueueEntry,
  Facility,
  sequelize,
} = require('../models');
const { isHospitalFacility } = require('../config/clinicRoles');
const {
  CLINIC_VISIT_MAX_MS,
  HOSPITAL_AUTO_CLOSE_QUEUE_NOTE,
} = require('../config/clinicVisitPolicy');

const ACTIVE_QUEUE_STATUSES = ['waiting', 'in_progress'];

function visitIntakeAt(visit) {
  const row = visit?.toJSON ? visit.toJSON() : visit;
  return row?.created_at ? new Date(row.created_at) : null;
}

function visitExpiresAt(visit) {
  const intake = visitIntakeAt(visit);
  if (!intake || Number.isNaN(intake.getTime())) return null;
  return new Date(intake.getTime() + CLINIC_VISIT_MAX_MS);
}

function isVisitPastHospitalDeadline(visit, now = new Date()) {
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

async function isHospitalVisit(visit, transaction = null) {
  if (!visit?.facility_id) return false;
  const facility = visit.facility
    || await Facility.findByPk(visit.facility_id, { transaction });
  return isHospitalFacility(facility);
}

async function isHospitalVisitHeldOpen(visitId, transaction = null) {
  const { isInpatientVisit } = require('./visitService');
  return isInpatientVisit(visitId, transaction);
}

async function expireHospitalVisit(visit, { transaction = null, now = new Date() } = {}) {
  if (!visit || visit.status !== 'in_progress') return false;
  if (!(await isHospitalVisit(visit, transaction))) return false;
  if (await isHospitalVisitHeldOpen(visit.id, transaction)) return false;
  if (!isVisitPastHospitalDeadline(visit, now)) return false;

  const activeEntries = await QueueEntry.findAll({
    where: {
      visit_id: visit.id,
      status: { [Op.in]: ACTIVE_QUEUE_STATUSES },
    },
    transaction,
  });

  for (const entry of activeEntries) {
    const mergedNotes = [entry.notes, HOSPITAL_AUTO_CLOSE_QUEUE_NOTE].filter(Boolean).join(' | ');
    await entry.update({
      status: 'skipped',
      assigned_to: null,
      started_at: null,
      completed_at: now,
      notes: mergedNotes,
    }, { transaction });
  }

  await visit.update({
    status: 'completed',
    current_department: null,
    current_queue_position: null,
    completed_at: now,
  }, { transaction });

  return true;
}

async function expireStaleHospitalVisitsAtFacility(facilityId, { transaction = null, now = new Date() } = {}) {
  if (!facilityId) return 0;

  const facility = await Facility.findByPk(facilityId, { transaction });
  if (!isHospitalFacility(facility)) return 0;

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
    if (await expireHospitalVisit(visit, { transaction, now })) expired += 1;
  }
  return expired;
}

async function expireStaleHospitalVisitsGlobally({ now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - CLINIC_VISIT_MAX_MS);
  const hospitals = await Facility.findAll({
    where: { type: { [Op.in]: ['hospital', 'health_center'] } },
    attributes: ['id'],
  });
  if (!hospitals.length) return 0;

  const staleVisits = await Visit.findAll({
    where: {
      facility_id: { [Op.in]: hospitals.map((h) => h.id) },
      status: 'in_progress',
      created_at: { [Op.lt]: cutoff },
    },
  });

  let expired = 0;
  for (const visit of staleVisits) {
    if (await expireHospitalVisit(visit, { now })) expired += 1;
  }
  return expired;
}

async function assertHospitalVisitNotExpired(visit, { autoExpire = true, now = new Date() } = {}) {
  if (!visit || visit.status !== 'in_progress') return visit;
  if (!(await isHospitalVisit(visit))) return visit;

  if (!isVisitPastHospitalDeadline(visit, now)) return visit;

  if (await isHospitalVisitHeldOpen(visit.id)) return visit;

  if (autoExpire) {
    await expireHospitalVisit(visit, { now });
  }

  const err = new Error(
    'This hospital visit has ended — the 24-hour window from front office intake has expired. '
    + 'The patient must be registered again at the front office.'
  );
  err.statusCode = 410;
  err.code = 'HOSPITAL_VISIT_EXPIRED';
  throw err;
}

function startHospitalVisitExpiryScheduler({ intervalMs = 15 * 60 * 1000 } = {}) {
  const run = async () => {
    try {
      const count = await expireStaleHospitalVisitsGlobally();
      if (count > 0) {
        console.log(`Hospital visit expiry: auto-closed ${count} visit(s) past the 24-hour window`);
      }
    } catch (err) {
      console.error('Hospital visit expiry sweep error:', err.message);
    }
  };

  run();
  return setInterval(run, intervalMs);
}

module.exports = {
  visitIntakeAt,
  visitExpiresAt,
  isVisitPastHospitalDeadline,
  getVisitExpiryInfo,
  isHospitalVisitHeldOpen,
  expireHospitalVisit,
  expireStaleHospitalVisitsAtFacility,
  expireStaleHospitalVisitsGlobally,
  assertHospitalVisitNotExpired,
  startHospitalVisitExpiryScheduler,
};
