const { v4: uuidv4 } = require('uuid');
const { Bill, BillItem, Visit, Patient, Prescription, PrescriptionItem, LabRequest, SonarRequest, Admission, sequelize } = require('../models');
const { Op } = require('sequelize');
const { success, created, error, paginated } = require('../utils/response');

// Get billing queue (private patients pending payment)
exports.getQueue = async (req, res) => {
  try {
    const bills = await Bill.findAll({
      where: { status: { [Op.in]: ['accumulating', 'pending_payment'] } },
      include: [
        {
          model: Patient, as: 'patient',
          where: { payment_type: 'private' },
          attributes: ['id', 'first_name', 'last_name', 'patient_number', 'phone'],
        },
        {
          model: Visit, as: 'visit',
          where: { facility_id: req.user.facility_id },
          attributes: ['id', 'visit_number', 'status'],
        },
        { association: 'items' },
      ],
      order: [['created_at', 'ASC']],
    });

    return success(res, bills);
  } catch (err) {
    console.error('Get billing queue error:', err);
    return error(res, 'Failed to fetch billing queue', 500);
  }
};

// Get bill for a visit
exports.getBillByVisit = async (req, res) => {
  try {
    const bill = await Bill.findOne({
      where: { visit_id: req.params.visitId },
      include: [
        { association: 'items', order: [['created_at', 'ASC']] },
        { model: Patient, as: 'patient', attributes: ['id', 'first_name', 'last_name', 'patient_number', 'payment_type'] },
      ],
    });

    if (!bill) return error(res, 'Bill not found', 404);
    return success(res, bill);
  } catch (err) {
    return error(res, 'Failed to fetch bill', 500);
  }
};

// Add charge to bill (called internally or manually)
exports.addCharge = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, description, category, amount, reference_id } = req.body;
    if (!visit_id || !description || !category || !amount) {
      return error(res, 'visit_id, description, category, and amount are required', 400);
    }

    // Find or create bill for this visit
    let bill = await Bill.findOne({ where: { visit_id }, transaction: t });
    if (!bill) {
      const visit = await Visit.findByPk(visit_id, { transaction: t });
      if (!visit) { await t.rollback(); return error(res, 'Visit not found', 404); }

      bill = await Bill.create({
        id: uuidv4(),
        visit_id,
        patient_id: visit.patient_id,
        status: 'accumulating',
      }, { transaction: t });
    }

    // Add line item
    const item = await BillItem.create({
      id: uuidv4(),
      bill_id: bill.id,
      description,
      category,
      amount: parseFloat(amount),
      reference_id: reference_id || null,
    }, { transaction: t });

    // Update total
    await bill.update({
      total_amount: parseFloat(bill.total_amount) + parseFloat(amount),
    }, { transaction: t });

    await t.commit();
    return created(res, { bill, item }, 'Charge added');
  } catch (err) {
    await t.rollback();
    console.error('Add charge error:', err);
    return error(res, 'Failed to add charge', 500);
  }
};

// Record payment
exports.recordPayment = async (req, res) => {
  try {
    const { bill_id, amount } = req.body;
    if (!bill_id || !amount) return error(res, 'bill_id and amount are required', 400);

    const bill = await Bill.findByPk(bill_id);
    if (!bill) return error(res, 'Bill not found', 404);

    const newPaidAmount = parseFloat(bill.paid_amount) + parseFloat(amount);
    const isPaid = newPaidAmount >= parseFloat(bill.total_amount);

    await bill.update({
      paid_amount: newPaidAmount,
      status: isPaid ? 'paid' : 'pending_payment',
    });

    return success(res, bill, isPaid ? 'Bill fully paid' : 'Payment recorded');
  } catch (err) {
    return error(res, 'Failed to record payment', 500);
  }
};

// Waive bill (state patient or override)
exports.waiveBill = async (req, res) => {
  try {
    const bill = await Bill.findByPk(req.params.id);
    if (!bill) return error(res, 'Bill not found', 404);

    await bill.update({ status: 'waived' });
    return success(res, bill, 'Bill waived');
  } catch (err) {
    return error(res, 'Failed to waive bill', 500);
  }
};

// Finalize bill for discharge (set to pending_payment)
exports.finalizeBill = async (req, res) => {
  try {
    const bill = await Bill.findByPk(req.params.id);
    if (!bill) return error(res, 'Bill not found', 404);

    await bill.update({ status: 'pending_payment' });
    return success(res, bill, 'Bill finalized - pending payment');
  } catch (err) {
    return error(res, 'Failed to finalize bill', 500);
  }
};
