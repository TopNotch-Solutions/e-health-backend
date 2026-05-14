'use strict';
module.exports = (sequelize, DataTypes) => {
  const LabResult = sequelize.define('LabResult', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    lab_request_id: { type: DataTypes.CHAR(36), allowNull: false },
    processed_by: { type: DataTypes.CHAR(36), allowNull: false },
    results: { type: DataTypes.TEXT, allowNull: false },
    result_data: { type: DataTypes.JSON },
    attachments: { type: DataTypes.JSON },
  }, {
    tableName: 'lab_results',
    timestamps: true,
    createdAt: 'completed_at',
    updatedAt: false,
  });

  LabResult.associate = (models) => {
    LabResult.belongsTo(models.LabRequest, { foreignKey: 'lab_request_id', as: 'labRequest' });
    LabResult.belongsTo(models.User, { foreignKey: 'processed_by', as: 'processedBy' });
  };

  return LabResult;
};
