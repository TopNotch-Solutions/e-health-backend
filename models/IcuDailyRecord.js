'use strict';

module.exports = (sequelize, DataTypes) => {
  const IcuDailyRecord = sequelize.define('IcuDailyRecord', {
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
    ventilator_pressures_volumes: { type: DataTypes.TEXT, allowNull: true },
    urine_output: { type: DataTypes.STRING(120), allowNull: true },
    arterial_blood_gases: { type: DataTypes.TEXT, allowNull: true },
    neurological_checks: { type: DataTypes.TEXT, allowNull: true },
    recorded_by: { type: DataTypes.CHAR(36), allowNull: false },
  }, {
    tableName: 'icu_daily_records',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  IcuDailyRecord.associate = (models) => {
    IcuDailyRecord.belongsTo(models.Admission, { foreignKey: 'admission_id', as: 'admission' });
    IcuDailyRecord.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    IcuDailyRecord.belongsTo(models.User, { foreignKey: 'recorded_by', as: 'recordedBy' });
  };

  return IcuDailyRecord;
};
