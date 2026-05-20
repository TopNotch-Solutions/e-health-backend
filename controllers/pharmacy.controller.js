const { v4: uuidv4 } = require('uuid');
const {
  Prescription, PrescriptionItem, Visit, Patient, PharmacyInventory,
  StockTransaction, Referral, QueueEntry, sequelize,
} = require('../models');
const { Op } = require('sequelize');
const { success, created, error } = require('../utils/response');
const notificationService = require('../services/notificationService');
const stockAlertService = require('../services/stockAlertService');

// Get pharmacy queue (pending prescriptions)
exports.getQueue = async (req, res) => {
  try {
    const prescriptions = await Prescription.findAll({
      where: { status: { [Op.in]: ['pending', 'partially_dispensed'] } },
      include: [
        {
          association: 'visit',
          where: { facility_id: req.user.facility_id },
          include: [{ model: Patient, as: 'patient', attributes: ['id', 'first_name', 'last_name', 'patient_number'] }],
        },
        { association: 'items' },
        { association: 'prescribedBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
      order: [['created_at', 'ASC']],
    });

    return success(res, prescriptions);
  } catch (err) {
    console.error('Get pharmacy queue error:', err);
    return error(res, 'Failed to fetch pharmacy queue', 500);
  }
};

// Get single prescription with all items
exports.getPrescription = async (req, res) => {
  try {
    const prescription = await Prescription.findByPk(req.params.id, {
      include: [
        { association: 'items' },
        {
          association: 'visit',
          include: [{ model: Patient, as: 'patient' }],
        },
        { association: 'prescribedBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
    });

    if (!prescription) return error(res, 'Prescription not found', 404);
    return success(res, prescription);
  } catch (err) {
    return error(res, 'Failed to fetch prescription', 500);
  }
};

// Dispense medications (checkbox logic)
exports.dispense = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params; // prescription_id
    const { dispensed_items } = req.body; // array of { item_id, is_dispensed }

    if (!dispensed_items || !dispensed_items.length) {
      return error(res, 'dispensed_items array is required', 400);
    }

    const prescription = await Prescription.findByPk(id, {
      include: [{ association: 'items' }],
      transaction: t,
    });
    if (!prescription) {
      await t.rollback();
      return error(res, 'Prescription not found', 404);
    }

    let dispensedCount = 0;

    for (const dispenseInfo of dispensed_items) {
      const item = prescription.items.find(i => i.id === dispenseInfo.item_id);
      if (!item) continue;
      // Already fully handled (given or recorded as not given)
      if (item.dispensed_at) continue;

      if (dispenseInfo.is_dispensed) {
        // Available and given to patient — deduct stock
        await PrescriptionItem.update({
          is_dispensed: true,
          is_available: true,
          dispensed_by: req.user.id,
          dispensed_at: new Date(),
        }, { where: { id: item.id }, transaction: t });

        // Find and deduct from inventory
        const stockItem = await PharmacyInventory.findOne({
          where: {
            medication_name: item.medication_name,
            facility_id: req.user.facility_id,
          },
          transaction: t,
        });

        if (stockItem) {
          const newQty = Math.max(0, stockItem.quantity_in_stock - item.quantity);
          await stockItem.update({ quantity_in_stock: newQty }, { transaction: t });

          // Record stock transaction
          await StockTransaction.create({
            id: uuidv4(),
            inventory_id: stockItem.id,
            type: 'dispensed',
            quantity: item.quantity,
            reference_id: item.id,
            performed_by: req.user.id,
          }, { transaction: t });

          // Emit stock alert if now low
          if (newQty <= stockItem.reorder_level) {
            notificationService.emitStockAlert({
              medication_name: stockItem.medication_name,
              quantity_remaining: newQty,
              reorder_level: stockItem.reorder_level,
            });
          }
        }

        dispensedCount++;
      } else {
        // Not available / not given — pharmacist reviewed, no stock handed out
        await PrescriptionItem.update({
          is_available: false,
          is_dispensed: false,
          dispensed_by: req.user.id,
          dispensed_at: new Date(),
        }, { where: { id: item.id }, transaction: t });
      }
    }

    // Derive status from persisted line items (supports multi-step dispensing)
    const freshItems = await PrescriptionItem.findAll({
      where: { prescription_id: id },
      transaction: t,
    });
    const n = freshItems.length;
    const dispensedTotal = freshItems.filter((i) => i.is_dispensed).length;
    const reviewedTotal = freshItems.filter((i) => i.dispensed_at).length;

    let newStatus;
    if (n === 0) {
      newStatus = prescription.status;
    } else if (reviewedTotal < n) {
      newStatus = dispensedTotal > 0 ? 'partially_dispensed' : 'pending';
    } else if (dispensedTotal === n) {
      newStatus = 'dispensed';
    } else if (dispensedTotal === 0) {
      newStatus = 'unavailable';
    } else {
      newStatus = 'partially_dispensed';
    }

    await prescription.update({ status: newStatus }, { transaction: t });

    await t.commit();

    return success(res, {
      prescription_id: id,
      status: newStatus,
      dispensed: dispensedTotal,
      unavailable: freshItems.filter((i) => !i.is_available && !i.is_dispensed).length,
      applied_in_request: dispensedCount,
    }, 'Medications dispensed');
  } catch (err) {
    await t.rollback();
    console.error('Dispense error:', err);
    return error(res, 'Failed to dispense medications', 500);
  }
};

// Generate referral for unavailable medications
exports.generateReferral = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params; // prescription_id
    const { reason, follow_up_date } = req.body;

    const prescription = await Prescription.findByPk(id, {
      include: [
        { association: 'items', where: { is_available: false } },
        { association: 'visit', include: [{ model: Patient, as: 'patient' }] },
      ],
      transaction: t,
    });

    if (!prescription) {
      await t.rollback();
      return error(res, 'Prescription not found or no unavailable items', 404);
    }

    // Mark prescription as having referral
    await prescription.update({ referral_generated: true }, { transaction: t });

    // Create referral record
    const referral = await Referral.create({
      id: uuidv4(),
      visit_id: prescription.visit_id,
      referred_by: req.user.id,
      referral_type: 'pharmacy_unavailable',
      reason: reason || `Medications unavailable: ${prescription.items.map(i => i.medication_name).join(', ')}`,
      status: 'pending',
      follow_up_date: follow_up_date || null,
    }, { transaction: t });

    // Mark patient as returning
    await Patient.update(
      { category: 'returning' },
      { where: { id: prescription.visit.patient_id }, transaction: t }
    );

    await t.commit();

    return created(res, { referral, unavailable_medications: prescription.items.map(i => i.medication_name) }, 'Referral generated - patient marked as returning');
  } catch (err) {
    await t.rollback();
    console.error('Generate referral error:', err);
    return error(res, 'Failed to generate referral', 500);
  }
};
