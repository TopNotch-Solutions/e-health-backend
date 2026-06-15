const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const { RevenueShift, Bill, Visit, Patient, User, Facility } = require('../models');
const { getShiftWindow } = require('../constants/billingShiftSchedule');
const { isClinicFacility } = require('../config/clinicRoles');

function money(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

function shiftLabel(slot, facilityType) {
  if (facilityType === 'clinic') return 'Clinic shift (08:00 – 17:00)';
  return slot === 'night' ? 'Night shift (20:00 – 08:00)' : 'Day shift (08:00 – 20:00)';
}

async function resolveFacilityType(facilityId) {
  if (!facilityId) return null;
  const facility = await Facility.findByPk(facilityId, { attributes: ['type'] });
  return facility?.type || null;
}

function clinicShiftIsActive(window, now = new Date()) {
  const hour = now.getHours();
  const minute = now.getMinutes();
  const afterStart =
    hour > window.shift_start.getHours()
    || (hour === window.shift_start.getHours() && minute >= window.shift_start.getMinutes());
  const beforeEnd =
    hour < window.shift_end.getHours()
    || (hour === window.shift_end.getHours() && minute < window.shift_end.getMinutes());
  return afterStart && beforeEnd;
}

/** Per-clerk shift verification UI flags. */
function verificationMeta(plain) {
  const now = new Date();
  const ended = plain.shift_end && new Date(plain.shift_end) <= now;
  const can_verify =
    plain.status === 'closed' ||
    plain.status === 'discrepancy' ||
    (plain.status === 'open' && ended);
  const is_verified = plain.status === 'reconciled';
  const has_deficit =
    plain.status === 'discrepancy' ||
    (plain.cash_deficit != null && money(plain.cash_deficit) > 0.01);

  let verify_button_label = 'Verify';
  if (is_verified) verify_button_label = 'Verified';
  else if (has_deficit) verify_button_label = 'Verify (deficit)';

  return {
    can_verify,
    needs_verification: can_verify && !is_verified,
    is_verified,
    verify_button_label,
  };
}

function clerkDetailsFromUser(user) {
  if (!user) return null;
  const u = user.toJSON ? user.toJSON() : user;
  return {
    id: u.id,
    first_name: u.first_name,
    last_name: u.last_name,
    full_name: `${u.first_name || ''} ${u.last_name || ''}`.trim(),
    email: u.email || null,
    employee_id: u.employee_id || null,
    phone: u.phone || null,
  };
}

function formatShift(row, totals = null) {
  const plain = row.toJSON ? row.toJSON() : row;
  const expectedCash = money(totals?.expectedCash ?? plain.expected_cash ?? plain.expected_amount);
  const expectedEft = money(totals?.expectedEft ?? plain.expected_eft);
  const expectedTotal = money(totals?.expectedTotal ?? expectedCash + expectedEft);
  const clerkCash = money(plain.collected_amount);
  const verifiedCash = plain.verified_cash != null ? money(plain.verified_cash) : null;
  const deficit =
    plain.cash_deficit != null
      ? money(plain.cash_deficit)
      : verifiedCash != null
        ? money(Math.max(0, expectedCash - verifiedCash))
        : null;

  const clerk = clerkDetailsFromUser(plain.billingClerk || plain.billing_clerk);
  const hasDeficitFlag = deficit != null && deficit > 0.01;
  const vMeta = verificationMeta({ ...plain, cash_deficit: deficit, status: plain.status });

  return {
    ...plain,
    ...vMeta,
    shift_label: plain.shift_label || shiftLabel(plain.shift_slot, plain.facility_type),
    expected_cash: expectedCash,
    expected_eft: expectedEft,
    expected_total: expectedTotal,
    clerk_declared_cash: clerkCash,
    verified_cash: verifiedCash,
    cash_deficit: deficit,
    has_deficit: hasDeficitFlag || plain.status === 'discrepancy',
    clerk_name: clerk?.full_name || null,
    billing_clerk: clerk,
    payment_count: totals?.payments?.length ?? plain.payment_count ?? 0,
    payments: totals?.payments ?? plain.payments ?? [],
    reconciled_by_name: plain.reconciledBy
      ? `${plain.reconciledBy.first_name} ${plain.reconciledBy.last_name}`.trim()
      : null,
  };
}

async function enrichShiftWithTotals(shiftRow) {
  const totals = await sumPaymentsForShift(shiftRow, shiftRow.billing_clerk_id);
  return formatShift(shiftRow.toJSON(), totals);
}

async function sumPaymentsForShift(shift, billingClerkId = null) {
  const end = shift.shift_end || new Date();
  const where = {
    status: 'paid',
    paid_at: {
      [Op.gte]: shift.shift_start,
      [Op.lte]: end,
    },
  };
  if (billingClerkId) where.paid_by = billingClerkId;

  const bills = await Bill.findAll({
    where,
    include: [
      {
        model: Visit,
        as: 'visit',
        attributes: ['id', 'visit_number', 'facility_id'],
        where: shift.facility_id ? { facility_id: shift.facility_id } : undefined,
        required: !!shift.facility_id,
      },
      {
        model: Patient,
        as: 'patient',
        attributes: ['patient_number', 'first_name', 'last_name'],
      },
      {
        model: User,
        as: 'paidByUser',
        attributes: ['first_name', 'last_name'],
        required: false,
      },
    ],
    order: [['paid_at', 'ASC']],
  });

  let expectedCash = 0;
  let expectedEft = 0;
  const payments = bills.map((b) => {
    const cash = money(b.cash_paid);
    const eft = money(b.eft_paid);
    expectedCash += cash;
    expectedEft += eft;
    const p = b.patient;
    const clerk = b.paidByUser;
    return {
      bill_id: b.id,
      visit_number: b.visit?.visit_number,
      patient_name: p ? `${p.first_name} ${p.last_name}`.trim() : null,
      patient_number: p?.patient_number,
      paid_at: b.paid_at,
      total: money(b.paid_amount),
      cash,
      eft,
      collected_by: clerk ? `${clerk.first_name} ${clerk.last_name}`.trim() : null,
    };
  });

  return {
    expectedCash: money(expectedCash),
    expectedEft: money(expectedEft),
    expectedTotal: money(expectedCash + expectedEft),
    payments,
  };
}

async function finalizeShiftTotals(shift) {
  const totals = await sumPaymentsForShift(shift, shift.billing_clerk_id);
  await shift.update({
    expected_cash: totals.expectedCash,
    expected_eft: totals.expectedEft,
    expected_amount: totals.expectedTotal,
  });
  return totals;
}

/** Close shifts whose 12-hour window has ended. */
async function closeEndedShifts(facilityId) {
  const now = new Date();
  const where = {
    status: 'open',
    shift_end: { [Op.lte]: now },
  };
  if (facilityId) where.facility_id = facilityId;

  const ended = await RevenueShift.findAll({ where });
  for (const shift of ended) {
    await finalizeShiftTotals(shift);
    await shift.update({ status: 'closed' });
  }
  return ended.length;
}

/** Get or create this billing clerk's shift for the current 12-hour window. */
async function ensureCurrentClerkShift(facilityId, clerkId) {
  if (!facilityId) {
    const err = new Error('Facility context required');
    err.statusCode = 400;
    throw err;
  }
  if (!clerkId) {
    const err = new Error('Billing clerk identity required');
    err.statusCode = 400;
    throw err;
  }

  await closeEndedShifts(facilityId);

  const facilityType = await resolveFacilityType(facilityId);
  const window = getShiftWindow(new Date(), {
    facilityType: facilityType === 'clinic' ? 'clinic' : undefined,
  });

  let shift = await RevenueShift.findOne({
    where: {
      facility_id: facilityId,
      billing_clerk_id: clerkId,
      shift_start: window.shift_start,
    },
  });

  if (!shift) {
    shift = await RevenueShift.create({
      id: uuidv4(),
      facility_id: facilityId,
      billing_clerk_id: clerkId,
      shift_slot: window.slot,
      shift_start: window.shift_start,
      shift_end: window.shift_end,
      status: 'open',
      expected_cash: 0,
      expected_eft: 0,
      expected_amount: 0,
      collected_amount: 0,
    });
  } else if (!shift.shift_end || shift.shift_slot !== window.slot) {
    await shift.update({
      shift_slot: window.slot,
      shift_end: window.shift_end,
    });
  }

  const clerkTotals = await sumPaymentsForShift(shift, clerkId);
  const facilityTotals = await sumPaymentsForShift(shift, null);

  const now = new Date();
  const isActive =
    facilityType === 'clinic'
      ? clinicShiftIsActive(window, now)
      : now < new Date(shift.shift_end);

  return {
    shift,
    window,
    shift_label: window.label,
    facility_type: facilityType,
    is_active: isActive,
    outside_hours_message:
      facilityType === 'clinic' && !isActive
        ? 'Billing clerk shift runs 08:00–17:00 daily. Collections are only recorded during this window.'
        : null,
    expectedCash: clerkTotals.expectedCash,
    expectedEft: clerkTotals.expectedEft,
    expectedTotal: clerkTotals.expectedTotal,
    payments: clerkTotals.payments,
    payment_count: clerkTotals.payments.length,
    facility_expected_cash: facilityTotals.expectedCash,
    facility_expected_eft: facilityTotals.expectedEft,
    facility_expected_total: facilityTotals.expectedTotal,
    facility_payment_count: facilityTotals.payments.length,
  };
}

async function requireCurrentShift(facilityId, clerkId) {
  const ctx = await ensureCurrentClerkShift(facilityId, clerkId);
  if (!ctx.is_active) {
    const err = new Error(
      ctx.outside_hours_message || 'Billing clerk shift is not active — collections cannot be recorded now'
    );
    err.statusCode = 403;
    throw err;
  }
  return ctx.shift;
}

async function getClerkShiftSummary(facilityId, clerkId) {
  const ctx = await ensureCurrentClerkShift(facilityId, clerkId);
  const row = await RevenueShift.findByPk(ctx.shift.id, {
    include: [
      {
        association: 'billingClerk',
        attributes: ['id', 'first_name', 'last_name', 'email', 'employee_id', 'phone'],
      },
    ],
  });
  const totals = {
    expectedCash: ctx.expectedCash,
    expectedEft: ctx.expectedEft,
    expectedTotal: ctx.expectedTotal,
    payments: ctx.payments,
  };
  return {
    ...formatShift(row.toJSON(), totals),
    shift_label: ctx.shift_label,
    facility_expected_cash: ctx.facility_expected_cash,
    facility_expected_eft: ctx.facility_expected_eft,
    facility_expected_total: ctx.facility_expected_total,
    facility_payment_count: ctx.facility_payment_count,
    is_active: ctx.is_active,
  };
}

async function reconcileShift(shiftId, officerId, { verified_cash, notes, facilityId } = {}) {
  const shift = await RevenueShift.findByPk(shiftId);
  if (!shift) {
    const err = new Error('Shift not found');
    err.statusCode = 404;
    throw err;
  }
  if (facilityId && shift.facility_id !== facilityId) {
    const err = new Error('This shift belongs to another facility');
    err.statusCode = 403;
    throw err;
  }
  const ended = shift.shift_end && new Date(shift.shift_end) <= new Date();
  if (shift.status === 'open' && ended) {
    await finalizeShiftTotals(shift);
    await shift.update({ status: 'closed' });
    await shift.reload();
  }
  if (shift.status === 'open' && !ended) {
    const err = new Error('This clerk’s shift is still in progress — verify after it ends');
    err.statusCode = 400;
    throw err;
  }
  if (shift.status !== 'closed' && shift.status !== 'discrepancy') {
    const err = new Error('Shift is not ready for verification');
    err.statusCode = 400;
    throw err;
  }

  const verified = money(verified_cash);
  const expectedCash = money(shift.expected_cash ?? shift.expected_amount);
  const deficit = money(Math.max(0, expectedCash - verified));
  const hasDeficit = deficit > 0.01;

  await shift.update({
    verified_cash: verified,
    cash_deficit: deficit,
    status: hasDeficit ? 'discrepancy' : 'reconciled',
    reconciled_by: officerId,
    notes: notes != null ? notes : shift.notes,
  });

  const detail = await getShiftById(shift.id);
  return { shift: detail, has_deficit: hasDeficit, deficit };
}

async function getShiftById(shiftId, facilityId) {
  const where = { id: shiftId };
  if (facilityId) where.facility_id = facilityId;

  const shift = await RevenueShift.findOne({
    where,
    include: [
      {
        association: 'billingClerk',
        attributes: ['id', 'first_name', 'last_name', 'email', 'employee_id', 'phone'],
      },
      { association: 'reconciledBy', attributes: ['id', 'first_name', 'last_name'] },
    ],
  });
  if (!shift) return null;

  const totals = await sumPaymentsForShift(shift, shift.billing_clerk_id);
  return formatShift(shift.toJSON(), totals);
}

async function listShifts(facilityId, { status, page = 1, limit = 20 } = {}) {
  if (facilityId) await closeEndedShifts(facilityId);

  const where = {};
  if (facilityId) where.facility_id = facilityId;
  if (status === 'pending') {
    where.status = { [Op.in]: ['closed', 'discrepancy'] };
  } else if (status) {
    where.status = status;
  }

  const offset = (page - 1) * limit;
  const { rows, count } = await RevenueShift.findAndCountAll({
    where,
    include: [
      {
        association: 'billingClerk',
        attributes: ['id', 'first_name', 'last_name', 'email', 'employee_id', 'phone'],
      },
      { association: 'reconciledBy', attributes: ['id', 'first_name', 'last_name'] },
    ],
    order: [['shift_start', 'DESC']],
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
  });

  const enriched = await Promise.all(rows.map((row) => enrichShiftWithTotals(row)));

  return {
    rows: enriched,
    total: count,
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
  };
}

async function paidBillsForFacility(facilityId, since) {
  return Bill.findAll({
    where: {
      status: 'paid',
      paid_at: { [Op.gte]: since },
    },
    include: [
      {
        model: Visit,
        as: 'visit',
        attributes: [],
        where: { facility_id: facilityId },
        required: true,
      },
    ],
    attributes: ['paid_at', 'cash_paid', 'eft_paid', 'paid_amount'],
  });
}

function bucketKey(date, period) {
  const d = new Date(date);
  if (period === 'daily') {
    return d.toISOString().slice(0, 10);
  }
  if (period === 'weekly') {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    return monday.toISOString().slice(0, 10);
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function bucketLabel(key, period) {
  if (period === 'monthly') {
    const [y, m] = key.split('-');
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-GB', {
      month: 'short',
      year: 'numeric',
    });
  }
  return new Date(`${key}T12:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: period === 'weekly' ? 'numeric' : undefined,
  });
}

async function getTransactionAnalytics(facilityId, period = 'daily') {
  const now = new Date();
  const start = new Date(now);
  if (period === 'daily') start.setDate(start.getDate() - 13);
  else if (period === 'weekly') start.setDate(start.getDate() - 7 * 11);
  else start.setMonth(start.getMonth() - 11);
  start.setHours(0, 0, 0, 0);

  const bills = await paidBillsForFacility(facilityId, start);
  const buckets = new Map();

  for (const b of bills) {
    if (!b.paid_at) continue;
    const key = bucketKey(b.paid_at, period);
    if (!buckets.has(key)) {
      buckets.set(key, { key, total: 0, cash: 0, eft: 0, count: 0 });
    }
    const row = buckets.get(key);
    row.total += money(b.paid_amount);
    row.cash += money(b.cash_paid);
    row.eft += money(b.eft_paid);
    row.count += 1;
  }

  const series = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => ({
      ...v,
      total: money(v.total),
      cash: money(v.cash),
      eft: money(v.eft),
      label: bucketLabel(v.key, period),
    }));

  const totals = series.reduce(
    (acc, row) => ({
      total: acc.total + row.total,
      cash: acc.cash + row.cash,
      eft: acc.eft + row.eft,
      count: acc.count + row.count,
    }),
    { total: 0, cash: 0, eft: 0, count: 0 }
  );

  return {
    period,
    series,
    summary: {
      total: money(totals.total),
      cash: money(totals.cash),
      eft: money(totals.eft),
      payment_count: totals.count,
    },
  };
}

async function getDashboard(facilityId) {
  await closeEndedShifts(facilityId);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 6);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const shiftWhere = facilityId ? { facility_id: facilityId } : {};
  const facilityType = await resolveFacilityType(facilityId);
  const current = facilityId
    ? getShiftWindow(new Date(), {
        facilityType: facilityType === 'clinic' ? 'clinic' : facilityType,
      })
    : null;

  const [todayBills, weekBills, monthBills, openShifts, pendingReconciliation, discrepancies] =
    await Promise.all([
      paidBillsForFacility(facilityId, today),
      paidBillsForFacility(facilityId, weekStart),
      paidBillsForFacility(facilityId, monthStart),
      RevenueShift.count({ where: { ...shiftWhere, status: 'open' } }),
      RevenueShift.count({ where: { ...shiftWhere, status: 'closed' } }),
      RevenueShift.count({ where: { ...shiftWhere, status: 'discrepancy' } }),
    ]);

  const sumBills = (list) =>
    list.reduce(
      (acc, b) => ({
        total: acc.total + money(b.paid_amount),
        cash: acc.cash + money(b.cash_paid),
        eft: acc.eft + money(b.eft_paid),
      }),
      { total: 0, cash: 0, eft: 0 }
    );

  const todayS = sumBills(todayBills);
  const weekS = sumBills(weekBills);
  const monthS = sumBills(monthBills);

  const pendingBills = await Bill.count({
    where: { status: { [Op.in]: ['accumulating', 'pending_payment'] } },
    include: [
      {
        model: Visit,
        as: 'visit',
        attributes: [],
        where: { facility_id: facilityId },
        required: true,
      },
    ],
  });

  return {
    today: { ...todayS, payment_count: todayBills.length },
    week: { ...weekS, payment_count: weekBills.length },
    month: { ...monthS, payment_count: monthBills.length },
    open_shifts: openShifts,
    pending_reconciliation: pendingReconciliation,
    discrepancies,
    pending_bills: pendingBills,
    current_shift: current
      ? {
          label: current.label,
          shift_start: current.shift_start,
          shift_end: current.shift_end,
          slot: current.slot,
        }
      : null,
  };
}

module.exports = {
  money,
  formatShift,
  getShiftWindow,
  sumPaymentsForShift,
  ensureCurrentClerkShift,
  requireCurrentShift,
  getClerkShiftSummary,
  reconcileShift,
  getShiftById,
  listShifts,
  closeEndedShifts,
  getTransactionAnalytics,
  getDashboard,
};
