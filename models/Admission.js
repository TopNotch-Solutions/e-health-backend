'use strict';
module.exports = (sequelize, DataTypes) => {
  const Admission = sequelize.define('Admission', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    bed_id: { type: DataTypes.CHAR(36), allowNull: false },
    admitted_by: { type: DataTypes.CHAR(36), allowNull: false },
    admitted_at: { type: DataTypes.DATE, allowNull: true },
    discharged_at: { type: DataTypes.DATE },
    discharged_by: { type: DataTypes.CHAR(36) },
    discharge_notes: { type: DataTypes.TEXT },
    status: {
      type: DataTypes.ENUM('pending_arrival', 'admitted', 'discharged', 'transferred', 'deceased'),
      defaultValue: 'pending_arrival',
    },
  }, {
    tableName: 'admissions',
    timestamps: false,
  });

  Admission.associate = (models) => {
    Admission.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    Admission.belongsTo(models.Bed, { foreignKey: 'bed_id', as: 'bed' });
    Admission.belongsTo(models.User, { foreignKey: 'admitted_by', as: 'admittedBy' });
    Admission.hasMany(models.DietPrescription, { foreignKey: 'admission_id', as: 'dietPrescriptions' });
    Admission.hasMany(models.IcuDailyRecord, { foreignKey: 'admission_id', as: 'icuDailyRecords' });
    Admission.hasMany(models.SurgicalComplexDailyRecord, {
      foreignKey: 'admission_id',
      as: 'surgicalComplexDailyRecords',
    });
    Admission.hasMany(models.SpecializedInpatientDailyRecord, {
      foreignKey: 'admission_id',
      as: 'specializedInpatientDailyRecords',
    });
    Admission.hasMany(models.AdultOutpatientDailyRecord, {
      foreignKey: 'admission_id',
      as: 'adultOutpatientDailyRecords',
    });
  };

  return Admission;
};
