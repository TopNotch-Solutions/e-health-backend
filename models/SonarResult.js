'use strict';
module.exports = (sequelize, DataTypes) => {
  const SonarResult = sequelize.define('SonarResult', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    sonar_request_id: { type: DataTypes.CHAR(36), allowNull: false },
    performed_by: { type: DataTypes.CHAR(36), allowNull: false },
    findings: { type: DataTypes.TEXT },
    impression: { type: DataTypes.TEXT },
    images: { type: DataTypes.JSON },
    report: { type: DataTypes.TEXT },
  }, {
    tableName: 'sonar_results',
    timestamps: true,
    createdAt: 'completed_at',
    updatedAt: false,
  });

  SonarResult.associate = (models) => {
    SonarResult.belongsTo(models.SonarRequest, { foreignKey: 'sonar_request_id', as: 'sonarRequest' });
    SonarResult.belongsTo(models.User, { foreignKey: 'performed_by', as: 'performedBy' });
  };

  return SonarResult;
};
