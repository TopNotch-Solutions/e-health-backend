'use strict';

module.exports = (sequelize, DataTypes) => {
  const PediatricAssessment = sequelize.define('PediatricAssessment', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    patient_id: { type: DataTypes.CHAR(36), allowNull: false },
    assessed_by: { type: DataTypes.CHAR(36), allowNull: false },
    temperature: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
    weight: { type: DataTypes.DECIMAL(7, 2), allowNull: false },
    general_assessment: { type: DataTypes.TEXT, allowNull: false },
    assessment_saved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    assessment_saved_at: { type: DataTypes.DATE, allowNull: true },
    routed_to_master_doctor_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'pediatric_assessments',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  PediatricAssessment.associate = (models) => {
    PediatricAssessment.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    PediatricAssessment.belongsTo(models.Patient, { foreignKey: 'patient_id', as: 'patient' });
    PediatricAssessment.belongsTo(models.User, { foreignKey: 'assessed_by', as: 'assessedBy' });
  };

  return PediatricAssessment;
};
