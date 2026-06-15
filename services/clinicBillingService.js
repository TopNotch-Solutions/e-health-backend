const { Op } = require('sequelize');
const { Facility, Visit, Patient, Bill, QueueEntry } = require('../models');
const { isClinicFacility } = require('../config/clinicRoles');
const billingChargeService = require('./billingChargeService');
const queueService = require('./queueService');
const notificationService = require('./notificationService');

const ACTIVE_QUEUE_STATUSES = ['waiting', 'in_progress'];

async function loadFacility(facilityId, transaction) {
  if (!facilityId) return null;
  return Facility.findByPk(facilityId, { transaction });
}

async function isClinicFacilityId(facilityId, transaction) {
  const facility = await loadFacility(facilityId, transaction);
  return isClinicFacility(facility);
}

async function countActiveClinicalQueues(visitId, transaction) {
  return QueueEntry.count({
    where: {
      visit_id: visitId,
      department: { [Op.ne]: 'billing' },
      status: { [Op.in]: ACTIVE_QUEUE_STATUSES },
    },
    transaction,
  });
}

/**
 * After clinical activities, send clinic private patients to billing when nothing else is queued.
 */
async function routePrivatePatientToBilling({
  visitId,
  facilityId,
  userId,
  notes,
  transaction,
}) {
  const visit = await Visit.findByPk(visitId, {
    include: [{ model: Patient, as: 'patient' }],
    transaction,
  });
  if (!visit || visit.status !== 'in_progress') {
    return { routed: false, reason: 'visit_not_active' };
  }

  const resolvedFacilityId = facilityId || visit.facility_id;
  if (!(await isClinicFacilityId(resolvedFacilityId, transaction))) {
    return { routed: false, reason: 'not_clinic' };
  }

  if (visit.patient?.payment_type !== 'private') {
    return { routed: false, reason: 'state_patient' };
  }

  const activeClinical = await countActiveClinicalQueues(visitId, transaction);
  if (activeClinical > 0) {
    return { routed: false, reason: 'clinical_queues_active' };
  }

  const existingBilling = await queueService.findActiveEntryForVisit(visitId, 'billing', transaction);
  if (existingBilling) {
    return { routed: false, reason: 'already_in_billing', queueEntry: existingBilling };
  }

  await billingChargeService.finalizeBillForDischarge(visitId, resolvedFacilityId, transaction);

  const bill = await Bill.findOne({ where: { visit_id: visitId }, transaction });
  const totalDue = bill ? billingChargeService.money(bill.total_amount) : 0;

  if (!bill || bill.status === 'paid' || bill.status === 'waived' || totalDue <= 0) {
    return { routed: false, reason: 'nothing_due', bill };
  }

  const queueEntry = await queueService.pushToQueue(
    {
      visit_id: visitId,
      department: 'billing',
      priority: 'normal',
      pushed_by: userId,
      notes: notes || 'Clinic private patient — settlement required',
    },
    transaction
  );

  await visit.update({ current_department: 'billing' }, { transaction });

  notificationService.emitBillingCharge({
    facility_id: resolvedFacilityId,
    visit_id: visitId,
    patient: visit.patient,
    queueEntry,
    bill_id: bill.id,
    total_amount: totalDue,
  });

  return { routed: true, queueEntry, bill, total_amount: totalDue };
}

/**
 * Complete a clinic visit or hold it open for billing (private patients).
 */
async function applyVisitEndState({ visitId, facilityId, userId, transaction, notes }) {
  const routed = await routePrivatePatientToBilling({
    visitId,
    facilityId,
    userId,
    notes,
    transaction,
  });

  if (routed.routed) {
    return { routedToBilling: true, ...routed };
  }

  if (routed.reason === 'clinical_queues_active' || routed.reason === 'already_in_billing') {
    return {
      routedToBilling: routed.reason === 'already_in_billing',
      holdVisitOpen: true,
      ...routed,
    };
  }

  await Visit.update(
    {
      status: 'completed',
      completed_at: new Date(),
      current_department: null,
      current_queue_position: null,
    },
    { where: { id: visitId }, transaction }
  );

  return { routedToBilling: false, visitCompleted: true };
}

module.exports = {
  isClinicFacilityId,
  routePrivatePatientToBilling,
  applyVisitEndState,
  countActiveClinicalQueues,
};
