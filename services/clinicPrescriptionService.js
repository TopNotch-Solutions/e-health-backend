const { v4: uuidv4 } = require('uuid');
const { Visit, Patient, Prescription, PrescriptionItem, PharmacyInventory } = require('../models');
const queueService = require('./queueService');
const billingChargeService = require('./billingChargeService');
const { resolveStockStatus } = require('./pharmacyStockStatus');

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

  return { prescription, prescriptionItems, lowStockAlerts, lowStockNote };
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

  const { prescription, lowStockAlerts, lowStockNote } = await createPrescriptionWithItems({
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

  return { prescription, pharmacyEntry, lowStockAlerts, lowStockNote };
}

module.exports = {
  createPrescriptionWithItems,
  pushPrescriptionToPharmacy,
};
