'use strict';
module.exports = (sequelize, DataTypes) => {
  const SonarRequest = sequelize.define('SonarRequest', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    requested_by: { type: DataTypes.CHAR(36), allowNull: false },
    scan_type: { type: DataTypes.STRING(100), allowNull: false },
    symptoms: { type: DataTypes.TEXT },
    clinical_notes: { type: DataTypes.TEXT },
    diagnostic_questions: { type: DataTypes.TEXT },
    prep_instructions: { type: DataTypes.TEXT },
    imaging_notes: { type: DataTypes.TEXT },
    is_emergency: { type: DataTypes.BOOLEAN, defaultValue: false },
    queue_entry_id: { type: DataTypes.CHAR(36) },
    status: {
      type: DataTypes.ENUM('pending', 'in_progress', 'awaiting_report', 'completed'),
      defaultValue: 'pending',
    },
    started_at: { type: DataTypes.DATE },
    completed_at: { type: DataTypes.DATE },
  }, {
    tableName: 'sonar_requests',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  SonarRequest.associate = (models) => {
    SonarRequest.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    SonarRequest.belongsTo(models.User, { foreignKey: 'requested_by', as: 'requestedBy' });
    SonarRequest.belongsTo(models.QueueEntry, { foreignKey: 'queue_entry_id', as: 'queueEntry' });
    SonarRequest.hasOne(models.SonarResult, { foreignKey: 'sonar_request_id', as: 'result' });
  };

  return SonarRequest;
};
