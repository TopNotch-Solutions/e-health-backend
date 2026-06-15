'use strict';

module.exports = (sequelize, DataTypes) => {
  const Icd10Code = sequelize.define(
    'Icd10Code',
    {
      id: { type: DataTypes.CHAR(36), primaryKey: true },
      icd10_code: { type: DataTypes.STRING(20), allowNull: false, unique: true },
      description: { type: DataTypes.TEXT, allowNull: false },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      tableName: 'icd10_codes',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return Icd10Code;
};
