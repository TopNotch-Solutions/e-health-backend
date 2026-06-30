'use strict';

module.exports = (sequelize, DataTypes) => {
  const SurgicalComplexDailyRecord = sequelize.define('SurgicalComplexDailyRecord', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    admission_id: { type: DataTypes.CHAR(36), allowNull: false },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    record_date: { type: DataTypes.DATEONLY, allowNull: false },
    heart_rate: { type: DataTypes.INTEGER, allowNull: true },
    oxygen_saturation: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
    respiration_rate: { type: DataTypes.INTEGER, allowNull: true },
    body_temperature: { type: DataTypes.DECIMAL(4, 1), allowNull: true },
    blood_pressure_systolic: { type: DataTypes.INTEGER, allowNull: true },
    blood_pressure_diastolic: { type: DataTypes.INTEGER, allowNull: true },
    pulse_oximetry_spo2: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
    capnography_etco2: { type: DataTypes.STRING(120), allowNull: true },
    fio2: { type: DataTypes.STRING(80), allowNull: true },
    anesthesia_neuro_monitoring: { type: DataTypes.TEXT, allowNull: true },
    neuromuscular_tof: { type: DataTypes.STRING(120), allowNull: true },
    pain_sedation_scores: { type: DataTypes.TEXT, allowNull: true },
    recorded_by: { type: DataTypes.CHAR(36), allowNull: false },
  }, {
    tableName: 'surgical_complex_daily_records',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  SurgicalComplexDailyRecord.associate = (models) => {
    SurgicalComplexDailyRecord.belongsTo(models.Admission, { foreignKey: 'admission_id', as: 'admission' });
    SurgicalComplexDailyRecord.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    SurgicalComplexDailyRecord.belongsTo(models.User, { foreignKey: 'recorded_by', as: 'recordedBy' });
  };

  return SurgicalComplexDailyRecord;
};
