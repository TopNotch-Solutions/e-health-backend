'use strict';
module.exports = (sequelize, DataTypes) => {
  const PharmacyInventory = sequelize.define('PharmacyInventory', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    facility_id: { type: DataTypes.CHAR(36), allowNull: false },
    medication_name: { type: DataTypes.STRING(255), allowNull: false },
    generic_name: { type: DataTypes.STRING(255) },
    category: { type: DataTypes.STRING(100) },
    quantity_in_stock: { type: DataTypes.INTEGER, defaultValue: 0 },
    reorder_level: { type: DataTypes.INTEGER, defaultValue: 10 },
    unit: { type: DataTypes.STRING(50) },
    expiry_date: { type: DataTypes.DATEONLY },
    unit_price: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  }, {
    tableName: 'pharmacy_inventory',
    timestamps: false,
  });

  PharmacyInventory.associate = (models) => {
    PharmacyInventory.belongsTo(models.Facility, { foreignKey: 'facility_id', as: 'facility' });
    PharmacyInventory.hasMany(models.StockTransaction, { foreignKey: 'inventory_id', as: 'transactions' });
  };

  return PharmacyInventory;
};
