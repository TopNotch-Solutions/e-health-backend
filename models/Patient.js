'use strict';
module.exports = (sequelize, DataTypes) => {
  const Patient = sequelize.define('Patient', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    patient_number: { type: DataTypes.STRING(20), unique: true, allowNull: false },
    category: { type: DataTypes.ENUM('known', 'unknown', 'returning'), allowNull: false },
    payment_type: { type: DataTypes.ENUM('state', 'private'), defaultValue: 'state' },
    first_name: { type: DataTypes.STRING(100) },
    last_name: { type: DataTypes.STRING(100) },
    sex: { type: DataTypes.ENUM('male', 'female', 'other') },
    date_of_birth: { type: DataTypes.DATEONLY },
    id_number: { type: DataTypes.STRING(20) },
    phone: { type: DataTypes.STRING(20) },
    address: { type: DataTypes.TEXT },
    emergency_contact_name: { type: DataTypes.STRING(100) },
    emergency_contact_phone: { type: DataTypes.STRING(20) },
    is_emergency: { type: DataTypes.BOOLEAN, defaultValue: false },
    temp_id: { type: DataTypes.STRING(20) },
  }, {
    tableName: 'patients',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  Patient.associate = (models) => {
    Patient.hasMany(models.Visit, { foreignKey: 'patient_id', as: 'visits' });
    Patient.hasMany(models.HivTestResult, { foreignKey: 'patient_id', as: 'hivTestResults' });
    Patient.hasMany(models.ArtEpisode, { foreignKey: 'patient_id', as: 'artEpisodes' });
  };

  return Patient;
};
