'use strict';

module.exports = (sequelize, DataTypes) => {
  const DermatologyAssessment = sequelize.define('DermatologyAssessment', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    patient_id: { type: DataTypes.CHAR(36), allowNull: false },
    assessed_by: { type: DataTypes.CHAR(36), allowNull: false },
    clinical_observations: { type: DataTypes.TEXT, allowNull: false },
    skin_assessment: { type: DataTypes.TEXT, allowNull: false },
    differential_diagnosis: { type: DataTypes.TEXT, allowNull: true },
    treatment_plan: { type: DataTypes.TEXT, allowNull: true },
    observations_saved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    observations_saved_at: { type: DataTypes.DATE, allowNull: true },
    routed_to_pharmacy_at: { type: DataTypes.DATE, allowNull: true },
    routed_to_booking_at: { type: DataTypes.DATE, allowNull: true },
    session_completed_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'dermatology_assessments',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  DermatologyAssessment.associate = (models) => {
    DermatologyAssessment.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    DermatologyAssessment.belongsTo(models.Patient, { foreignKey: 'patient_id', as: 'patient' });
    DermatologyAssessment.belongsTo(models.User, { foreignKey: 'assessed_by', as: 'assessedBy' });
  };

  return DermatologyAssessment;
};
