'use strict';

module.exports = (sequelize, DataTypes) => {
  const FacilityDepartmentChange = sequelize.define('FacilityDepartmentChange', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    facility_id: { type: DataTypes.CHAR(36), allowNull: false },
    department_key: { type: DataTypes.STRING(50), allowNull: false },
    action: { type: DataTypes.ENUM('added', 'removed'), allowNull: false },
    reason: { type: DataTypes.TEXT, allowNull: false },
    changed_by: { type: DataTypes.CHAR(36), allowNull: false },
  }, {
    tableName: 'facility_department_changes',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  FacilityDepartmentChange.associate = (models) => {
    FacilityDepartmentChange.belongsTo(models.Facility, { foreignKey: 'facility_id', as: 'facility' });
    FacilityDepartmentChange.belongsTo(models.User, { foreignKey: 'changed_by', as: 'changedBy' });
  };

  return FacilityDepartmentChange;
};
