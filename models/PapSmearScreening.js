'use strict';

module.exports = (sequelize, DataTypes) => {
  const PapSmearScreening = sequelize.define('PapSmearScreening', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    patient_id: { type: DataTypes.CHAR(36), allowNull: false },
    screened_by: { type: DataTypes.CHAR(36), allowNull: false },
    screening_details: { type: DataTypes.TEXT, allowNull: false },
    test_observations: { type: DataTypes.TEXT, allowNull: false },
    clinical_findings: { type: DataTypes.TEXT, allowNull: false },
    severity: {
      type: DataTypes.ENUM('routine', 'severe'),
      allowNull: false,
    },
    findings_saved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    findings_saved_at: { type: DataTypes.DATE, allowNull: true },
    escalated_to_master_doctor_at: { type: DataTypes.DATE, allowNull: true },
    session_completed_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'pap_smear_screenings',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  PapSmearScreening.associate = (models) => {
    PapSmearScreening.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    PapSmearScreening.belongsTo(models.Patient, { foreignKey: 'patient_id', as: 'patient' });
    PapSmearScreening.belongsTo(models.User, { foreignKey: 'screened_by', as: 'screenedBy' });
  };

  return PapSmearScreening;
};
