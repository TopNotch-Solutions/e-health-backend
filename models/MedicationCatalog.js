'use strict';

module.exports = (sequelize, DataTypes) => {
  const MedicationCatalog = sequelize.define(
    'MedicationCatalog',
    {
      id: { type: DataTypes.CHAR(36), primaryKey: true },
      medication_name: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      generic_name: { type: DataTypes.STRING(255), allowNull: false },
      category: { type: DataTypes.STRING(100) },
      unit_price: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    },
    {
      tableName: 'medication_catalog',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return MedicationCatalog;
};
