'use strict';
module.exports = (sequelize, DataTypes) => {
  const Bill = sequelize.define('Bill', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    patient_id: { type: DataTypes.CHAR(36), allowNull: false },
    total_amount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0.00 },
    paid_amount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0.00 },
    status: { type: DataTypes.ENUM('accumulating', 'pending_payment', 'paid', 'waived'), defaultValue: 'accumulating' },
  }, {
    tableName: 'bills',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  Bill.associate = (models) => {
    Bill.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    Bill.belongsTo(models.Patient, { foreignKey: 'patient_id', as: 'patient' });
    Bill.hasMany(models.BillItem, { foreignKey: 'bill_id', as: 'items' });
  };

  return Bill;
};
