'use strict';
module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    facility_id: { type: DataTypes.CHAR(36), allowNull: false },
    role_id: { type: DataTypes.INTEGER, allowNull: false },
    employee_id: { type: DataTypes.STRING(50), unique: true, allowNull: true },
    first_name: { type: DataTypes.STRING(100), allowNull: false },
    last_name: { type: DataTypes.STRING(100), allowNull: false },
    email: { type: DataTypes.STRING(255), unique: true, allowNull: false },
    password_hash: { type: DataTypes.STRING(255), allowNull: false },
    phone: { type: DataTypes.STRING(20) },
    is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    last_login: { type: DataTypes.DATE },
    created_by: { type: DataTypes.CHAR(36), allowNull: true },
  }, {
    tableName: 'users',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  User.associate = (models) => {
    User.belongsTo(models.Role, { foreignKey: 'role_id', as: 'role' });
    User.belongsTo(models.Facility, { foreignKey: 'facility_id', as: 'facility' });
    User.belongsTo(models.User, { foreignKey: 'created_by', as: 'createdBy' });
    User.hasMany(models.EmployeeFacilityAssignment, {
      foreignKey: 'user_id',
      as: 'facilityAssignments',
    });
  };

  return User;
};
