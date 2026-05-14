'use strict';
module.exports = (sequelize, DataTypes) => {
  const MortuaryRecord = sequelize.define('MortuaryRecord', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    patient_id: { type: DataTypes.CHAR(36), allowNull: false },
    visit_id: { type: DataTypes.CHAR(36) },
    cause_of_death: { type: DataTypes.TEXT },
    date_of_death: { type: DataTypes.DATE, allowNull: false },
    declared_by: { type: DataTypes.CHAR(36), allowNull: false },
    body_status: { type: DataTypes.ENUM('in_mortuary', 'released', 'transferred'), defaultValue: 'in_mortuary' },
    released_to: { type: DataTypes.STRING(255) },
    released_at: { type: DataTypes.DATE },
    undertaker_name: { type: DataTypes.STRING(255) },
    undertaker_contact: { type: DataTypes.STRING(50) },
    notes: { type: DataTypes.TEXT },
  }, {
    tableName: 'mortuary_records',
    timestamps: false,
  });

  MortuaryRecord.associate = (models) => {
    MortuaryRecord.belongsTo(models.Patient, { foreignKey: 'patient_id', as: 'patient' });
    MortuaryRecord.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    MortuaryRecord.belongsTo(models.User, { foreignKey: 'declared_by', as: 'declaredBy' });
  };

  return MortuaryRecord;
};
