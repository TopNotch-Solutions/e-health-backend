'use strict';

module.exports = (sequelize, DataTypes) => {
  const MaternityNicuRecord = sequelize.define('MaternityNicuRecord', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    mother_patient_id: { type: DataTypes.CHAR(36), allowNull: false },
    mother_visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    child_patient_id: { type: DataTypes.CHAR(36), allowNull: true },
    date_time_of_birth: { type: DataTypes.DATE, allowNull: false },
    sex: { type: DataTypes.ENUM('male', 'female', 'other'), allowNull: false },
    name: { type: DataTypes.STRING(150), allowNull: true },
    gestation_weeks: { type: DataTypes.INTEGER, allowNull: true },
    clinical_status: { type: DataTypes.JSON, allowNull: true },
    apgar_matrix: { type: DataTypes.JSON, allowNull: true },
    recorded_by: { type: DataTypes.CHAR(36), allowNull: false },
  }, {
    tableName: 'maternity_nicu_records',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  MaternityNicuRecord.associate = (models) => {
    MaternityNicuRecord.belongsTo(models.Patient, { foreignKey: 'mother_patient_id', as: 'mother' });
    MaternityNicuRecord.belongsTo(models.Patient, { foreignKey: 'child_patient_id', as: 'child' });
    MaternityNicuRecord.belongsTo(models.Visit, { foreignKey: 'mother_visit_id', as: 'motherVisit' });
    MaternityNicuRecord.belongsTo(models.User, { foreignKey: 'recorded_by', as: 'recordedBy' });
  };

  return MaternityNicuRecord;
};
