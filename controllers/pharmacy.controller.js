const { v4: uuidv4 } = require('uuid');
const {
  Prescription, PrescriptionItem, Visit, Patient, Facility, PharmacyInventory,
  StockTransaction, Referral, QueueEntry, sequelize,
} = require('../models');
const { Op } = require('sequelize');
const { success, created, error } = require('../utils/response');
const notificationService = require('../services/notificationService');
const {
  enrichPrescription,
  findInventoryForMedication,
  resolveStockStatus,
} = require('../services/pharmacyStockStatus');
const billingChargeService = require('../services/billingChargeService');
const queueService = require('../services/queueService');
const { findOpenPrescriptionsForPharmacyQueue } = require('../services/pharmacyQueueService');
const {
  releaseOutOfStockFromPharmacyQueue,
  findPharmacyQueueEntryForPrescription,
} = require('../services/pharmacyOutOfStockReleaseService');

// Get pharmacy queue (pending prescriptions)
exports.getQueue = async (req, res) => {
  try {
    const prescriptions = await findOpenPrescriptionsForPharmacyQueue(req.user.facility_id);

    const enriched = await Promise.all(
      prescriptions.map((rx) => enrichPrescription(rx, req.user.facility_id))
    );

    return success(res, enriched);
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
          include: [
            { model: Patient, as: 'patient' },
            { model: Facility, as: 'facility', attributes: ['id', 'name', 'type'] },
          ],
        },
        { association: 'prescribedBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
    });

    if (!prescription) return error(res, 'Prescription not found', 404);

    const enriched = await enrichPrescription(prescription, req.user.facility_id);
    return success(res, enriched);
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
      include: [{ association: 'items' }, { association: 'visit' }],
      transaction: t,
    });
    if (!prescription) {
      if (!t.finished) await t.rollback();
      return error(res, 'Prescription not found', 404);
    }

    let dispensedCount = 0;
    let anyPendingCouldDispense = false;

    for (const dispenseInfo of dispensed_items) {
      const item = prescription.items.find(i => i.id === dispenseInfo.item_id);
      if (!item) continue;
      // Already fully handled (given or recorded as not given)
      if (item.dispensed_at) continue;

      const stockItem = await findInventoryForMedication(
        item.medication_name,
        req.user.facility_id,
        t
      );
      const liveStock = resolveStockStatus({
        found: !!stockItem,
        quantityInStock: stockItem?.quantity_in_stock,
        reorderLevel: stockItem?.reorder_level,
        requiredQty: item.quantity,
      });

      if (liveStock.can_dispense) {
        anyPendingCouldDispense = true;
      }

      if (dispenseInfo.is_dispensed) {
        if (!liveStock.can_dispense) {
          if (!t.finished) await t.rollback();
          return error(
            res,
            `${item.medication_name} is out of stock (${liveStock.quantity_in_stock} available, ${item.quantity} required)`,
            400
          );
        }

        // Available and given to patient — deduct stock
        await PrescriptionItem.update({
          is_dispensed: true,
          is_available: true,
          dispensed_by: req.user.id,
          dispensed_at: new Date(),
        }, { where: { id: item.id }, transaction: t });

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

        await billingChargeService.chargeDispensedItem(
          prescription.visit_id,
          item,
          req.user.facility_id,
          t
        );

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

    if (dispensedCount === 0 && !anyPendingCouldDispense) {
      if (!t.finished) await t.rollback();
      return error(
        res,
        'Cannot dispense — all medications are out of stock. Replenish stock before dispensing.',
        400
      );
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

    let pharmacyEntryToComplete = null;
    if (reviewedTotal === n && n > 0) {
      pharmacyEntryToComplete = await findPharmacyQueueEntryForPrescription(
        prescription,
        req.user.facility_id,
        t
      );
    }

    if (pharmacyEntryToComplete) {
      await queueService.completeEntry(
        pharmacyEntryToComplete.id,
        { pushed_by: req.user.id, notes: 'Pharmacy dispensing complete' },
        t
      );
    }

    await t.commit();

    try {
      notificationService.emitBillingCharge({
        facility_id: req.user.facility_id,
        visit_id: prescription.visit_id,
        prescription_id: id,
        reason: 'medications_dispensed',
      });
    } catch (emitErr) {
      console.error('Billing emit after dispense:', emitErr.message);
    }

    const prescriptionOut = await Prescription.findByPk(id, {
      include: [{ association: 'items' }],
    });
    const enriched = await enrichPrescription(prescriptionOut, req.user.facility_id);

    return success(res, {
      prescription_id: id,
      status: newStatus,
      dispensed: dispensedTotal,
      unavailable: freshItems.filter((i) => !i.is_available && !i.is_dispensed).length,
      applied_in_request: dispensedCount,
      prescription: enriched,
    }, 'Medications dispensed');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Dispense error:', err);
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Failed to dispense medications';
    return error(res, message, statusCode);
  }
};

// Remove patient from pharmacy queue when all pending medications are out of stock.
exports.releaseOutOfStock = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const result = await releaseOutOfStockFromPharmacyQueue({
      prescriptionId: req.params.id,
      facilityId: req.user.facility_id,
      userId: req.user.id,
      transaction: t,
    });

    await t.commit();

    let message = 'Patient removed from pharmacy queue.';
    if (result.visit_completed) {
      message = 'Patient removed from pharmacy queue. Consultation completed.';
    } else if (result.routed_to_billing) {
      message = 'Patient removed from pharmacy queue and sent to billing.';
    } else if (result.hold_visit_open) {
      message = 'Patient removed from pharmacy queue. Visit continues at other departments.';
    }

    return success(res, result, message);
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Release out-of-stock error:', err);
    const statusCode = err.statusCode || 500;
    return error(res, err.message || 'Failed to release patient from pharmacy queue', statusCode);
  }
};

// Stop a recurring medication schedule (patient is better / no longer needed)
exports.stopRecurringSchedule = async (req, res) => {
  try {
    const item = await PrescriptionItem.findByPk(req.params.itemId);
    if (!item) return error(res, 'Prescription item not found', 404);

    if (item.schedule_type === 'once_off') {
      return error(res, 'This medication is not on a recurring schedule', 400);
    }
    if (!item.schedule_active) {
      return error(res, 'Recurring schedule is already stopped', 400);
    }

    await item.update({
      schedule_active: false,
      schedule_stopped_at: new Date(),
      schedule_stopped_by: req.user.id,
    });

    const { formatScheduleLabel } = require('../services/prescriptionScheduleService');
    const plain = item.toJSON();
    return success(res, {
      item_id: item.id,
      schedule_active: false,
      schedule_label: formatScheduleLabel(plain),
    }, 'Recurring schedule stopped');
  } catch (err) {
    console.error('Stop recurring schedule error:', err);
    return error(res, 'Failed to stop recurring schedule', 500);
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
      if (!t.finished) await t.rollback();
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
    if (!t.finished) await t.rollback();
    console.error('Generate referral error:', err);
    return error(res, 'Failed to generate referral', 500);
  }
};
