'use strict';

module.exports = (sequelize, DataTypes) => {
  const MaternityEpisode = sequelize.define('MaternityEpisode', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false, unique: true },
    patient_id: { type: DataTypes.CHAR(36), allowNull: false },
    current_ward: { type: DataTypes.ENUM('anw', 'pnw', 'icu'), allowNull: true },
    admitted_at: { type: DataTypes.DATE, allowNull: true },
    discharged_at: { type: DataTypes.DATE, allowNull: true },
    front_office_visits: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    anw_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    pnw_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    icu_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    feeding_counselling_done: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    six_week_follow_up_date: { type: DataTypes.DATEONLY, allowNull: true },
    status: { type: DataTypes.ENUM('active', 'discharged'), allowNull: false, defaultValue: 'active' },
  }, {
    tableName: 'maternity_episodes',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  MaternityEpisode.associate = (models) => {
    MaternityEpisode.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    MaternityEpisode.belongsTo(models.Patient, { foreignKey: 'patient_id', as: 'patient' });
    MaternityEpisode.hasMany(models.MaternityAnwDailyRecord, { foreignKey: 'episode_id', as: 'anwRecords' });
    MaternityEpisode.hasMany(models.MaternityPnwDailyRecord, { foreignKey: 'episode_id', as: 'pnwRecords' });
    MaternityEpisode.hasMany(models.MaternityIcuDailyRecord, { foreignKey: 'episode_id', as: 'icuRecords' });
  };

  return MaternityEpisode;
};
