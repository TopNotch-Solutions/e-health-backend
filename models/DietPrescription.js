'use strict';
module.exports = (sequelize, DataTypes) => {
  const DietPrescription = sequelize.define('DietPrescription', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    admission_id: { type: DataTypes.CHAR(36), allowNull: false },
    prescribed_by: { type: DataTypes.CHAR(36), allowNull: false },
    diet_type: { type: DataTypes.STRING(100), allowNull: false },
    description: { type: DataTypes.TEXT },
    restrictions: { type: DataTypes.TEXT },
    special_instructions: { type: DataTypes.TEXT },
    start_date: { type: DataTypes.DATEONLY, allowNull: false },
    end_date: { type: DataTypes.DATEONLY },
    status: { type: DataTypes.ENUM('active', 'completed', 'cancelled'), defaultValue: 'active' },
  }, {
    tableName: 'diet_prescriptions',
    timestamps: false,
  });

  DietPrescription.associate = (models) => {
    DietPrescription.belongsTo(models.Admission, { foreignKey: 'admission_id', as: 'admission' });
    DietPrescription.belongsTo(models.User, { foreignKey: 'prescribed_by', as: 'prescribedBy' });
    DietPrescription.hasMany(models.MealPlan, { foreignKey: 'diet_prescription_id', as: 'mealPlans' });
  };

  return DietPrescription;
};
