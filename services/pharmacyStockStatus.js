const { PharmacyInventory, Facility } = require('../models');
const { Op } = require('sequelize');

/**
 * Classify live pharmacy stock for a prescription line.
 * - out_of_stock: not in inventory, zero on hand, or less than prescribed quantity
 * - low_stock: enough to fill this order but at/below reorder level
 * - in_stock: sufficient quantity above reorder level
 */
function resolveStockStatus({ found, quantityInStock, reorderLevel, requiredQty }) {
  const qty = Number(quantityInStock) || 0;
  const need = Math.max(1, Number(requiredQty) || 1);
  const reorder = Number(reorderLevel) || 0;

  if (!found || qty === 0 || qty < need) {
    return {
      stock_status: 'out_of_stock',
      stock_label: 'Out of stock',
      can_dispense: false,
      quantity_in_stock: qty,
      reorder_level: reorder,
      required_quantity: need,
    };
  }

  if (qty <= reorder) {
    return {
      stock_status: 'low_stock',
      stock_label: 'Low stock',
      can_dispense: true,
      quantity_in_stock: qty,
      reorder_level: reorder,
      required_quantity: need,
    };
  }

  return {
    stock_status: 'in_stock',
    stock_label: 'In stock',
    can_dispense: true,
    quantity_in_stock: qty,
    reorder_level: reorder,
    required_quantity: need,
  };
}

/** True when every line on the prescription is out of stock at the facility. */
function allPrescriptionItemsOutOfStock(itemCount, lowStockAlerts) {
  if (!itemCount) return false;
  const outCount = (lowStockAlerts || []).filter((a) => a.stock_status === 'out_of_stock').length;
  return outCount === itemCount;
}

async function findInventoryForMedication(medicationName, facilityId, transaction) {
  return PharmacyInventory.findOne({
    where: {
      medication_name: medicationName,
      facility_id: facilityId,
    },
    transaction,
  });
}

async function findMedicationAvailabilityElsewhere(
  medicationName,
  facilityId,
  requiredQty = 1,
  transaction = null
) {
  const need = Math.max(1, Number(requiredQty) || 1);
  const rows = await PharmacyInventory.findAll({
    where: {
      medication_name: medicationName,
      facility_id: { [Op.ne]: facilityId },
      quantity_in_stock: { [Op.gte]: need },
    },
    include: [{
      model: Facility,
      as: 'facility',
      attributes: ['id', 'name', 'province', 'district', 'type'],
    }],
    order: [['quantity_in_stock', 'DESC']],
    transaction,
  });

  const typeOrder = { hospital: 0, clinic: 1, health_center: 2 };

  return rows.map((row) => {
    const plain = row.toJSON ? row.toJSON() : row;
    const location = [plain.facility?.district, plain.facility?.province].filter(Boolean).join(', ');
    return {
      facility_id: plain.facility_id,
      facility_name: plain.facility?.name || 'Another facility',
      facility_type: plain.facility?.type || null,
      location: location || null,
      quantity_in_stock: plain.quantity_in_stock,
    };
  }).sort((a, b) => {
    const typeDiff = (typeOrder[a.facility_type] ?? 9) - (typeOrder[b.facility_type] ?? 9);
    if (typeDiff !== 0) return typeDiff;
    return a.facility_name.localeCompare(b.facility_name);
  });
}

async function enrichItemsWithStock(items, facilityId, transaction) {
  if (!items?.length) return [];

  const names = [...new Set(items.map((i) => i.medication_name).filter(Boolean))];
  const inventoryRows = names.length
    ? await PharmacyInventory.findAll({
        where: {
          facility_id: facilityId,
          medication_name: { [Op.in]: names },
        },
        transaction,
      })
    : [];

  const byExactName = new Map(inventoryRows.map((row) => [row.medication_name, row]));

  const enriched = items.map((item) => {
    const plain = item.toJSON ? item.toJSON() : { ...item };
    const inv = byExactName.get(plain.medication_name);
    const live = resolveStockStatus({
      found: !!inv,
      quantityInStock: inv?.quantity_in_stock,
      reorderLevel: inv?.reorder_level,
      requiredQty: plain.quantity,
    });

    return { ...plain, ...live };
  });

  await Promise.all(enriched.map(async (item) => {
    if (item.stock_status === 'out_of_stock') {
      item.availability_elsewhere = await findMedicationAvailabilityElsewhere(
        item.medication_name,
        facilityId,
        item.quantity,
        transaction
      );
    } else {
      item.availability_elsewhere = [];
    }
  }));

  return enriched;
}

async function enrichPrescription(prescription, facilityId, transaction) {
  const plain = prescription.toJSON ? prescription.toJSON() : { ...prescription };
  plain.items = await enrichItemsWithStock(plain.items || [], facilityId, transaction);
  const { formatScheduleLabel } = require('./prescriptionScheduleService');
  plain.items = plain.items.map((item) => ({
    ...item,
    schedule_label: formatScheduleLabel(item),
  }));
  const prescribedAtFacilityId = plain.visit?.facility_id || plain.visit?.facility?.id;
  plain.is_cross_facility = Boolean(
    prescribedAtFacilityId && facilityId && prescribedAtFacilityId !== facilityId
  );
  plain.prescribed_at_facility = plain.visit?.facility?.name || null;
  return plain;
}

module.exports = {
  resolveStockStatus,
  findInventoryForMedication,
  findMedicationAvailabilityElsewhere,
  enrichItemsWithStock,
  enrichPrescription,
  allPrescriptionItemsOutOfStock,
};
