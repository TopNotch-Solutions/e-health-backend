'use strict';

module.exports = (sequelize, DataTypes) => {
  const FacilityDepartment = sequelize.define('FacilityDepartment', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    facility_id: { type: DataTypes.CHAR(36), allowNull: false },
    department_key: { type: DataTypes.STRING(50), allowNull: false },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }, {
    tableName: 'facility_departments',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  FacilityDepartment.associate = (models) => {
    FacilityDepartment.belongsTo(models.Facility, { foreignKey: 'facility_id', as: 'facility' });
  };

  return FacilityDepartment;
};
