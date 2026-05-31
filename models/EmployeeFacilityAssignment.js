'use strict';

module.exports = (sequelize, DataTypes) => {
  const EmployeeFacilityAssignment = sequelize.define('EmployeeFacilityAssignment', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    user_id: { type: DataTypes.CHAR(36), allowNull: false },
    facility_id: { type: DataTypes.CHAR(36), allowNull: false },
    role_id: { type: DataTypes.INTEGER, allowNull: false },
    started_at: { type: DataTypes.DATE, allowNull: false },
    ended_at: { type: DataTypes.DATE, allowNull: true },
    transferred_by: { type: DataTypes.CHAR(36), allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
  }, {
    tableName: 'employee_facility_assignments',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  EmployeeFacilityAssignment.associate = (models) => {
    EmployeeFacilityAssignment.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    EmployeeFacilityAssignment.belongsTo(models.Facility, { foreignKey: 'facility_id', as: 'facility' });
    EmployeeFacilityAssignment.belongsTo(models.Role, { foreignKey: 'role_id', as: 'role' });
    EmployeeFacilityAssignment.belongsTo(models.User, {
      foreignKey: 'transferred_by',
      as: 'transferredBy',
    });
  };

  return EmployeeFacilityAssignment;
};
