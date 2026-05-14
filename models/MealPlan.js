'use strict';
module.exports = (sequelize, DataTypes) => {
  const MealPlan = sequelize.define('MealPlan', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    diet_prescription_id: { type: DataTypes.CHAR(36), allowNull: false },
    meal_type: { type: DataTypes.ENUM('breakfast', 'lunch', 'dinner', 'snack'), allowNull: false },
    meal_date: { type: DataTypes.DATEONLY, allowNull: false },
    prepared: { type: DataTypes.BOOLEAN, defaultValue: false },
    dispensed: { type: DataTypes.BOOLEAN, defaultValue: false },
    prepared_by: { type: DataTypes.CHAR(36) },
    dispensed_at: { type: DataTypes.DATE },
    notes: { type: DataTypes.STRING(255) },
  }, {
    tableName: 'meal_plans',
    timestamps: false,
  });

  MealPlan.associate = (models) => {
    MealPlan.belongsTo(models.DietPrescription, { foreignKey: 'diet_prescription_id', as: 'dietPrescription' });
    MealPlan.belongsTo(models.User, { foreignKey: 'prepared_by', as: 'preparedBy' });
  };

  return MealPlan;
};
