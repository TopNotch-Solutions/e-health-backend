'use strict';

module.exports = (sequelize, DataTypes) => {
  const PrepEpisode = sequelize.define('PrepEpisode', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    patient_id: { type: DataTypes.CHAR(36), allowNull: false },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    hiv_test_result_id: { type: DataTypes.CHAR(36), allowNull: true },
    enrolled_by: { type: DataTypes.CHAR(36), allowNull: false },
    administered_by: { type: DataTypes.CHAR(36), allowNull: true },
    status: {
      type: DataTypes.ENUM('active', 'completed'),
      allowNull: false,
      defaultValue: 'active',
    },
    injection_administered: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    session_data: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    enrolled_at: { type: DataTypes.DATE, allowNull: false },
    injection_administered_at: { type: DataTypes.DATE, allowNull: true },
    completed_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'prep_episodes',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  PrepEpisode.associate = (models) => {
    PrepEpisode.belongsTo(models.Patient, { foreignKey: 'patient_id', as: 'patient' });
    PrepEpisode.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    PrepEpisode.belongsTo(models.HivTestResult, { foreignKey: 'hiv_test_result_id', as: 'hivTestResult' });
    PrepEpisode.belongsTo(models.User, { foreignKey: 'enrolled_by', as: 'enrolledBy' });
    PrepEpisode.belongsTo(models.User, { foreignKey: 'administered_by', as: 'administeredBy' });
  };

  return PrepEpisode;
};
