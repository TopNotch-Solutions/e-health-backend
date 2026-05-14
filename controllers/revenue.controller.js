const { v4: uuidv4 } = require('uuid');
const { RevenueShift, Bill, BillItem, User, sequelize } = require('../models');
const { Op } = require('sequelize');
const { success, created, error } = require('../utils/response');

// Open a billing shift
exports.openShift = async (req, res) => {
  try {
    // Check if clerk already has an open shift
    const existing = await RevenueShift.findOne({
      where: { billing_clerk_id: req.user.id, status: 'open' },
    });
    if (existing) return error(res, 'You already have an open shift', 400);

    const shift = await RevenueShift.create({
      id: uuidv4(),
      billing_clerk_id: req.user.id,
      shift_start: new Date(),
      status: 'open',
    });

    return created(res, shift, 'Shift opened');
  } catch (err) {
    return error(res, 'Failed to open shift', 500);
  }
};

// Close shift (billing clerk submits collected amount)
exports.closeShift = async (req, res) => {
  try {
    const { id } = req.params;
    const { collected_amount, notes } = req.body;

    const shift = await RevenueShift.findByPk(id);
    if (!shift) return error(res, 'Shift not found', 404);
    if (shift.status !== 'open') return error(res, 'Shift is not open', 400);
    if (shift.billing_clerk_id !== req.user.id) return error(res, 'Not your shift', 403);

    // Calculate expected amount (total payments received during shift)
    const payments = await Bill.findAll({
      where: {
        status: 'paid',
        created_at: { [Op.gte]: shift.shift_start },
      },
    });
    const expectedAmount = payments.reduce((sum, b) => sum + parseFloat(b.paid_amount), 0);

    await shift.update({
      shift_end: new Date(),
      collected_amount: parseFloat(collected_amount) || 0,
      expected_amount: expectedAmount,
      status: 'closed',
      notes: notes || null,
    });

    return success(res, shift, 'Shift closed - awaiting reconciliation');
  } catch (err) {
    return error(res, 'Failed to close shift', 500);
  }
};

// Revenue officer reconciles a shift
exports.reconcileShift = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const shift = await RevenueShift.findByPk(id);
    if (!shift) return error(res, 'Shift not found', 404);
    if (shift.status !== 'closed') return error(res, 'Shift must be closed first', 400);

    const hasDiscrepancy = Math.abs(parseFloat(shift.collected_amount) - parseFloat(shift.expected_amount)) > 0.01;

    await shift.update({
      status: hasDiscrepancy ? 'discrepancy' : 'reconciled',
      reconciled_by: req.user.id,
      notes: notes || shift.notes,
    });

    return success(res, shift, hasDiscrepancy ? 'Discrepancy detected' : 'Shift reconciled');
  } catch (err) {
    return error(res, 'Failed to reconcile shift', 500);
  }
};

// Get all shifts (revenue dashboard)
exports.getShifts = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const where = {};
    if (status) where.status = status;

    const { rows, count } = await RevenueShift.findAndCountAll({
      where,
      include: [
        { association: 'billingClerk', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'reconciledBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
      order: [['shift_start', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    return success(res, { rows, total: count, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    return error(res, 'Failed to fetch shifts', 500);
  }
};

// Revenue dashboard stats
exports.getDashboard = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const [todayRevenue, monthRevenue, openShifts, pendingReconciliation, discrepancies] = await Promise.all([
      Bill.sum('paid_amount', { where: { status: 'paid', created_at: { [Op.gte]: today } } }),
      Bill.sum('paid_amount', { where: { status: 'paid', created_at: { [Op.gte]: startOfMonth } } }),
      RevenueShift.count({ where: { status: 'open' } }),
      RevenueShift.count({ where: { status: 'closed' } }),
      RevenueShift.count({ where: { status: 'discrepancy' } }),
    ]);

    const pendingBills = await Bill.count({ where: { status: 'pending_payment' } });
    const totalOutstanding = await Bill.sum('total_amount', {
      where: { status: { [Op.in]: ['accumulating', 'pending_payment'] } },
    });

    return success(res, {
      today_revenue: todayRevenue || 0,
      month_revenue: monthRevenue || 0,
      open_shifts: openShifts,
      pending_reconciliation: pendingReconciliation,
      discrepancies,
      pending_bills: pendingBills,
      total_outstanding: totalOutstanding || 0,
    });
  } catch (err) {
    console.error('Revenue dashboard error:', err);
    return error(res, 'Failed to fetch dashboard', 500);
  }
};

// Get my current open shift (for billing clerk)
exports.getMyShift = async (req, res) => {
  try {
    const shift = await RevenueShift.findOne({
      where: { billing_clerk_id: req.user.id, status: 'open' },
    });
    return success(res, shift);
  } catch (err) {
    return error(res, 'Failed to fetch shift', 500);
  }
};
