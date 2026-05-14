const { v4: uuidv4 } = require('uuid');
const { PharmacyInventory, StockTransaction, KitchenInventory, sequelize } = require('../models');
const { Op } = require('sequelize');
const { success, created, error, paginated } = require('../utils/response');
const notificationService = require('../services/notificationService');

// === PHARMACY INVENTORY ===

// Get all pharmacy inventory
exports.getPharmacyInventory = async (req, res) => {
  try {
    const { page = 1, limit = 50, search, category } = req.query;
    const offset = (page - 1) * limit;
    const where = { facility_id: req.user.facility_id };

    if (search) {
      where[Op.or] = [
        { medication_name: { [Op.like]: `%${search}%` } },
        { generic_name: { [Op.like]: `%${search}%` } },
      ];
    }
    if (category) where.category = category;

    const { rows, count } = await PharmacyInventory.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['medication_name', 'ASC']],
    });

    return paginated(res, rows, count, page, limit);
  } catch (err) {
    return error(res, 'Failed to fetch inventory', 500);
  }
};

// Get low stock alerts
exports.getAlerts = async (req, res) => {
  try {
    const items = await PharmacyInventory.findAll({
      where: {
        facility_id: req.user.facility_id,
        [Op.and]: [
          sequelize.where(
            sequelize.col('quantity_in_stock'),
            Op.lte,
            sequelize.col('reorder_level')
          ),
        ],
      },
      order: [['quantity_in_stock', 'ASC']],
    });

    return success(res, items);
  } catch (err) {
    return error(res, 'Failed to fetch alerts', 500);
  }
};

// Add new medication to inventory
exports.addMedication = async (req, res) => {
  try {
    const { medication_name, generic_name, category, quantity_in_stock, reorder_level, unit, expiry_date } = req.body;
    if (!medication_name) return error(res, 'medication_name is required', 400);

    const item = await PharmacyInventory.create({
      id: uuidv4(),
      facility_id: req.user.facility_id,
      medication_name,
      generic_name: generic_name || null,
      category: category || null,
      quantity_in_stock: quantity_in_stock || 0,
      reorder_level: reorder_level || 10,
      unit: unit || 'units',
      expiry_date: expiry_date || null,
    });

    return created(res, item, 'Medication added to inventory');
  } catch (err) {
    return error(res, 'Failed to add medication', 500);
  }
};

// Receive stock (increase quantity)
exports.receiveStock = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { quantity, notes } = req.body;
    if (!quantity || quantity <= 0) return error(res, 'Valid quantity is required', 400);

    const item = await PharmacyInventory.findByPk(id, { transaction: t });
    if (!item) { await t.rollback(); return error(res, 'Item not found', 404); }

    await item.update({
      quantity_in_stock: item.quantity_in_stock + parseInt(quantity),
    }, { transaction: t });

    await StockTransaction.create({
      id: uuidv4(),
      inventory_id: item.id,
      type: 'received',
      quantity: parseInt(quantity),
      performed_by: req.user.id,
    }, { transaction: t });

    await t.commit();
    return success(res, item, 'Stock received');
  } catch (err) {
    await t.rollback();
    return error(res, 'Failed to receive stock', 500);
  }
};

// Update medication details
exports.updateMedication = async (req, res) => {
  try {
    const item = await PharmacyInventory.findByPk(req.params.id);
    if (!item) return error(res, 'Item not found', 404);

    const allowed = ['medication_name', 'generic_name', 'category', 'reorder_level', 'unit', 'expiry_date'];
    const updates = {};
    for (const f of allowed) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }

    await item.update(updates);
    return success(res, item, 'Medication updated');
  } catch (err) {
    return error(res, 'Failed to update medication', 500);
  }
};

// Get stock transactions for an item
exports.getTransactions = async (req, res) => {
  try {
    const transactions = await StockTransaction.findAll({
      where: { inventory_id: req.params.id },
      include: [{ association: 'performedBy', attributes: ['id', 'first_name', 'last_name'] }],
      order: [['created_at', 'DESC']],
      limit: 50,
    });
    return success(res, transactions);
  } catch (err) {
    return error(res, 'Failed to fetch transactions', 500);
  }
};

// Adjust stock (for corrections, expired items)
exports.adjustStock = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { quantity, type, notes } = req.body; // type: 'expired' or 'adjustment'
    if (!quantity || !type) return error(res, 'quantity and type are required', 400);

    const item = await PharmacyInventory.findByPk(id, { transaction: t });
    if (!item) { await t.rollback(); return error(res, 'Item not found', 404); }

    const newQty = type === 'expired'
      ? Math.max(0, item.quantity_in_stock - parseInt(quantity))
      : parseInt(quantity); // adjustment sets absolute value

    await item.update({ quantity_in_stock: newQty }, { transaction: t });

    await StockTransaction.create({
      id: uuidv4(),
      inventory_id: item.id,
      type,
      quantity: parseInt(quantity),
      performed_by: req.user.id,
    }, { transaction: t });

    await t.commit();
    return success(res, item, 'Stock adjusted');
  } catch (err) {
    await t.rollback();
    return error(res, 'Failed to adjust stock', 500);
  }
};

// === KITCHEN INVENTORY ===

exports.getKitchenInventory = async (req, res) => {
  try {
    const items = await KitchenInventory.findAll({
      where: { facility_id: req.user.facility_id },
      order: [['item_name', 'ASC']],
    });
    return success(res, items);
  } catch (err) {
    return error(res, 'Failed to fetch kitchen inventory', 500);
  }
};

exports.addKitchenItem = async (req, res) => {
  try {
    const { item_name, category, quantity, unit, reorder_level } = req.body;
    if (!item_name) return error(res, 'item_name is required', 400);

    const item = await KitchenInventory.create({
      id: uuidv4(),
      facility_id: req.user.facility_id,
      item_name,
      category: category || null,
      quantity: quantity || 0,
      unit: unit || 'units',
      reorder_level: reorder_level || 0,
    });

    return created(res, item, 'Kitchen item added');
  } catch (err) {
    return error(res, 'Failed to add kitchen item', 500);
  }
};

exports.updateKitchenItem = async (req, res) => {
  try {
    const item = await KitchenInventory.findByPk(req.params.id);
    if (!item) return error(res, 'Item not found', 404);

    const allowed = ['item_name', 'category', 'quantity', 'unit', 'reorder_level'];
    const updates = {};
    for (const f of allowed) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }

    await item.update(updates);
    return success(res, item, 'Kitchen item updated');
  } catch (err) {
    return error(res, 'Failed to update kitchen item', 500);
  }
};
