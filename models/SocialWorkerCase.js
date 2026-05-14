'use strict';
module.exports = (sequelize, DataTypes) => {
  const SocialWorkerCase = sequelize.define('SocialWorkerCase', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    patient_id: { type: DataTypes.CHAR(36), allowNull: false },
    visit_id: { type: DataTypes.CHAR(36) },
    assigned_to: { type: DataTypes.CHAR(36), allowNull: false },
    case_type: { type: DataTypes.ENUM('unknown_patient_id', 'government_assistance', 'family_tracing', 'abuse', 'other'), allowNull: false },
    status: { type: DataTypes.ENUM('open', 'in_progress', 'resolved', 'closed'), defaultValue: 'open' },
    notes: { type: DataTypes.TEXT },
    resolved_at: { type: DataTypes.DATE },
  }, {
    tableName: 'social_worker_cases',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  SocialWorkerCase.associate = (models) => {
    SocialWorkerCase.belongsTo(models.Patient, { foreignKey: 'patient_id', as: 'patient' });
    SocialWorkerCase.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    SocialWorkerCase.belongsTo(models.User, { foreignKey: 'assigned_to', as: 'assignedTo' });
  };

  return SocialWorkerCase;
};
