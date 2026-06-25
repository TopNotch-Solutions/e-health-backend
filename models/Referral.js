'use strict';
module.exports = (sequelize, DataTypes) => {
  const Referral = sequelize.define('Referral', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    referred_by: { type: DataTypes.CHAR(36), allowNull: false },
    referral_type: { type: DataTypes.ENUM('pharmacy_unavailable', 'external_facility', 'specialist', 'follow_up'), allowNull: false },
    reason: { type: DataTypes.TEXT },
    destination: { type: DataTypes.STRING(255) },
    destination_facility_id: { type: DataTypes.CHAR(36) },
    destination_department: { type: DataTypes.STRING(80) },
    clinic_hospital_transfer_id: { type: DataTypes.CHAR(36) },
    status: { type: DataTypes.ENUM('pending', 'accepted', 'completed'), defaultValue: 'pending' },
    follow_up_date: { type: DataTypes.DATEONLY },
  }, {
    tableName: 'referrals',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  Referral.associate = (models) => {
    Referral.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    Referral.belongsTo(models.User, { foreignKey: 'referred_by', as: 'referredBy' });
  };

  return Referral;
};
