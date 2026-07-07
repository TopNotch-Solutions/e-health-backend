const { v4: uuidv4 } = require('uuid');
const { FacilityBillingFee, FacilityBillingFeeChange, Facility, User } = require('../models');
const { resolveNationalAdminFacility } = require('../utils/nationalAdmin');
const {
  FEE_KEYS,
  DEFAULT_FEE_AMOUNTS,
  feeLabel,
  feeValueKind,
  normalizeFeeValue,
  feeKeysForNationalScope,
  feeKeysForFacilityOverrides,
} = require('../constants/billingFees');

let nationalFacilityIdCache = null;

async function getNationalFacilityId(transaction) {
  if (nationalFacilityIdCache) return nationalFacilityIdCache;
  const facility = await resolveNationalAdminFacility(transaction);
  nationalFacilityIdCache = facility.id;
  return nationalFacilityIdCache;
}

async function getStoredAmount(facilityId, feeKey, transaction) {
  const row = await FacilityBillingFee.findOne({
    where: { facility_id: facilityId, fee_key: feeKey },
    transaction,
  });
  if (row) return parseFloat(row.amount);
  return null;
}

async function resolveFeeAmount(facilityId, feeKey, transaction) {
  const override = await getStoredAmount(facilityId, feeKey, transaction);
  if (override != null) return override;

  const nationalId = await getNationalFacilityId(transaction);
  const national = await getStoredAmount(nationalId, feeKey, transaction);
  if (national != null) return national;

  return DEFAULT_FEE_AMOUNTS[feeKey] ?? 0;
}

async function getFeeAmount(facilityId, feeKey, transaction) {
  return resolveFeeAmount(facilityId, feeKey, transaction);
}

async function getSonarBillingIntervalMinutes(facilityId, transaction) {
  const raw = await getFeeAmount(facilityId, FEE_KEYS.SONAR_BILLING_INTERVAL_MINUTES, transaction);
  const minutes = Math.round(raw);
  return minutes >= 1 ? minutes : (DEFAULT_FEE_AMOUNTS[FEE_KEYS.SONAR_BILLING_INTERVAL_MINUTES] || 30);
}

function formatFeeRow(feeKey, { nationalAmount, overrideAmount, effectiveAmount }) {
  const kind = feeValueKind(feeKey);
  return {
    fee_key: feeKey,
    label: feeLabel(feeKey),
    value_kind: kind,
    amount: effectiveAmount,
    national_amount: nationalAmount,
    override_amount: overrideAmount,
    has_override: overrideAmount != null,
    system_default: DEFAULT_FEE_AMOUNTS[feeKey] ?? 0,
  };
}

async function buildFeeRowsForKeys(facilityId, feeKeys, transaction) {
  const nationalId = await getNationalFacilityId(transaction);
  const rows = await FacilityBillingFee.findAll({
    where: { facility_id: [facilityId, nationalId], fee_key: feeKeys },
    transaction,
  });

  const facilityMap = {};
  const nationalMap = {};
  for (const row of rows) {
    const map = row.facility_id === facilityId ? facilityMap : nationalMap;
    map[row.fee_key] = parseFloat(row.amount);
  }

  return feeKeys.map((feeKey) => {
    const overrideAmount = facilityId === nationalId ? null : (facilityMap[feeKey] ?? null);
    const nationalStored = nationalMap[feeKey] ?? null;
    const nationalAmount = nationalStored ?? (DEFAULT_FEE_AMOUNTS[feeKey] ?? 0);
    const effectiveAmount = overrideAmount ?? nationalAmount;
    return formatFeeRow(feeKey, { nationalAmount, overrideAmount, effectiveAmount });
  });
}

async function getNationalFees(scope) {
  const feeKeys = feeKeysForNationalScope(scope);
  if (!feeKeys.length) {
    const err = new Error('Invalid pricing scope');
    err.statusCode = 400;
    throw err;
  }
  const nationalId = await getNationalFacilityId();
  const fees = await buildFeeRowsForKeys(nationalId, feeKeys);
  return {
    scope,
    facility_id: nationalId,
    fees: fees.map((row) => ({
      ...row,
      has_override: row.amount !== (DEFAULT_FEE_AMOUNTS[row.fee_key] ?? 0),
    })),
  };
}

async function getFeesForFacility(facilityId) {
  const facility = await Facility.findByPk(facilityId, { attributes: ['id', 'type', 'name'] });
  if (!facility) return null;

  const feeKeys = feeKeysForFacilityOverrides(facility.type);
  const fees = await buildFeeRowsForKeys(facility.id, feeKeys);

  return {
    facility_id: facility.id,
    facility_type: facility.type,
    facility_name: facility.name,
    fees,
  };
}

async function getAllFees(facilityId) {
  const payload = await getFeesForFacility(facilityId);
  if (!payload) return [];
  return payload.fees.map((row) => ({ fee_key: row.fee_key, amount: row.amount }));
}

async function upsertFee(facilityId, feeKey, amount, userId, transaction) {
  const [row] = await FacilityBillingFee.upsert({
    facility_id: facilityId,
    fee_key: feeKey,
    amount,
    updated_by: userId,
    updated_at: new Date(),
  }, { transaction });
  return row;
}

async function clearFacilityFeeOverride(facilityId, feeKey, transaction) {
  await FacilityBillingFee.destroy({
    where: { facility_id: facilityId, fee_key: feeKey },
    transaction,
  });
}

async function recordFeeChange({
  facilityId,
  feeKey,
  previousAmount,
  newAmount,
  userId,
  reason,
  transaction,
}) {
  await FacilityBillingFeeChange.create({
    id: uuidv4(),
    facility_id: facilityId,
    fee_key: feeKey,
    previous_amount: previousAmount,
    new_amount: newAmount,
    reason,
    changed_by: userId,
  }, { transaction });
}

async function updateStoredFeeWithHistory({
  facilityId,
  feeKey,
  amount,
  userId,
  reason,
  allowedKeys,
  clearOverride = false,
}) {
  const trimmedReason = String(reason ?? '').trim();
  if (!trimmedReason) {
    const err = new Error('A reason for the price change is required');
    err.statusCode = 400;
    throw err;
  }

  if (!allowedKeys.includes(feeKey)) {
    const err = new Error('This fee is not configurable here');
    err.statusCode = 400;
    throw err;
  }

  const existing = await getStoredAmount(facilityId, feeKey);
  const newAmount = clearOverride ? null : normalizeFeeValue(feeKey, amount);

  if (clearOverride) {
    if (existing == null) {
      const err = new Error('This facility is already using the national default');
      err.statusCode = 400;
      throw err;
    }
    await clearFacilityFeeOverride(facilityId, feeKey);
    const resolvedAmount = await resolveFeeAmount(facilityId, feeKey);
    await recordFeeChange({
      facilityId,
      feeKey,
      previousAmount: existing,
      newAmount: resolvedAmount,
      userId,
      reason: trimmedReason,
    });
    const rows = await buildFeeRowsForKeys(facilityId, [feeKey]);
    return rows[0];
  }

  if (newAmount == null || Number.isNaN(newAmount) || newAmount < 0) {
    const err = new Error(feeValueKind(feeKey) === 'minutes'
      ? 'Valid interval in minutes is required'
      : 'Valid amount is required');
    err.statusCode = 400;
    throw err;
  }

  if (existing != null && Math.abs(existing - newAmount) < (feeValueKind(feeKey) === 'minutes' ? 0.5 : 0.005)) {
    const err = new Error('New price is the same as the current price');
    err.statusCode = 400;
    throw err;
  }

  await upsertFee(facilityId, feeKey, newAmount, userId);

  await recordFeeChange({
    facilityId,
    feeKey,
    previousAmount: existing ?? (await resolveFeeAmount(facilityId, feeKey)),
    newAmount,
    userId,
    reason: trimmedReason,
  });

  const rows = await buildFeeRowsForKeys(facilityId, [feeKey]);
  return rows[0];
}

async function updateNationalFeeWithHistory({ scope, feeKey, amount, userId, reason }) {
  const nationalId = await getNationalFacilityId();
  return updateStoredFeeWithHistory({
    facilityId: nationalId,
    feeKey,
    amount,
    userId,
    reason,
    allowedKeys: feeKeysForNationalScope(scope),
  });
}

async function updateFacilityFeeWithHistory({ facilityId, feeKey, amount, userId, reason, useNationalDefault }) {
  const facility = await Facility.findByPk(facilityId, { attributes: ['id', 'type'] });
  if (!facility) {
    const err = new Error('Facility not found');
    err.statusCode = 404;
    throw err;
  }

  if (useNationalDefault) {
    return updateStoredFeeWithHistory({
      facilityId,
      feeKey,
      userId,
      reason,
      allowedKeys: feeKeysForFacilityOverrides(facility.type),
      clearOverride: true,
    });
  }

  return updateStoredFeeWithHistory({
    facilityId,
    feeKey,
    amount,
    userId,
    reason,
    allowedKeys: feeKeysForFacilityOverrides(facility.type),
  });
}

async function getFeeChangeHistory(facilityId, { feeKeys, limit = 100 } = {}) {
  const where = { facility_id: facilityId };
  if (feeKeys?.length) where.fee_key = feeKeys;

  const changes = await FacilityBillingFeeChange.findAll({
    where,
    include: [{
      model: User,
      as: 'changedBy',
      attributes: ['id', 'first_name', 'last_name'],
    }],
    order: [['created_at', 'DESC']],
    limit,
  });

  return changes.map((row) => ({
    id: row.id,
    fee_key: row.fee_key,
    fee_label: feeLabel(row.fee_key),
    value_kind: feeValueKind(row.fee_key),
    previous_amount: row.previous_amount != null ? parseFloat(row.previous_amount) : null,
    new_amount: parseFloat(row.new_amount),
    reason: row.reason,
    created_at: row.created_at,
    changed_by: row.changedBy
      ? `${row.changedBy.first_name} ${row.changedBy.last_name}`.trim()
      : '—',
  }));
}

async function getNationalFeeChangeHistory(scope, limit = 100) {
  const nationalId = await getNationalFacilityId();
  return getFeeChangeHistory(nationalId, {
    feeKeys: feeKeysForNationalScope(scope),
    limit,
  });
}

module.exports = {
  FEE_KEYS,
  getNationalFacilityId,
  getFeeAmount,
  getSonarBillingIntervalMinutes,
  getAllFees,
  getNationalFees,
  getFeesForFacility,
  upsertFee,
  updateNationalFeeWithHistory,
  updateFacilityFeeWithHistory,
  getFeeChangeHistory,
  getNationalFeeChangeHistory,
};
