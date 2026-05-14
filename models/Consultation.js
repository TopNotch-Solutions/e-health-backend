'use strict';
module.exports = (sequelize, DataTypes) => {
  const Consultation = sequelize.define('Consultation', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    doctor_id: { type: DataTypes.CHAR(36), allowNull: false },
    diagnosis: { type: DataTypes.TEXT },
    notes: { type: DataTypes.TEXT },
    actions_taken: { type: DataTypes.JSON },
  }, {
    tableName: 'consultations',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  Consultation.associate = (models) => {
    Consultation.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    Consultation.belongsTo(models.User, { foreignKey: 'doctor_id', as: 'doctor' });
    Consultation.hasMany(models.Prescription, { foreignKey: 'consultation_id', as: 'prescriptions' });
  };

  return Consultation;
};
