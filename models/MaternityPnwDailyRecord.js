'use strict';

module.exports = (sequelize, DataTypes) => {
  const MaternityPnwDailyRecord = sequelize.define('MaternityPnwDailyRecord', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    episode_id: { type: DataTypes.CHAR(36), allowNull: false },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    record_date: { type: DataTypes.DATEONLY, allowNull: false },
    is_post_delivery_day: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    delivery_type: { type: DataTypes.STRING(100), allowNull: true },
    post_op_recovery: { type: DataTypes.TEXT, allowNull: true },
    vitals: { type: DataTypes.JSON, allowNull: true },
    uterine_index: { type: DataTypes.JSON, allowNull: true },
    physiological_output: { type: DataTypes.JSON, allowNull: true },
    breast_examination: { type: DataTypes.JSON, allowNull: true },
    recorded_by: { type: DataTypes.CHAR(36), allowNull: false },
    signed_off_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'maternity_pnw_daily_records',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  MaternityPnwDailyRecord.associate = (models) => {
    MaternityPnwDailyRecord.belongsTo(models.MaternityEpisode, { foreignKey: 'episode_id', as: 'episode' });
    MaternityPnwDailyRecord.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    MaternityPnwDailyRecord.belongsTo(models.User, { foreignKey: 'recorded_by', as: 'recordedBy' });
  };

  return MaternityPnwDailyRecord;
};
