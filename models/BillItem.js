'use strict';
module.exports = (sequelize, DataTypes) => {
  const BillItem = sequelize.define('BillItem', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    bill_id: { type: DataTypes.CHAR(36), allowNull: false },
    description: { type: DataTypes.STRING(255), allowNull: false },
    category: {
      type: DataTypes.ENUM(
        'consultation',
        'medication',
        'lab',
        'sonar',
        'ward',
        'nursing',
        'clinic_visit',
        'department_visit',
        'maternity_front_office',
        'maternity_anw_daily',
        'maternity_pnw_daily',
        'maternity_icu_daily',
        'other'
      ),
      allowNull: false,
    },
    amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    reference_id: { type: DataTypes.CHAR(36) },
  }, {
    tableName: 'bill_items',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  BillItem.associate = (models) => {
    BillItem.belongsTo(models.Bill, { foreignKey: 'bill_id', as: 'bill' });
  };

  return BillItem;
};
