const { FacilityBillingFee } = require('../models');
const { FEE_KEYS, DEFAULT_FEE_AMOUNTS } = require('../constants/billingFees');

async function getFeeAmount(facilityId, feeKey, transaction) {
  const row = await FacilityBillingFee.findOne({
    where: { facility_id: facilityId, fee_key: feeKey },
    transaction,
  });
  if (row) return parseFloat(row.amount);
  return DEFAULT_FEE_AMOUNTS[feeKey] ?? 0;
}

async function getAllFees(facilityId) {
  const rows = await FacilityBillingFee.findAll({
    where: { facility_id: facilityId },
    order: [['fee_key', 'ASC']],
  });
  const map = { ...DEFAULT_FEE_AMOUNTS };
  for (const row of rows) {
    map[row.fee_key] = parseFloat(row.amount);
  }
  return Object.entries(map).map(([fee_key, amount]) => ({
    fee_key,
    amount,
  }));
}

async function upsertFee(facilityId, feeKey, amount, userId) {
  const [row] = await FacilityBillingFee.upsert({
    facility_id: facilityId,
    fee_key: feeKey,
    amount,
    updated_by: userId,
    updated_at: new Date(),
  });
  return row;
}

module.exports = {
  FEE_KEYS,
  getFeeAmount,
  getAllFees,
  upsertFee,
};
