'use strict';
module.exports = (sequelize, DataTypes) => {
  const RevenueShift = sequelize.define('RevenueShift', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    billing_clerk_id: { type: DataTypes.CHAR(36), allowNull: false },
    shift_start: { type: DataTypes.DATE, allowNull: false },
    shift_end: { type: DataTypes.DATE },
    expected_amount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0.00 },
    collected_amount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0.00 },
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
