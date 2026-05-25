const { success, error } = require('../utils/response');
const { getAllFees, upsertFee } = require('../services/billingFeeService');
const {
  FEE_LABELS,
  FEE_SUPERVISOR_ROLE,
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
      supervisor_role: FEE_SUPERVISOR_ROLE[row.fee_key] || null,
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
    const { feeKey } = req.params;
    const { amount } = req.body;
    const facilityId = req.user.facility_id;

    if (!facilityId) return error(res, 'Facility context required', 400);
    if (amount === undefined || amount === null || Number.isNaN(parseFloat(amount))) {
      return error(res, 'Valid amount is required', 400);
    }
    if (parseFloat(amount) < 0) return error(res, 'Amount cannot be negative', 400);

    const requiredRole = FEE_SUPERVISOR_ROLE[feeKey];
    const userRole = req.user.role?.name || req.user.role;
    if (requiredRole && userRole !== requiredRole && userRole !== 'system_admin') {
      return error(res, 'Your role cannot update this fee', 403);
    }
    if (!requiredRole && userRole !== 'system_admin') {
      return error(res, 'Unknown fee key', 400);
    }

    const row = await upsertFee(facilityId, feeKey, parseFloat(amount), req.user.id);
    return success(
      res,
      {
        fee_key: feeKey,
        amount: parseFloat(row.amount),
        label: FEE_LABELS[feeKey],
      },
      'Fee updated'
    );
  } catch (err) {
    console.error('Update billing fee error:', err);
    return error(res, 'Failed to update fee', 500);
  }
};
