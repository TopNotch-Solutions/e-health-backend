const { v4: uuidv4 } = require('uuid');
const {
  Bill,
  BillItem,
  Visit,
  Patient,
  Admission,
  Bed,
  QueueEntry,
  sequelize,
} = require('../models');
const { Op } = require('sequelize');
const { success, created, error } = require('../utils/response');
const billingChargeService = require('../services/billingChargeService');
const revenueService = require('../services/revenueService');
const queueService = require('../services/queueService');
const notificationService = require('../services/notificationService');
const { loadBillForFacility, loadVisitForFacility } = require('../services/billingFacilityGuard');
const { buildBillingReceipt } = require('../services/billingReceiptService');

function paymentTotalsMatch(total, cash, eft) {
  const t = billingChargeService.money(total);
  const sum = billingChargeService.money(parseFloat(cash) + parseFloat(eft));
  return Math.abs(t - sum) < 0.005;
}

exports.getQueue = async (req, res) => {
  try {
    const facilityId = req.user.facility_id;
    const bills = await Bill.findAll({
      where: { status: { [Op.in]: ['accumulating', 'pending_payment'] } },
      include: [
        {
          model: Patient,
          as: 'patient',
          where: { payment_type: 'private' },
          attributes: ['id', 'first_name', 'last_name', 'patient_number', 'phone', 'payment_type'],
        },
        {
          model: Visit,
          as: 'visit',
          where: { facility_id: facilityId, status: 'in_progress' },
          attributes: ['id', 'visit_number', 'status', 'current_department'],
        },
        { association: 'items', separate: true, order: [['created_at', 'ASC']] },
      ],
      order: [['created_at', 'ASC']],
    });

    const visitIds = bills.map((b) => b.visit_id);
    const queueEntries = visitIds.length
      ? await QueueEntry.findAll({
          where: {
            visit_id: { [Op.in]: visitIds },
            department: 'billing',
            status: { [Op.in]: ['waiting', 'in_progress'] },
          },
        })
      : [];

    const queueByVisit = Object.fromEntries(queueEntries.map((q) => [q.visit_id, q]));

    const rows = bills.map((bill) => {
      const total = billingChargeService.money(bill.total_amount);
      const balance = billingChargeService.money(total - parseFloat(bill.paid_amount || 0));
      return {
        bill_id: bill.id,
        visit_id: bill.visit_id,
        visit_number: bill.visit?.visit_number,
        patient_name: [bill.patient?.first_name, bill.patient?.last_name].filter(Boolean).join(' '),
        patient_number: bill.patient?.patient_number,
        phone: bill.patient?.phone,
        total_amount: total,
        paid_amount: billingChargeService.money(bill.paid_amount),
        balance_due: balance,
        status: bill.status,
        items: bill.items || [],
        queue_entry: queueByVisit[bill.visit_id] || null,
      };
    });

    return success(res, rows);
  } catch (err) {
    console.error('Get billing queue error:', err);
    return error(res, 'Failed to fetch billing queue', 500);
  }
};

exports.getBillByVisit = async (req, res) => {
  try {
    await loadVisitForFacility(req.params.visitId, req.user.facility_id);

    const bill = await Bill.findOne({
      where: { visit_id: req.params.visitId },
      include: [
        { association: 'items', order: [['created_at', 'ASC']] },
        {
          model: Patient,
          as: 'patient',
          attributes: ['id', 'first_name', 'last_name', 'patient_number', 'payment_type'],
        },
        { model: Visit, as: 'visit', attributes: ['id', 'visit_number', 'status', 'facility_id'] },
      ],
    });

    if (!bill) return error(res, 'Bill not found', 404);

    const total = billingChargeService.money(bill.total_amount);
    return success(res, {
      ...bill.toJSON(),
      total_amount: total,
      balance_due: billingChargeService.money(total - parseFloat(bill.paid_amount || 0)),
    });
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    return error(res, 'Failed to fetch bill', 500);
  }
};

exports.addCharge = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, description, category, amount, reference_id } = req.body;
    if (!visit_id || !description || !category || amount === undefined) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id, description, category, and amount are required', 400);
    }

    await loadVisitForFacility(visit_id, req.user.facility_id, t);

    const result = await billingChargeService.addCharge({
      visitId: visit_id,
      facilityId: req.user.facility_id,
      category,
      description,
      amount,
      referenceId: reference_id,
      transaction: t,
    });

    await t.commit();
    if (!result) {
      return success(res, { skipped: true, reason: 'state_patient' }, 'No charge — state patient');
    }
    return created(res, result, 'Charge added');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Add charge error:', err);
    return error(res, 'Failed to add charge', 500);
  }
};

async function completeVisitAfterPayment(visitId, userId, transaction) {
  const visit = await Visit.findByPk(visitId, {
    include: [
      { association: 'patient' },
      { association: 'admission', include: [{ model: Bed, as: 'bed' }] },
    ],
    transaction,
  });
  if (!visit) return;

  if (visit.admission && visit.admission.status !== 'discharged') {
    await visit.admission.update(
      {
        discharged_at: new Date(),
        discharged_by: userId,
        status: 'discharged',
      },
      { transaction }
    );
    if (visit.admission.bed) {
      await visit.admission.bed.update({ status: 'available' }, { transaction });
    }
  }

  await visit.update(
    {
      status: 'discharged',
      completed_at: new Date(),
      current_department: null,
    },
    { transaction }
  );

  const billingEntry = await queueService.findActiveEntryForVisit(visitId, 'billing', transaction);
  if (billingEntry) {
    await queueService.completeEntry(billingEntry.id, {
      notes: 'Billing settled — visit closed',
    }, transaction);
  }
}

exports.recordPayment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { bill_id, cash_amount, eft_amount } = req.body;
    if (!bill_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'bill_id is required', 400);
    }

    const cash = parseFloat(cash_amount) || 0;
    const eft = parseFloat(eft_amount) || 0;
    if (cash < 0 || eft < 0) {
      if (!t.finished) await t.rollback();
      return error(res, 'Payment amounts cannot be negative', 400);
    }
    if (cash === 0 && eft === 0) {
      if (!t.finished) await t.rollback();
      return error(res, 'Enter cash and/or EFT amount', 400);
    }

    try {
      await revenueService.requireCurrentShift(req.user.facility_id, req.user.id);
    } catch (shiftErr) {
      if (!t.finished) await t.rollback();
      return error(res, shiftErr.message, shiftErr.statusCode || 400);
    }

    const bill = await loadBillForFacility(bill_id, req.user.facility_id, t);
    if (bill.patient?.payment_type !== 'private') {
      if (!t.finished) await t.rollback();
      return error(res, 'State patients are not billed', 400);
    }

    const total = billingChargeService.money(bill.total_amount);
    if (!paymentTotalsMatch(total, cash, eft)) {
      if (!t.finished) await t.rollback();
      return error(
        res,
        `Cash (N$ ${cash.toFixed(2)}) + EFT (N$ ${eft.toFixed(2)}) must equal total N$ ${total.toFixed(2)}`,
        400
      );
    }

    await bill.update(
      {
        paid_amount: total,
        cash_paid: billingChargeService.money(cash),
        eft_paid: billingChargeService.money(eft),
        status: 'paid',
        paid_by: req.user.id,
        paid_at: new Date(),
      },
      { transaction: t }
    );

    await completeVisitAfterPayment(bill.visit_id, req.user.id, t);

    await t.commit();

    try {
      notificationService.emitBillingCharge({
        facility_id: req.user.facility_id,
        visit_id: bill.visit_id,
        bill_id: bill.id,
        status: 'paid',
      });
    } catch (emitErr) {
      console.error('Billing emit after payment:', emitErr.message);
    }

    const paidBill = await Bill.findByPk(bill.id);
    const receipt = await buildBillingReceipt(bill.id, req.user.facility_id);
    return success(res, { bill: paidBill, receipt }, 'Payment recorded — patient discharged');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Record payment error:', err);
    return error(res, err.message || 'Failed to record payment', err.statusCode || 500);
  }
};

exports.getReceipt = async (req, res) => {
  try {
    const receipt = await buildBillingReceipt(req.params.id, req.user.facility_id);
    return success(res, receipt);
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    console.error('Get billing receipt error:', err);
    return error(res, 'Failed to fetch billing receipt', 500);
  }
};

exports.waiveBill = async (req, res) => {
  try {
    const bill = await loadBillForFacility(req.params.id, req.user.facility_id);

    await bill.update({ status: 'waived' });
    return success(res, bill, 'Bill waived');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    return error(res, 'Failed to waive bill', 500);
  }
};

exports.finalizeBill = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const bill = await loadBillForFacility(req.params.id, req.user.facility_id, t);

    await billingChargeService.finalizeBillForDischarge(
      bill.visit_id,
      req.user.facility_id,
      t
    );

    await t.commit();
    const refreshed = await loadBillForFacility(req.params.id, req.user.facility_id);
    return success(res, refreshed, 'Bill finalized — pending payment');
  } catch (err) {
    if (!t.finished) await t.rollback();
    if (err.statusCode) return error(res, err.message, err.statusCode);
    return error(res, 'Failed to finalize bill', 500);
  }
};
