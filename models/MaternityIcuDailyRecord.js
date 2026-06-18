'use strict';

module.exports = (sequelize, DataTypes) => {
  const MaternityIcuDailyRecord = sequelize.define('MaternityIcuDailyRecord', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    episode_id: { type: DataTypes.CHAR(36), allowNull: false },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    record_date: { type: DataTypes.DATEONLY, allowNull: false },
    extreme_indicators: { type: DataTypes.JSON, allowNull: true },
    continuous_parameters: { type: DataTypes.JSON, allowNull: true },
    multiple_origin_tracking: { type: DataTypes.JSON, allowNull: true },
    recorded_by: { type: DataTypes.CHAR(36), allowNull: false },
    signed_off_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'maternity_icu_daily_records',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  MaternityIcuDailyRecord.associate = (models) => {
    MaternityIcuDailyRecord.belongsTo(models.MaternityEpisode, { foreignKey: 'episode_id', as: 'episode' });
    MaternityIcuDailyRecord.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    MaternityIcuDailyRecord.belongsTo(models.User, { foreignKey: 'recorded_by', as: 'recordedBy' });
  };

  return MaternityIcuDailyRecord;
};
