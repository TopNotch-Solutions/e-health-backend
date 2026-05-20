'use strict';
module.exports = (sequelize, DataTypes) => {
  const Permission = sequelize.define('Permission', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    resource: { type: DataTypes.STRING(50), allowNull: false },
    action: { type: DataTypes.STRING(20), allowNull: false },
  }, {
    tableName: 'permissions',
    timestamps: false,
    indexes: [{ unique: true, fields: ['resource', 'action'] }],
  });

  Permission.associate = (models) => {
    Permission.belongsToMany(models.Role, {
      through: 'role_permissions',
      foreignKey: 'permission_id',
      otherKey: 'role_id',
      timestamps: false,
    });
  };

  return Permission;
};
