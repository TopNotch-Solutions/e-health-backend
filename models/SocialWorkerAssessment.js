'use strict';

module.exports = (sequelize, DataTypes) => {
  const SocialWorkerAssessment = sequelize.define('SocialWorkerAssessment', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    patient_id: { type: DataTypes.CHAR(36), allowNull: false },
    assessed_by: { type: DataTypes.CHAR(36), allowNull: false },
    social_assessment_details: { type: DataTypes.TEXT, allowNull: false },
    case_history: { type: DataTypes.TEXT, allowNull: false },
    clinical_notes: { type: DataTypes.TEXT, allowNull: false },
    severity: { type: DataTypes.ENUM('routine', 'severe'), allowNull: false },
    assessment_saved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    assessment_saved_at: { type: DataTypes.DATE, allowNull: true },
    escalated_to_booking_at: { type: DataTypes.DATE, allowNull: true },
    session_completed_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'social_worker_assessments',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  SocialWorkerAssessment.associate = (models) => {
    SocialWorkerAssessment.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    SocialWorkerAssessment.belongsTo(models.Patient, { foreignKey: 'patient_id', as: 'patient' });
    SocialWorkerAssessment.belongsTo(models.User, { foreignKey: 'assessed_by', as: 'assessedBy' });
  };

  return SocialWorkerAssessment;
};
