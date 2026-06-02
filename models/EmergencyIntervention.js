'use strict';

module.exports = (sequelize, DataTypes) => {
  const EmergencyIntervention = sequelize.define('EmergencyIntervention', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    recorded_by: { type: DataTypes.CHAR(36), allowNull: false },
    interventions: { type: DataTypes.TEXT, allowNull: false },
    notes: { type: DataTypes.TEXT, allowNull: true },
  }, {
    tableName: 'emergency_interventions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  EmergencyIntervention.associate = (models) => {
    EmergencyIntervention.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    EmergencyIntervention.belongsTo(models.User, { foreignKey: 'recorded_by', as: 'recordedBy' });
  };

  return EmergencyIntervention;
};
