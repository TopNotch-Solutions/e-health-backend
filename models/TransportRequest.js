'use strict';
module.exports = (sequelize, DataTypes) => {
  const TransportRequest = sequelize.define('TransportRequest', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    from_location: { type: DataTypes.STRING(100), allowNull: false },
    to_location: { type: DataTypes.STRING(100), allowNull: false },
    equipment_required: { type: DataTypes.ENUM('wheelchair', 'stretcher', 'bed', 'walking', 'other'), allowNull: false },
    equipment_notes: { type: DataTypes.STRING(255) },
    priority: { type: DataTypes.ENUM('normal', 'urgent', 'emergency'), defaultValue: 'normal' },
    status: { type: DataTypes.ENUM('pending', 'in_transit', 'completed'), defaultValue: 'pending' },
    assigned_porter: { type: DataTypes.CHAR(36) },
    requested_by: { type: DataTypes.CHAR(36), allowNull: false },
    requested_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    started_at: { type: DataTypes.DATE },
    completed_at: { type: DataTypes.DATE },
  }, {
    tableName: 'transport_requests',
    timestamps: false,
  });

  TransportRequest.associate = (models) => {
    TransportRequest.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    TransportRequest.belongsTo(models.User, { foreignKey: 'assigned_porter', as: 'porter' });
    TransportRequest.belongsTo(models.User, { foreignKey: 'requested_by', as: 'requestedBy' });
  };

  return TransportRequest;
};
