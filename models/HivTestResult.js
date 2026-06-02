'use strict';

module.exports = (sequelize, DataTypes) => {
  const HivTestResult = sequelize.define('HivTestResult', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    patient_id: { type: DataTypes.CHAR(36), allowNull: false },
    result: { type: DataTypes.ENUM('negative', 'positive'), allowNull: false },
    tested_by: { type: DataTypes.CHAR(36), allowNull: false },
    test_method: { type: DataTypes.STRING(100), allowNull: true },
    kit_batch: { type: DataTypes.STRING(80), allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
  }, {
    tableName: 'hiv_test_results',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  HivTestResult.associate = (models) => {
    HivTestResult.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    HivTestResult.belongsTo(models.Patient, { foreignKey: 'patient_id', as: 'patient' });
    HivTestResult.belongsTo(models.User, { foreignKey: 'tested_by', as: 'testedBy' });
    HivTestResult.hasOne(models.ArtEpisode, { foreignKey: 'hiv_test_result_id', as: 'artEpisode' });
  };

  return HivTestResult;
};
