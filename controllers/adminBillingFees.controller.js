const { success, error } = require('../utils/response');
const {
  getFeesForFacility,
  getNationalFees,
  updateNationalFeeWithHistory,
  updateFacilityFeeWithHistory,
  getFeeChangeHistory,
  getNationalFeeChangeHistory,
} = require('../services/billingFeeService');

exports.getNationalBillingFees = async (req, res) => {
  try {
    const scope = req.query.scope;
    if (!scope || !['clinic', 'hospital'].includes(scope)) {
      return error(res, 'scope must be clinic or hospital', 400);
    }
    const payload = await getNationalFees(scope);
    return success(res, payload);
  } catch (err) {
    console.error('Get national billing fees error:', err);
    return error(res, err.message || 'Failed to fetch national prices', err.statusCode || 500);
  }
};

exports.updateNationalBillingFee = async (req, res) => {
  try {
    const scope = req.query.scope;
    const { feeKey } = req.params;
    const { amount, reason } = req.body;

    if (!scope || !['clinic', 'hospital'].includes(scope)) {
      return error(res, 'scope must be clinic or hospital', 400);
    }
    if (amount === undefined || amount === null || Number.isNaN(parseFloat(amount))) {
      return error(res, 'Valid amount is required', 400);
    }
    if (parseFloat(amount) < 0) return error(res, 'Amount cannot be negative', 400);

    const updated = await updateNationalFeeWithHistory({
      scope,
      feeKey,
      amount: parseFloat(amount),
      userId: req.user.id,
      reason,
    });

    return success(res, updated, 'National price updated');
  } catch (err) {
    console.error('Update national billing fee error:', err);
    return error(res, err.message || 'Failed to update national price', err.statusCode || 500);
  }
};

exports.getNationalBillingFeeHistory = async (req, res) => {
  try {
    const scope = req.query.scope;
    if (!scope || !['clinic', 'hospital'].includes(scope)) {
      return error(res, 'scope must be clinic or hospital', 400);
    }
    const history = await getNationalFeeChangeHistory(scope);
    return success(res, { history, scope });
  } catch (err) {
    console.error('Get national billing fee history error:', err);
    return error(res, 'Failed to fetch national price history', 500);
  }
};

exports.getFacilityBillingFees = async (req, res) => {
  try {
    const payload = await getFeesForFacility(req.params.id);
    if (!payload) return error(res, 'Facility not found', 404);
    return success(res, payload);
  } catch (err) {
    console.error('Get facility billing fees error:', err);
    return error(res, 'Failed to fetch billing fees', 500);
  }
};

exports.updateFacilityBillingFee = async (req, res) => {
  try {
    const { feeKey } = req.params;
    const { amount, reason, use_national_default: useNationalDefault } = req.body;

    if (!useNationalDefault) {
      if (amount === undefined || amount === null || Number.isNaN(parseFloat(amount))) {
        return error(res, 'Valid amount is required', 400);
      }
      if (parseFloat(amount) < 0) return error(res, 'Amount cannot be negative', 400);
    }

    const updated = await updateFacilityFeeWithHistory({
      facilityId: req.params.id,
      feeKey,
      amount: amount != null ? parseFloat(amount) : null,
      userId: req.user.id,
      reason,
      useNationalDefault: Boolean(useNationalDefault),
    });

    return success(res, updated, useNationalDefault ? 'Facility price reset to national default' : 'Facility price updated');
  } catch (err) {
    console.error('Update facility billing fee error:', err);
    return error(res, err.message || 'Failed to update price', err.statusCode || 500);
  }
};

exports.getFacilityBillingFeeHistory = async (req, res) => {
  try {
    const history = await getFeeChangeHistory(req.params.id);
    return success(res, { history });
  } catch (err) {
    console.error('Get facility billing fee history error:', err);
    return error(res, 'Failed to fetch price change history', 500);
  }
};
