'use strict';
module.exports = (sequelize, DataTypes) => {
  const AuditLog = sequelize.define('AuditLog', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.CHAR(36), allowNull: false },
    action: { type: DataTypes.STRING(50), allowNull: false },
    resource: { type: DataTypes.STRING(50), allowNull: false },
    resource_id: { type: DataTypes.CHAR(36) },
    details: { type: DataTypes.JSON },
    ip_address: { type: DataTypes.STRING(45) },
  }, {
    tableName: 'audit_logs',
    timestamps: true,
    createdAt: 'timestamp',
    updatedAt: false,
    indexes: [
      { fields: ['user_id'] },
      { fields: ['resource', 'resource_id'] },
      { fields: ['timestamp'] },
    ],
  });

  AuditLog.associate = (models) => {
    AuditLog.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
  };

  return AuditLog;
};
