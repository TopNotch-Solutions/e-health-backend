'use strict';
module.exports = (sequelize, DataTypes) => {
  const SonarRequest = sequelize.define('SonarRequest', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    requested_by: { type: DataTypes.CHAR(36), allowNull: false },
    scan_type: { type: DataTypes.STRING(100), allowNull: false },
    clinical_notes: { type: DataTypes.TEXT },
    status: { type: DataTypes.ENUM('pending', 'in_progress', 'completed'), defaultValue: 'pending' },
  }, {
    tableName: 'sonar_requests',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  SonarRequest.associate = (models) => {
    SonarRequest.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    SonarRequest.belongsTo(models.User, { foreignKey: 'requested_by', as: 'requestedBy' });
    SonarRequest.hasOne(models.SonarResult, { foreignKey: 'sonar_request_id', as: 'result' });
  };

  return SonarRequest;
};
