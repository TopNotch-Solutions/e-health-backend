const { success, error } = require('../utils/response');
const { getAllFees, updateFacilityFeeWithHistory } = require('../services/billingFeeService');
const {
  FEE_LABELS,
  DEFAULT_FEE_AMOUNTS,
} = require('../constants/billingFees');

exports.getFees = async (req, res) => {
  try {
    const facilityId = req.user.facility_id;
    if (!facilityId) return error(res, 'Facility context required', 400);

    const fees = await getAllFees(facilityId);
    const enriched = fees.map((row) => ({
      ...row,
      label: FEE_LABELS[row.fee_key] || row.fee_key,
      default_amount: DEFAULT_FEE_AMOUNTS[row.fee_key],
    }));

    return success(res, enriched);
  } catch (err) {
    console.error('Get billing fees error:', err);
    return error(res, 'Failed to fetch fee schedule', 500);
  }
};

exports.updateFee = async (req, res) => {
  try {
    const userRole = req.user.role?.name || req.user.role;
    if (userRole !== 'system_admin') {
      return error(res, 'Only system administrators can change facility prices', 403);
    }

    const { feeKey } = req.params;
    const { amount, reason } = req.body;
    const facilityId = req.user.facility_id;

    if (!facilityId) return error(res, 'Facility context required', 400);
    if (amount === undefined || amount === null || Number.isNaN(parseFloat(amount))) {
      return error(res, 'Valid amount is required', 400);
    }
    if (parseFloat(amount) < 0) return error(res, 'Amount cannot be negative', 400);

    const row = await updateFacilityFeeWithHistory({
      facilityId,
      feeKey,
      amount: parseFloat(amount),
      userId: req.user.id,
      reason,
    });
    return success(res, row, 'Price updated');
  } catch (err) {
    console.error('Update billing fee error:', err);
    return error(res, err.message || 'Failed to update fee', err.statusCode || 500);
  }
};
