'use strict';

module.exports = (sequelize, DataTypes) => {
  const FacilityBillingFeeChange = sequelize.define('FacilityBillingFeeChange', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    facility_id: { type: DataTypes.CHAR(36), allowNull: false },
    fee_key: { type: DataTypes.STRING(50), allowNull: false },
    previous_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    new_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    reason: { type: DataTypes.TEXT, allowNull: false },
    changed_by: { type: DataTypes.CHAR(36), allowNull: false },
  }, {
    tableName: 'facility_billing_fee_changes',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  FacilityBillingFeeChange.associate = (models) => {
    FacilityBillingFeeChange.belongsTo(models.Facility, { foreignKey: 'facility_id', as: 'facility' });
    FacilityBillingFeeChange.belongsTo(models.User, { foreignKey: 'changed_by', as: 'changedBy' });
  };

  return FacilityBillingFeeChange;
};
