'use strict';

module.exports = (sequelize, DataTypes) => {
  const FamilyPlanningRecord = sequelize.define('FamilyPlanningRecord', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    patient_id: { type: DataTypes.CHAR(36), allowNull: false },
    recorded_by: { type: DataTypes.CHAR(36), allowNull: false },
    intervention_type: {
      type: DataTypes.ENUM('subdermal', 'device', 'oral'),
      allowNull: true,
    },
    subdermal_insertion_date: { type: DataTypes.DATEONLY, allowNull: true },
    subdermal_insertion_notes: { type: DataTypes.TEXT, allowNull: true },
    subdermal_replacement_date: { type: DataTypes.DATEONLY, allowNull: true },
    subdermal_replacement_notes: { type: DataTypes.TEXT, allowNull: true },
    device_type: { type: DataTypes.STRING(80), allowNull: true },
    device_insertion_date: { type: DataTypes.DATEONLY, allowNull: true },
    device_insertion_notes: { type: DataTypes.TEXT, allowNull: true },
    device_removal_date: { type: DataTypes.DATEONLY, allowNull: true },
    device_removal_notes: { type: DataTypes.TEXT, allowNull: true },
    oral_contraceptive_log: { type: DataTypes.JSON, allowNull: true },
    circumcision_surgical_criteria: { type: DataTypes.TEXT, allowNull: true },
    circumcision_procedure_notes: { type: DataTypes.TEXT, allowNull: true },
    circumcision_post_op_metrics: { type: DataTypes.TEXT, allowNull: true },
    record_saved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    record_saved_at: { type: DataTypes.DATE, allowNull: true },
    routed_to_pharmacy_at: { type: DataTypes.DATE, allowNull: true },
    session_completed_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'family_planning_records',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  FamilyPlanningRecord.associate = (models) => {
    FamilyPlanningRecord.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    FamilyPlanningRecord.belongsTo(models.Patient, { foreignKey: 'patient_id', as: 'patient' });
    FamilyPlanningRecord.belongsTo(models.User, { foreignKey: 'recorded_by', as: 'recordedBy' });
  };

  return FamilyPlanningRecord;
};
