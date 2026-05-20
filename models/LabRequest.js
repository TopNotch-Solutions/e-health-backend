'use strict';
module.exports = (sequelize, DataTypes) => {
  const LabRequest = sequelize.define('LabRequest', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    requested_by: { type: DataTypes.CHAR(36), allowNull: false },
    test_type: { type: DataTypes.STRING(100), allowNull: false },
    clinical_notes: { type: DataTypes.TEXT },
    blood_details: { type: DataTypes.TEXT },
    nurse_id: { type: DataTypes.CHAR(36) },
    is_emergency: { type: DataTypes.BOOLEAN, defaultValue: false },
    tests: { type: DataTypes.JSON },
    queue_entry_id: { type: DataTypes.CHAR(36) },
    status: { type: DataTypes.ENUM('pending_sample', 'sample_collected', 'processing', 'completed'), defaultValue: 'pending_sample' },
  }, {
    tableName: 'lab_requests',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  LabRequest.associate = (models) => {
    LabRequest.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    LabRequest.belongsTo(models.User, { foreignKey: 'requested_by', as: 'requestedBy' });
    LabRequest.belongsTo(models.User, { foreignKey: 'nurse_id', as: 'nurse' });
    LabRequest.hasOne(models.LabResult, { foreignKey: 'lab_request_id', as: 'result' });
  };

  return LabRequest;
};
