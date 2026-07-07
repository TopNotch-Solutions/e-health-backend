const { v4: uuidv4 } = require('uuid');
const { Visit, Patient, Prescription, PrescriptionItem, PharmacyInventory } = require('../models');
const queueService = require('./queueService');
const billingChargeService = require('./billingChargeService');
const clinicBillingService = require('./clinicBillingService');
const { resolveStockStatus, allPrescriptionItemsOutOfStock } = require('./pharmacyStockStatus');
const { validateScheduleFields, formatScheduleLabel } = require('./prescriptionScheduleService');

const PHARMACY_SKIP_NOTE = 'All medications out of stock — pharmacy skipped';

/**
 * End visit or route to billing when pharmacy was skipped and there are no more clinical stops.
 * Safe to call after completeEntry (which may already have attempted this).
 */
async function applyVisitEndAfterSkippedPharmacy({
  visitId,
  facilityId,
  userId,
  transaction,
  notes = 'Consultation complete — pharmacy skipped (out of stock)',
}) {
  return clinicBillingService.applyVisitEndState({
    visitId,
    facilityId,
    userId,
    transaction,
    notes,
  });
}

function buildSkippedPharmacyApiFields(visitEnd) {
  return {
    visitCompleted: Boolean(visitEnd?.visitCompleted),
    routedToBilling: Boolean(visitEnd?.routedToBilling),
    billingQueueEntry: visitEnd?.queueEntry || null,
  };
}

function skippedPharmacyResponseMessage(visitEnd) {
  if (visitEnd?.routedToBilling) {
    return 'Prescription recorded — pharmacy skipped; patient sent to billing';
  }
  if (visitEnd?.visitCompleted) {
    return 'Prescription recorded — pharmacy skipped; consultation completed';
  }
  return 'Prescription recorded — pharmacy skipped (all medications out of stock)';
}

async function createPrescriptionWithItems({
  visit_id,
  consultation_id,
  items,
  prescribed_by,
  facility_id,
  transaction,
}) {
  const prescription = await Prescription.create(
    {
      id: uuidv4(),
      consultation_id,
      visit_id,
      prescribed_by,
    },
    { transaction }
  );

  const lowStockAlerts = [];
  const prescriptionItems = [];

  for (const item of items) {
    const stockItem = await PharmacyInventory.findOne({
      where: {
        medication_name: item.medication_name,
        facility_id,
      },
      transaction,
    });

    const stockLevel = stockItem ? stockItem.quantity_in_stock : 0;
    const stock = resolveStockStatus({
      found: !!stockItem,
      quantityInStock: stockLevel,
      reorderLevel: stockItem?.reorder_level,
      requiredQty: item.quantity || 1,
    });

    const schedule = validateScheduleFields(item, { medicationName: item.medication_name });

    const prescItem = await PrescriptionItem.create(
      {
        id: uuidv4(),
        prescription_id: prescription.id,
        medication_name: item.medication_name,
        dosage: item.dosage || null,
        quantity: item.quantity || 1,
        frequency: item.frequency || null,
        duration: item.duration || null,
        instructions: item.instructions || null,
        stock_at_prescribe: stockLevel,
        is_available: stock.can_dispense,
        ...schedule,
      },
      { transaction }
    );

    prescriptionItems.push(prescItem);

    if (stock.stock_status === 'out_of_stock') {
      lowStockAlerts.push({
        medication_name: item.medication_name,
        stock_status: stock.stock_status,
      });
    }
  }

  const lowStockNote = lowStockAlerts.length
    ? `Low stock: ${lowStockAlerts.map((a) => a.medication_name).join(', ')}`
    : null;

  const allOutOfStock = allPrescriptionItemsOutOfStock(prescriptionItems.length, lowStockAlerts);

  return { prescription, prescriptionItems, lowStockAlerts, lowStockNote, allOutOfStock };
}

async function pushPrescriptionToPharmacy({
  visit_id,
  consultation_id,
  items,
  user,
  transaction,
}) {
  if (!items?.length) {
    return { prescription: null, pharmacyEntry: null, lowStockAlerts: [] };
  }

  const visit = await Visit.findByPk(visit_id, {
    include: [{ model: Patient, as: 'patient', attributes: ['is_emergency'] }],
    transaction,
  });
  const priority = visit?.patient?.is_emergency || visit?.visit_type === 'emergency'
    ? 'emergency'
    : 'normal';

  const { prescription, lowStockAlerts, lowStockNote, allOutOfStock } = await createPrescriptionWithItems({
    visit_id,
    consultation_id,
    items,
    prescribed_by: user.id,
    facility_id: user.facility_id,
    transaction,
  });

  await billingChargeService.chargeConsultationFee(
    visit_id,
    consultation_id,
    user.facility_id,
    transaction
  );

  if (allOutOfStock) {
    return {
      prescription,
      pharmacyEntry: null,
      lowStockAlerts,
      lowStockNote,
      skippedPharmacy: true,
    };
  }

  const pharmacyEntry = await queueService.pushToQueue(
    {
      visit_id,
      department: 'pharmacy',
      priority,
      pushed_by: user.id,
      notes: lowStockNote,
    },
    transaction
  );

  return { prescription, pharmacyEntry, lowStockAlerts, lowStockNote, skippedPharmacy: false };
}

module.exports = {
  createPrescriptionWithItems,
  pushPrescriptionToPharmacy,
  formatScheduleLabel,
  PHARMACY_SKIP_NOTE,
  applyVisitEndAfterSkippedPharmacy,
  buildSkippedPharmacyApiFields,
  skippedPharmacyResponseMessage,
};
