'use strict';

module.exports = (sequelize, DataTypes) => {
  const MaternityAnwDailyRecord = sequelize.define('MaternityAnwDailyRecord', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    episode_id: { type: DataTypes.CHAR(36), allowNull: false },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    record_date: { type: DataTypes.DATEONLY, allowNull: false },
    is_admission_day: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    admission_reason: { type: DataTypes.TEXT, allowNull: true },
    mode_of_arrival: { type: DataTypes.STRING(50), allowNull: true },
    vitals: { type: DataTypes.JSON, allowNull: true },
    abdominal_update: { type: DataTypes.JSON, allowNull: true },
    active_labour: { type: DataTypes.JSON, allowNull: true },
    serial_progress: { type: DataTypes.JSON, allowNull: true },
    recorded_by: { type: DataTypes.CHAR(36), allowNull: false },
    signed_off_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'maternity_anw_daily_records',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  MaternityAnwDailyRecord.associate = (models) => {
    MaternityAnwDailyRecord.belongsTo(models.MaternityEpisode, { foreignKey: 'episode_id', as: 'episode' });
    MaternityAnwDailyRecord.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    MaternityAnwDailyRecord.belongsTo(models.User, { foreignKey: 'recorded_by', as: 'recordedBy' });
  };

  return MaternityAnwDailyRecord;
};
