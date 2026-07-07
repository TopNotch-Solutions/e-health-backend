'use strict';
module.exports = (sequelize, DataTypes) => {
  const PrescriptionItem = sequelize.define('PrescriptionItem', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    prescription_id: { type: DataTypes.CHAR(36), allowNull: false },
    medication_name: { type: DataTypes.STRING(255), allowNull: false },
    dosage: { type: DataTypes.STRING(100) },
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    frequency: { type: DataTypes.STRING(100) },
    duration: { type: DataTypes.STRING(100) },
    instructions: { type: DataTypes.TEXT },
    is_dispensed: { type: DataTypes.BOOLEAN, defaultValue: false },
    is_available: { type: DataTypes.BOOLEAN, defaultValue: true },
    dispensed_by: { type: DataTypes.CHAR(36) },
    dispensed_at: { type: DataTypes.DATE },
    stock_at_prescribe: { type: DataTypes.INTEGER },
    schedule_type: {
      type: DataTypes.ENUM('once_off', 'monthly_day', 'recurring_weekdays', 'recurring_dates'),
      allowNull: false,
      defaultValue: 'once_off',
    },
    recurring_day_of_month: { type: DataTypes.TINYINT.UNSIGNED },
    recurring_weekdays: { type: DataTypes.JSON },
    recurring_dates: { type: DataTypes.JSON },
    schedule_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    schedule_stopped_at: { type: DataTypes.DATE },
    schedule_stopped_by: { type: DataTypes.CHAR(36) },
  }, {
    tableName: 'prescription_items',
    timestamps: false,
  });

  PrescriptionItem.associate = (models) => {
    PrescriptionItem.belongsTo(models.Prescription, { foreignKey: 'prescription_id', as: 'prescription' });
    PrescriptionItem.belongsTo(models.User, { foreignKey: 'dispensed_by', as: 'dispensedBy' });
    PrescriptionItem.belongsTo(models.User, { foreignKey: 'schedule_stopped_by', as: 'scheduleStoppedBy' });
  };

  return PrescriptionItem;
};
