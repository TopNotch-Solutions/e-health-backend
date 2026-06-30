'use strict';

module.exports = (sequelize, DataTypes) => {
  const AdultOutpatientDailyRecord = sequelize.define('AdultOutpatientDailyRecord', {
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
    recorded_by: { type: DataTypes.CHAR(36), allowNull: false },
  }, {
    tableName: 'adult_outpatient_daily_records',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  AdultOutpatientDailyRecord.associate = (models) => {
    AdultOutpatientDailyRecord.belongsTo(models.Admission, { foreignKey: 'admission_id', as: 'admission' });
    AdultOutpatientDailyRecord.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    AdultOutpatientDailyRecord.belongsTo(models.User, { foreignKey: 'recorded_by', as: 'recordedBy' });
  };

  return AdultOutpatientDailyRecord;
};
