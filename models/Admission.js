'use strict';
module.exports = (sequelize, DataTypes) => {
  const Admission = sequelize.define('Admission', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    bed_id: { type: DataTypes.CHAR(36), allowNull: false },
    admitted_by: { type: DataTypes.CHAR(36), allowNull: false },
    admitted_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    discharged_at: { type: DataTypes.DATE },
    discharged_by: { type: DataTypes.CHAR(36) },
    discharge_notes: { type: DataTypes.TEXT },
    status: { type: DataTypes.ENUM('admitted', 'discharged', 'transferred', 'deceased'), defaultValue: 'admitted' },
  }, {
    tableName: 'admissions',
    timestamps: false,
  });

  Admission.associate = (models) => {
    Admission.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    Admission.belongsTo(models.Bed, { foreignKey: 'bed_id', as: 'bed' });
    Admission.belongsTo(models.User, { foreignKey: 'admitted_by', as: 'admittedBy' });
    Admission.hasMany(models.DietPrescription, { foreignKey: 'admission_id', as: 'dietPrescriptions' });
  };

  return Admission;
};
