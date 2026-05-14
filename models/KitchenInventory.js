'use strict';
module.exports = (sequelize, DataTypes) => {
  const KitchenInventory = sequelize.define('KitchenInventory', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    facility_id: { type: DataTypes.CHAR(36), allowNull: false },
    item_name: { type: DataTypes.STRING(255), allowNull: false },
    category: { type: DataTypes.STRING(100) },
    quantity: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
    unit: { type: DataTypes.STRING(50) },
    reorder_level: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  }, {
    tableName: 'kitchen_inventory',
    timestamps: false,
  });

  KitchenInventory.associate = (models) => {
    KitchenInventory.belongsTo(models.Facility, { foreignKey: 'facility_id', as: 'facility' });
  };

  return KitchenInventory;
};
