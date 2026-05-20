'use strict';
module.exports = (sequelize, DataTypes) => {
  const Bed = sequelize.define('Bed', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    ward_id: { type: DataTypes.CHAR(36), allowNull: false },
    room_number: { type: DataTypes.STRING(20), allowNull: true },
    bed_number: { type: DataTypes.STRING(20), allowNull: false },
    status: {
      type: DataTypes.ENUM('available', 'reserved', 'occupied', 'out_of_service'),
      defaultValue: 'available',
    },
    condition_note: { type: DataTypes.STRING(255) },
  }, {
    tableName: 'beds',
    timestamps: false,
  });

  Bed.associate = (models) => {
    Bed.belongsTo(models.Ward, { foreignKey: 'ward_id', as: 'ward' });
    Bed.hasMany(models.Admission, { foreignKey: 'bed_id', as: 'admissions' });
  };

  return Bed;
};
