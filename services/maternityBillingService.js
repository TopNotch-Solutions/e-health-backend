'use strict';

const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const {
  Visit,
  Patient,
  Bill,
  QueueEntry,
  MaternityEpisode,
} = require('../models');
const { isHospitalFacility } = require('../config/clinicRoles');
const { MATERNITY_TARIFFS, defaultWardDayTariff } = require('../config/maternityConfig');
const billingChargeService = require('./billingChargeService');
const queueService = require('./queueService');
const notificationService = require('./notificationService');
const { FEE_KEYS, maternityWardFeeKey } = require('../constants/billingFees');
const { getFeeAmount } = require('./billingFeeService');

const ACTIVE_QUEUE_STATUSES = ['waiting', 'in_progress'];

async function loadFacility(facilityId, transaction) {
  const { Facility } = require('../models');
  if (!facilityId) return null;
  return Facility.findByPk(facilityId, { transaction });
}

async function isHospitalFacilityId(facilityId, transaction) {
  const facility = await loadFacility(facilityId, transaction);
  return isHospitalFacility(facility);
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

async function getOrCreateEpisode(visitId, transaction) {
  let episode = await MaternityEpisode.findOne({ where: { visit_id: visitId }, transaction });
  if (episode) return episode;
  const visit = await Visit.findByPk(visitId, { transaction });
  if (!visit) return null;
  episode = await MaternityEpisode.create({
    id: uuidv4(),
    visit_id: visitId,
    patient_id: visit.patient_id,
    front_office_visits: 0,
    anw_days: 0,
    pnw_days: 0,
    icu_days: 0,
    status: 'active',
  }, { transaction });
  return episode;
}

/**
 * Charge private patient for a maternity front office visit (50 NAD default).
 */
async function chargeFrontOfficeVisit({ visitId, facilityId, transaction }) {
  const amount = await getFeeAmount(
    facilityId,
    FEE_KEYS.MATERNITY_FRONT_OFFICE,
    transaction
  ).catch(() => MATERNITY_TARIFFS.FRONT_OFFICE_VISIT);

  const result = await billingChargeService.addCharge({
    visitId,
    facilityId,
    category: 'maternity_front_office',
    description: 'Maternity front office visit',
    amount: amount || MATERNITY_TARIFFS.FRONT_OFFICE_VISIT,
    referenceId: `mfo-${visitId}-${Date.now()}`,
    transaction,
  });

  if (result && !result.skipped) {
    const episode = await getOrCreateEpisode(visitId, transaction);
    if (episode) {
      await episode.update(
        { front_office_visits: (episode.front_office_visits || 0) + 1 },
        { transaction }
      );
    }
  }

  return result;
}

/**
 * Charge private patient for one ward day (ANW, PNW, or ICU — per-ward tariff).
 */
async function chargeWardDay({ visitId, facilityId, ward, recordDate, transaction }) {
  const wardKey = String(ward || '').toLowerCase();
  const feeKey = maternityWardFeeKey(wardKey);
  const amount = await getFeeAmount(
    facilityId,
    feeKey,
    transaction
  ).catch(() => defaultWardDayTariff(wardKey));

  const refDate = recordDate || new Date().toISOString().slice(0, 10);
  const wardLabel = wardKey.toUpperCase();
  const result = await billingChargeService.addCharge({
    visitId,
    facilityId,
    category: `maternity_${wardKey}_daily`,
    description: `Maternity ${wardLabel} ward — daily stay (${refDate})`,
    amount: amount || defaultWardDayTariff(wardKey),
    referenceId: `mwd-${visitId}-${wardKey}-${refDate}`,
    transaction,
  });

  if (result && !result.skipped) {
    const episode = await getOrCreateEpisode(visitId, transaction);
    if (episode) {
      const dayField = `${wardKey}_days`;
      await episode.update(
        { [dayField]: (episode[dayField] || 0) + 1 },
        { transaction }
      );
    }
  }

  return result;
}

/**
 * Route hospital private maternity patient to billing when clinical queues are clear.
 */
async function routeMaternityPrivateToBilling({
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
  if (!(await isHospitalFacilityId(resolvedFacilityId, transaction))) {
    return { routed: false, reason: 'not_hospital' };
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
      notes: notes || 'Maternity private patient — settlement required',
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

module.exports = {
  chargeFrontOfficeVisit,
  chargeWardDay,
  routeMaternityPrivateToBilling,
  getOrCreateEpisode,
};
