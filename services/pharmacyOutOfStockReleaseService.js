'use strict';

const { Prescription, Visit } = require('../models');
const { enrichPrescription } = require('./pharmacyStockStatus');
const queueService = require('./queueService');
const { countActiveClinicalQueues, applyVisitEndState } = require('./clinicBillingService');

/**
 * Active pharmacy queue row for this patient at the dispensing facility.
 * Cross-facility collection uses a visit here, not necessarily the prescription's visit.
 */
async function findPharmacyQueueEntryForPrescription(prescription, facilityId, transaction) {
  const patientId = prescription.visit?.patient_id;
  if (!patientId) {
    const visit = await Visit.findByPk(prescription.visit_id, { transaction });
    if (!visit?.patient_id) return null;
    return queueService.findActiveEntryForPatient(
      visit.patient_id,
      'pharmacy',
      facilityId,
      transaction
    );
  }

  const entryAtFacility = await queueService.findActiveEntryForPatient(
    patientId,
    'pharmacy',
    facilityId,
    transaction
  );
  if (entryAtFacility) return entryAtFacility;

  return queueService.findActiveEntryForVisit(prescription.visit_id, 'pharmacy', transaction);
}

/**
 * Remove a patient from the pharmacy queue when all pending lines are out of stock.
 * If pharmacy was the only active clinical stop, end the visit (billing or completed).
 */
async function releaseOutOfStockFromPharmacyQueue({
  prescriptionId,
  facilityId,
  userId,
  transaction,
}) {
  const prescription = await Prescription.findByPk(prescriptionId, {
    include: [{ association: 'items' }, { association: 'visit' }],
    transaction,
  });
  if (!prescription) {
    throw Object.assign(new Error('Prescription not found'), { statusCode: 404 });
  }

  const enriched = await enrichPrescription(prescription, facilityId, transaction);
  const pending = (enriched.items || []).filter((item) => !item.dispensed_at);

  if (!pending.length) {
    throw Object.assign(new Error('No pending medications on this prescription'), { statusCode: 400 });
  }

  const dispensable = pending.filter((item) => item.can_dispense !== false && item.stock_status !== 'out_of_stock');
  if (dispensable.length > 0) {
    throw Object.assign(
      new Error('Some medications are still in stock — dispense available items or wait for the patient'),
      { statusCode: 400 }
    );
  }

  const pharmacyEntry = await findPharmacyQueueEntryForPrescription(
    prescription,
    facilityId,
    transaction
  );

  if (!pharmacyEntry) {
    throw Object.assign(
      new Error('No active pharmacy queue entry found for this patient'),
      { statusCode: 404 }
    );
  }

  const queueVisitId = pharmacyEntry.visit_id;
  const activeClinicalBefore = await countActiveClinicalQueues(queueVisitId, transaction);
  const pharmacyWasOnlyStop = activeClinicalBefore <= 1;

  await queueService.completeEntry(
    pharmacyEntry.id,
    {
      pushed_by: userId,
      notes: 'Removed from pharmacy queue — medications out of stock',
    },
    transaction
  );

  const visit = await Visit.findByPk(queueVisitId, { transaction });
  const billingEntry = await queueService.findActiveEntryForVisit(
    queueVisitId,
    'billing',
    transaction
  );
  const activeClinicalAfter = await countActiveClinicalQueues(queueVisitId, transaction);

  return {
    prescription_id: prescriptionId,
    visit_id: queueVisitId,
    prescription_visit_id: prescription.visit_id,
    removed_from_pharmacy_queue: true,
    pharmacy_was_last_stop: pharmacyWasOnlyStop,
    visit_completed: visit?.status === 'completed',
    routed_to_billing: Boolean(billingEntry),
    hold_visit_open: visit?.status === 'in_progress' && activeClinicalAfter > 0,
    prescription: enriched,
  };
}

module.exports = {
  releaseOutOfStockFromPharmacyQueue,
  findPharmacyQueueEntryForPrescription,
};
