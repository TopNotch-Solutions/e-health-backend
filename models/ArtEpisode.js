'use strict';

module.exports = (sequelize, DataTypes) => {
  const ArtEpisode = sequelize.define('ArtEpisode', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    patient_id: { type: DataTypes.CHAR(36), allowNull: false },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    hiv_test_result_id: { type: DataTypes.CHAR(36), allowNull: true },
    enrolled_by: { type: DataTypes.CHAR(36), allowNull: false },
    pathway_state: {
      type: DataTypes.ENUM('day_1', 'week_1', 'month_1', 'month_3_6', 'maintenance'),
      allowNull: false,
      defaultValue: 'day_1',
    },
    state_entered_at: { type: DataTypes.DATE, allowNull: false },
    enrolled_at: { type: DataTypes.DATE, allowNull: false },
    status: {
      type: DataTypes.ENUM('active', 'transferred', 'closed'),
      allowNull: false,
      defaultValue: 'active',
    },
    pathway_data: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  }, {
    tableName: 'art_episodes',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  ArtEpisode.associate = (models) => {
    ArtEpisode.belongsTo(models.Patient, { foreignKey: 'patient_id', as: 'patient' });
    ArtEpisode.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    ArtEpisode.belongsTo(models.HivTestResult, { foreignKey: 'hiv_test_result_id', as: 'hivTestResult' });
    ArtEpisode.belongsTo(models.User, { foreignKey: 'enrolled_by', as: 'enrolledBy' });
  };

  return ArtEpisode;
};
