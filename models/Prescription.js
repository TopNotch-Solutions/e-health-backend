'use strict';
module.exports = (sequelize, DataTypes) => {
  const Prescription = sequelize.define('Prescription', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    consultation_id: { type: DataTypes.CHAR(36), allowNull: false },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    prescribed_by: { type: DataTypes.CHAR(36), allowNull: false },
    status: { type: DataTypes.ENUM('pending', 'partially_dispensed', 'dispensed', 'unavailable'), defaultValue: 'pending' },
    referral_generated: { type: DataTypes.BOOLEAN, defaultValue: false },
  }, {
    tableName: 'prescriptions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  Prescription.associate = (models) => {
    Prescription.belongsTo(models.Consultation, { foreignKey: 'consultation_id', as: 'consultation' });
    Prescription.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    Prescription.belongsTo(models.User, { foreignKey: 'prescribed_by', as: 'prescribedBy' });
    Prescription.hasMany(models.PrescriptionItem, { foreignKey: 'prescription_id', as: 'items' });
  };

  return Prescription;
};
