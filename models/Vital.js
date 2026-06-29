'use strict';
module.exports = (sequelize, DataTypes) => {
  const Vital = sequelize.define('Vital', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    recorded_by: { type: DataTypes.CHAR(36), allowNull: false },
    temperature: { type: DataTypes.DECIMAL(4, 1) },
    blood_pressure_systolic: { type: DataTypes.INTEGER },
    blood_pressure_diastolic: { type: DataTypes.INTEGER },
    pulse_rate: { type: DataTypes.INTEGER },
    respiratory_rate: { type: DataTypes.INTEGER },
    weight: { type: DataTypes.DECIMAL(5, 2) },
    height: { type: DataTypes.DECIMAL(5, 2) },
    oxygen_saturation: { type: DataTypes.DECIMAL(4, 1) },
    gcs_score: { type: DataTypes.INTEGER },
    pain_score: { type: DataTypes.INTEGER },
    blood_glucose: { type: DataTypes.DECIMAL(5, 2) },
    pupillary_check: { type: DataTypes.STRING(100) },
    allergies: { type: DataTypes.TEXT },
    accompanied_by: { type: DataTypes.STRING(200) },
    chief_complaint: { type: DataTypes.TEXT },
    onset_at: { type: DataTypes.DATE },
    aggravating_factors: { type: DataTypes.TEXT },
    alleviating_factors: { type: DataTypes.TEXT },
    current_medications: { type: DataTypes.TEXT },
    immunization_status: { type: DataTypes.STRING(100) },
    social_history: { type: DataTypes.TEXT },
    physical_examination: { type: DataTypes.TEXT },
    notes: { type: DataTypes.TEXT },
    visit_classification: { type: DataTypes.ENUM('follow_up', 'sick') },
  }, {
    tableName: 'vitals',
    timestamps: true,
    createdAt: 'recorded_at',
    updatedAt: false,
  });

  Vital.associate = (models) => {
    Vital.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    Vital.belongsTo(models.User, { foreignKey: 'recorded_by', as: 'recordedBy' });
  };

  return Vital;
};
