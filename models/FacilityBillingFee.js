'use strict';

module.exports = (sequelize, DataTypes) => {
  const FacilityBillingFee = sequelize.define(
    'FacilityBillingFee',
    {
      facility_id: { type: DataTypes.CHAR(36), primaryKey: true },
      fee_key: { type: DataTypes.STRING(50), primaryKey: true },
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      updated_by: { type: DataTypes.CHAR(36) },
    },
    {
      tableName: 'facility_billing_fees',
      timestamps: true,
      createdAt: false,
      updatedAt: 'updated_at',
    }
  );

  FacilityBillingFee.associate = (models) => {
    FacilityBillingFee.belongsTo(models.Facility, { foreignKey: 'facility_id', as: 'facility' });
    FacilityBillingFee.belongsTo(models.User, { foreignKey: 'updated_by', as: 'updatedBy' });
  };

  return FacilityBillingFee;
};
