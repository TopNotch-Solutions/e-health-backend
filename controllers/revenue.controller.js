const { success, error } = require('../utils/response');
const revenueService = require('../services/revenueService');

function facilityIdFromReq(req) {
  return req.user?.facility_id || null;
}

exports.reconcileShift = async (req, res) => {
  try {
    const { verified_cash, notes } = req.body;
    if (verified_cash === undefined || verified_cash === null) {
      return error(res, 'verified_cash is required (cash counted by revenue office)', 400);
    }

    const shift = await revenueService.getShiftById(req.params.id, facilityIdFromReq(req));
    if (!shift) return error(res, 'Shift not found', 404);

    const result = await revenueService.reconcileShift(req.params.id, req.user.id, {
      verified_cash,
      notes,
    });

    const message = result.has_deficit
      ? `Cash deficit of N$ ${result.deficit.toFixed(2)} — amounts do not match system records`
      : 'Shift verified — cash matches system records';

    return success(res, result.shift, message);
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    console.error('Reconcile shift error:', err);
    return error(res, 'Failed to verify shift', 500);
  }
};

exports.getShifts = async (req, res) => {
  try {
    const facilityId = facilityIdFromReq(req);
    if (!facilityId) return error(res, 'Facility context required', 400);

    const data = await revenueService.listShifts(facilityId, {
      status: req.query.status,
      page: req.query.page,
      limit: req.query.limit,
    });
    return success(res, data);
  } catch (err) {
    console.error('Get shifts error:', err);
    return error(res, 'Failed to fetch shifts', 500);
  }
};

exports.getShift = async (req, res) => {
  try {
    const facilityId = facilityIdFromReq(req);
    const shift = await revenueService.getShiftById(req.params.id, facilityId);
    if (!shift) return error(res, 'Shift not found', 404);
    return success(res, shift);
  } catch (err) {
    console.error('Get shift error:', err);
    return error(res, 'Failed to fetch shift', 500);
  }
};

exports.getDashboard = async (req, res) => {
  try {
    const facilityId = facilityIdFromReq(req);
    if (!facilityId) return error(res, 'Facility context required', 400);
    const data = await revenueService.getDashboard(facilityId);
    return success(res, data);
  } catch (err) {
    console.error('Revenue dashboard error:', err);
    return error(res, 'Failed to fetch dashboard', 500);
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const facilityId = facilityIdFromReq(req);
    if (!facilityId) return error(res, 'Facility context required', 400);
    const period = ['daily', 'weekly', 'monthly'].includes(req.query.period)
      ? req.query.period
      : 'daily';
    const data = await revenueService.getTransactionAnalytics(facilityId, period);
    return success(res, data);
  } catch (err) {
    console.error('Revenue transactions error:', err);
    return error(res, 'Failed to fetch transactions', 500);
  }
};

/** Current scheduled shift + this clerk's collections in the window. */
exports.getMyShift = async (req, res) => {
  try {
    const facilityId = facilityIdFromReq(req);
    if (!facilityId) return error(res, 'Facility context required', 400);

    const summary = await revenueService.getClerkShiftSummary(facilityId, req.user.id);
    return success(res, summary);
  } catch (err) {
    console.error('Get my shift error:', err);
    return error(res, 'Failed to fetch shift', 500);
  }
};
