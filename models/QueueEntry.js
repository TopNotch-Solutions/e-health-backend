'use strict';
module.exports = (sequelize, DataTypes) => {
  const QueueEntry = sequelize.define('QueueEntry', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    department: { type: DataTypes.STRING(50), allowNull: false },
    priority: { type: DataTypes.ENUM('normal', 'urgent', 'emergency'), defaultValue: 'normal' },
    status: { type: DataTypes.ENUM('waiting', 'in_progress', 'completed', 'skipped'), defaultValue: 'waiting' },
    position: { type: DataTypes.INTEGER, allowNull: false },
    assigned_to: { type: DataTypes.CHAR(36) },
    pushed_by: { type: DataTypes.CHAR(36), allowNull: false },
    notes: { type: DataTypes.TEXT },
    started_at: { type: DataTypes.DATE },
    completed_at: { type: DataTypes.DATE },
  }, {
    tableName: 'queue_entries',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  QueueEntry.associate = (models) => {
    QueueEntry.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    QueueEntry.belongsTo(models.User, { foreignKey: 'assigned_to', as: 'assignedTo' });
    QueueEntry.belongsTo(models.User, { foreignKey: 'pushed_by', as: 'pushedBy' });
  };

  return QueueEntry;
};
