const { PharmacyInventory } = require('../models');
const { Op } = require('sequelize');

/**
 * Check stock level for a medication at a facility.
 * Returns { available: boolean, quantity: number, reorder_level: number }
 */
async function checkStock(medicationName, facilityId) {
  const item = await PharmacyInventory.findOne({
    where: {
      medication_name: { [Op.like]: `%${medicationName}%` },
      facility_id: facilityId,
    },
  });

  if (!item) {
    return { available: false, quantity: 0, reorder_level: 0, found: false };
  }

  return {
    available: item.quantity_in_stock > 0,
    quantity: item.quantity_in_stock,
    reorder_level: item.reorder_level,
    found: true,
    isLow: item.quantity_in_stock <= item.reorder_level,
    inventory_id: item.id,
  };
}

/**
 * Get all low-stock medications at a facility.
 */
async function getLowStockAlerts(facilityId) {
  const items = await PharmacyInventory.findAll({
    where: {
      facility_id: facilityId,
      quantity_in_stock: { [Op.lte]: sequelize.col('reorder_level') },
    },
  });

  return items.map((item) => ({
    id: item.id,
    medication_name: item.medication_name,
    quantity_in_stock: item.quantity_in_stock,
    reorder_level: item.reorder_level,
  }));
}

/**
 * Deduct stock after dispensing.
 */
async function deductStock(inventoryId, quantity, transaction = null) {
  const item = await PharmacyInventory.findByPk(inventoryId, { transaction });
  if (!item) throw new Error('Inventory item not found');

  const newQty = Math.max(0, item.quantity_in_stock - quantity);
  await item.update({ quantity_in_stock: newQty }, { transaction });

  return { inventory_id: inventoryId, new_quantity: newQty, isLow: newQty <= item.reorder_level };
}

module.exports = { checkStock, getLowStockAlerts, deductStock };
