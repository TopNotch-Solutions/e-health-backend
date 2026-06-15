const { v4: uuidv4 } = require('uuid');
const { PharmacyInventory, StockTransaction, KitchenInventory, sequelize } = require('../models');
const { Op } = require('sequelize');
const { success, created, error, paginated } = require('../utils/response');
const notificationService = require('../services/notificationService');
const {
  getSupervisorMetrics,
  getRecentPrescriptions,
} = require('../services/pharmacySupervisorMetricsService');
const {
  findInventoryForMedication,
  findMedicationAvailabilityElsewhere,
  resolveStockStatus,
} = require('../services/pharmacyStockStatus');
const {
  listActiveCatalog,
  listCatalogForPrescribing,
  getCatalogEntryById,
  findCatalogByName,
} = require('../services/medicationCatalogService');

function assertFacilityInventoryItem(item, facilityId, res) {
  if (!item || item.facility_id !== facilityId) {
    return error(res, 'Item not found', 404);
  }
  return null;
}

function formatUserName(user) {
  if (!user) return null;
  return [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || null;
}

function serializeReceipt(tx) {
  const json = tx.toJSON ? tx.toJSON() : tx;
  return {
    ...json,
    recorded_by_name: formatUserName(json.performedBy),
    confirmed_by_name: formatUserName(json.confirmedBy),
    medication_name: json.inventory?.medication_name || null,
  };
}

const receiptInclude = [
  {
    model: PharmacyInventory,
    as: 'inventory',
    attributes: ['id', 'medication_name', 'generic_name', 'facility_id', 'quantity_in_stock'],
  },
  { association: 'performedBy', attributes: ['id', 'first_name', 'last_name'] },
  { association: 'confirmedBy', attributes: ['id', 'first_name', 'last_name'] },
];

async function createPendingReceipt({ inventoryId, quantity, userId, transaction }) {
  return StockTransaction.create({
    id: uuidv4(),
    inventory_id: inventoryId,
    type: 'received',
    quantity,
    status: 'pending',
    performed_by: userId,
  }, { transaction });
}

function maybeEmitLowStock(item) {
  if (item.quantity_in_stock <= item.reorder_level) {
    const payload = {
      medication_name: item.medication_name,
      quantity_remaining: item.quantity_in_stock,
      reorder_level: item.reorder_level,
      inventory_id: item.id,
    };
    notificationService.emitStockAlert(payload);
    notificationService.emitPharmacyInventoryUpdate({ type: 'low_stock', ...payload });
  }
}

// === PHARMACY INVENTORY ===

exports.checkMedicationStock = async (req, res) => {
  try {
    const { medication_name, quantity = 1 } = req.query;
    if (!medication_name || !String(medication_name).trim()) {
      return error(res, 'medication_name is required', 400);
    }

    const inv = await findInventoryForMedication(
      String(medication_name).trim(),
      req.user.facility_id
    );
    const status = resolveStockStatus({
      found: !!inv,
      quantityInStock: inv?.quantity_in_stock,
      reorderLevel: inv?.reorder_level,
      requiredQty: quantity,
    });

    const payload = {
      medication_name: String(medication_name).trim(),
      ...status,
    };

    if (status.stock_status === 'out_of_stock') {
      payload.availability_elsewhere = await findMedicationAvailabilityElsewhere(
        String(medication_name).trim(),
        req.user.facility_id,
        quantity
      );
    }

    return success(res, payload);
  } catch (err) {
    console.error('Check medication stock error:', err);
    return error(res, 'Failed to check stock', 500);
  }
};

exports.getMedicationCatalog = async (req, res) => {
  try {
    const facilityId = req.user.facility_id;
    const availableOnly = req.query.available === 'true' || req.query.available === '1';
    const catalog = availableOnly
      ? await listActiveCatalog({ facilityId, availableOnly: true })
      : await listCatalogForPrescribing(facilityId);
    return success(res, catalog);
  } catch (err) {
    console.error('Medication catalog error:', err);
    return error(res, 'Failed to load medication catalog', 500);
  }
};

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

exports.getSupervisorMetrics = async (req, res) => {
  try {
    const facilityId = req.user.facility_id;
    if (!facilityId) return error(res, 'Facility context required', 400);
    const metrics = await getSupervisorMetrics(facilityId);
    return success(res, metrics);
  } catch (err) {
    console.error('Pharmacy supervisor metrics error:', err);
    return error(res, 'Failed to fetch supervisor metrics', 500);
  }
};

exports.getRecentPrescriptions = async (req, res) => {
  try {
    const facilityId = req.user.facility_id;
    if (!facilityId) return error(res, 'Facility context required', 400);
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 50);
    const rows = await getRecentPrescriptions(facilityId, limit);
    return success(res, rows);
  } catch (err) {
    console.error('Recent prescriptions error:', err);
    return error(res, 'Failed to fetch prescriptions', 500);
  }
};

// Add new medication to inventory (from master catalog)
exports.addMedication = async (req, res) => {
  try {
    const {
      catalog_id,
      medication_name,
      quantity_in_stock,
      reorder_level,
      expiry_date,
    } = req.body;

    const facilityId = req.user.facility_id;
    let catalogEntry = null;
    if (catalog_id) {
      catalogEntry = await getCatalogEntryById(catalog_id);
    } else if (medication_name) {
      catalogEntry = await findCatalogByName(medication_name);
    }
    if (!catalogEntry) {
      return error(res, 'Select a medication from the catalog', 400);
    }

    const existing = await PharmacyInventory.findOne({
      where: {
        facility_id: facilityId,
        medication_name: catalogEntry.medication_name,
      },
    });
    if (existing) {
      return error(res, 'This medication is already in facility inventory', 409);
    }

    const qty = parseInt(quantity_in_stock, 10) || 0;
    const unitPrice = parseFloat(catalogEntry.unit_price) || 0;
    const item = await PharmacyInventory.create({
      id: uuidv4(),
      facility_id: facilityId,
      medication_name: catalogEntry.medication_name,
      generic_name: catalogEntry.generic_name,
      category: catalogEntry.category || null,
      quantity_in_stock: 0,
      reorder_level: reorder_level || 10,
      unit: 'units',
      expiry_date: expiry_date || null,
      unit_price: unitPrice,
    });

    let pendingReceipt = null;
    if (qty > 0) {
      pendingReceipt = await createPendingReceipt({
        inventoryId: item.id,
        quantity: qty,
        userId: req.user.id,
      });
    }
    maybeEmitLowStock(item);
    notificationService.emitPharmacyInventoryUpdate({
      type: 'medication_added',
      inventory_id: item.id,
      medication_name: item.medication_name,
      pending_quantity: qty,
    });

    const message = qty > 0
      ? 'Medication added — stock pending confirmation by another pharmacy supervisor'
      : 'Medication added to inventory';

    return created(res, { item, pendingReceipt }, message);
  } catch (err) {
    return error(res, 'Failed to add medication', 500);
  }
};

// Record incoming stock (pending until confirmed by a different staff member)
exports.receiveStock = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { quantity } = req.body;
    if (!quantity || quantity <= 0) return error(res, 'Valid quantity is required', 400);

    const item = await PharmacyInventory.findByPk(id, { transaction: t });
    if (!item) { if (!t.finished) await t.rollback(); return error(res, 'Item not found', 404); }
    if (item.facility_id !== req.user.facility_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'Item not found', 404);
    }

    const qty = parseInt(quantity, 10);
    const pendingReceipt = await createPendingReceipt({
      inventoryId: item.id,
      quantity: qty,
      userId: req.user.id,
      transaction: t,
    });

    await t.commit();

    const loaded = await StockTransaction.findByPk(pendingReceipt.id, { include: receiptInclude });

    notificationService.emitPharmacyInventoryUpdate({
      type: 'stock_receipt_pending',
      inventory_id: item.id,
      medication_name: item.medication_name,
      quantity: qty,
      transaction_id: pendingReceipt.id,
    });

    return created(
      res,
      serializeReceipt(loaded),
      'Receipt recorded — awaiting confirmation by another pharmacy supervisor'
    );
  } catch (err) {
    if (!t.finished) await t.rollback();
    return error(res, 'Failed to record stock receipt', 500);
  }
};

exports.getPendingReceipts = async (req, res) => {
  try {
    const facilityId = req.user.facility_id;
    const rows = await StockTransaction.findAll({
      where: { type: 'received', status: 'pending' },
      include: [
        {
          model: PharmacyInventory,
          as: 'inventory',
          where: { facility_id: facilityId },
          required: true,
        },
        { association: 'performedBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
      order: [['created_at', 'ASC']],
    });
    return success(res, rows.map(serializeReceipt));
  } catch (err) {
    return error(res, 'Failed to fetch pending receipts', 500);
  }
};

exports.getConfirmedReceipts = async (req, res) => {
  try {
    const facilityId = req.user.facility_id;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const rows = await StockTransaction.findAll({
      where: { type: 'received', status: 'confirmed' },
      include: [
        {
          model: PharmacyInventory,
          as: 'inventory',
          where: { facility_id: facilityId },
          required: true,
        },
        { association: 'performedBy', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'confirmedBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
      order: [['confirmed_at', 'DESC']],
      limit,
    });
    return success(res, rows.map(serializeReceipt));
  } catch (err) {
    return error(res, 'Failed to fetch confirmed receipts', 500);
  }
};

exports.confirmReceipt = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const tx = await StockTransaction.findByPk(req.params.transactionId, {
      include: [{ model: PharmacyInventory, as: 'inventory' }],
      transaction: t,
    });

    if (!tx || tx.type !== 'received' || tx.status !== 'pending') {
      if (!t.finished) await t.rollback();
      return error(res, 'Pending receipt not found', 404);
    }
    if (!tx.inventory || tx.inventory.facility_id !== req.user.facility_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'Pending receipt not found', 404);
    }
    if (tx.performed_by === req.user.id) {
      if (!t.finished) await t.rollback();
      return error(
        res,
        'You cannot confirm a receipt you recorded. Another pharmacy supervisor must confirm.',
        403
      );
    }

    await tx.inventory.update(
      { quantity_in_stock: tx.inventory.quantity_in_stock + tx.quantity },
      { transaction: t }
    );

    const confirmedAt = new Date();
    await tx.update(
      {
        status: 'confirmed',
        confirmed_by: req.user.id,
        confirmed_at: confirmedAt,
      },
      { transaction: t }
    );

    await t.commit();

    const loaded = await StockTransaction.findByPk(tx.id, { include: receiptInclude });
    await tx.inventory.reload();
    maybeEmitLowStock(tx.inventory);

    notificationService.emitPharmacyInventoryUpdate({
      type: 'stock_receipt_confirmed',
      inventory_id: tx.inventory.id,
      medication_name: tx.inventory.medication_name,
      quantity: tx.quantity,
      transaction_id: tx.id,
    });

    return success(res, serializeReceipt(loaded), 'Stock receipt confirmed');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Confirm receipt error:', err);
    return error(res, 'Failed to confirm receipt', 500);
  }
};

// Update medication details
exports.updateMedication = async (req, res) => {
  try {
    const item = await PharmacyInventory.findByPk(req.params.id);
    const denied = assertFacilityInventoryItem(item, req.user.facility_id, res);
    if (denied) return denied;

    const allowed = [
      'medication_name',
      'generic_name',
      'category',
      'reorder_level',
      'unit',
      'expiry_date',
      'unit_price',
    ];
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
      include: [
        { association: 'performedBy', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'confirmedBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
      order: [['created_at', 'DESC']],
      limit: 50,
    });
    return success(res, transactions.map(serializeReceipt));
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
    if (!item) { if (!t.finished) await t.rollback(); return error(res, 'Item not found', 404); }
    if (item.facility_id !== req.user.facility_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'Item not found', 404);
    }

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
    await item.reload();
    maybeEmitLowStock(item);
    notificationService.emitPharmacyInventoryUpdate({
      type: 'stock_adjusted',
      inventory_id: item.id,
      medication_name: item.medication_name,
    });
    return success(res, item, 'Stock adjusted');
  } catch (err) {
    if (!t.finished) await t.rollback();
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
