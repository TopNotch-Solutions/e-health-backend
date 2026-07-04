'use strict';
module.exports = (sequelize, DataTypes) => {
  const Facility = sequelize.define('Facility', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    type: { type: DataTypes.ENUM('hospital', 'clinic', 'health_center'), allowNull: false },
    province: { type: DataTypes.STRING(100) },
    district: { type: DataTypes.STRING(100) },
    address: { type: DataTypes.TEXT },
    phone: { type: DataTypes.STRING(20) },
  }, {
    tableName: 'facilities',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  Facility.associate = (models) => {
    Facility.hasMany(models.User, { foreignKey: 'facility_id' });
    Facility.hasMany(models.Ward, { foreignKey: 'facility_id' });
    Facility.hasMany(models.FacilityDepartment, { foreignKey: 'facility_id', as: 'departments' });
    Facility.hasMany(models.FacilityDepartmentChange, { foreignKey: 'facility_id', as: 'departmentChanges' });
    Facility.hasMany(models.FacilityBillingFeeChange, { foreignKey: 'facility_id', as: 'billingFeeChanges' });
  };

  return Facility;
};
