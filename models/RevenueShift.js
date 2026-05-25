'use strict';
module.exports = (sequelize, DataTypes) => {
  const RevenueShift = sequelize.define('RevenueShift', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    billing_clerk_id: { type: DataTypes.CHAR(36), allowNull: false },
    shift_slot: { type: DataTypes.ENUM('day', 'night') },
    shift_start: { type: DataTypes.DATE, allowNull: false },
    shift_end: { type: DataTypes.DATE },
    facility_id: { type: DataTypes.CHAR(36) },
    expected_amount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0.00 },
    expected_cash: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0.00 },
    expected_eft: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0.00 },
    collected_amount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0.00 },
    verified_cash: { type: DataTypes.DECIMAL(12, 2) },
    cash_deficit: { type: DataTypes.DECIMAL(12, 2) },
    status: { type: DataTypes.ENUM('open', 'closed', 'reconciled', 'discrepancy'), defaultValue: 'open' },
    reconciled_by: { type: DataTypes.CHAR(36) },
    notes: { type: DataTypes.TEXT },
  }, {
    tableName: 'revenue_shifts',
    timestamps: false,
  });

  RevenueShift.associate = (models) => {
    RevenueShift.belongsTo(models.User, { foreignKey: 'billing_clerk_id', as: 'billingClerk' });
    RevenueShift.belongsTo(models.User, { foreignKey: 'reconciled_by', as: 'reconciledBy' });
  };

  return RevenueShift;
};
