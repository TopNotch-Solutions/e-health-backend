'use strict';
module.exports = (sequelize, DataTypes) => {
  const StockTransaction = sequelize.define('StockTransaction', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    inventory_id: { type: DataTypes.CHAR(36), allowNull: false },
    type: { type: DataTypes.ENUM('received', 'dispensed', 'expired', 'adjustment'), allowNull: false },
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.ENUM('pending', 'confirmed'), allowNull: false, defaultValue: 'confirmed' },
    reference_id: { type: DataTypes.CHAR(36) },
    performed_by: { type: DataTypes.CHAR(36), allowNull: false },
    confirmed_by: { type: DataTypes.CHAR(36) },
    confirmed_at: { type: DataTypes.DATE },
  }, {
    tableName: 'stock_transactions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  StockTransaction.associate = (models) => {
    StockTransaction.belongsTo(models.PharmacyInventory, { foreignKey: 'inventory_id', as: 'inventory' });
    StockTransaction.belongsTo(models.User, { foreignKey: 'performed_by', as: 'performedBy' });
    StockTransaction.belongsTo(models.User, { foreignKey: 'confirmed_by', as: 'confirmedBy' });
  };

  return StockTransaction;
};
