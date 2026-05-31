'use strict';

module.exports = (sequelize, DataTypes) => {
  const ScreeningAssessment = sequelize.define('ScreeningAssessment', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    recorded_by: { type: DataTypes.CHAR(36), allowNull: false },
    symptoms: { type: DataTypes.TEXT, allowNull: false },
    reason: { type: DataTypes.TEXT, allowNull: false },
    diagnosis: { type: DataTypes.TEXT, allowNull: false },
    notes: { type: DataTypes.TEXT },
  }, {
    tableName: 'screening_assessments',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  ScreeningAssessment.associate = (models) => {
    ScreeningAssessment.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    ScreeningAssessment.belongsTo(models.User, { foreignKey: 'recorded_by', as: 'recordedBy' });
  };

  return ScreeningAssessment;
};
