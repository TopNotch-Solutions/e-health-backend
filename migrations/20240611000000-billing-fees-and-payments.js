'use strict';

const DEFAULT_FEES = [
  { fee_key: 'nurse_queue', amount: 35.0 },
  { fee_key: 'doctor_consultation', amount: 30.0 },
  { fee_key: 'ward_daily', amount: 250.0 },
  { fee_key: 'sonar_per_30min', amount: 75.0 },
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('facility_billing_fees', {
      facility_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        primaryKey: true,
        references: { model: 'facilities', key: 'id' },
      },
      fee_key: {
        type: Sequelize.STRING(50),
        allowNull: false,
        primaryKey: true,
      },
      amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      updated_by: { type: Sequelize.CHAR(36), references: { model: 'users', key: 'id' } },
      updated_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addColumn('pharmacy_inventory', 'unit_price', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.addColumn('bills', 'cash_paid', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('bills', 'eft_paid', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('bills', 'paid_by', {
      type: Sequelize.CHAR(36),
      references: { model: 'users', key: 'id' },
    });
    await queryInterface.addColumn('bills', 'paid_at', {
      type: Sequelize.DATE,
    });

    await queryInterface.addColumn('sonar_requests', 'started_at', {
      type: Sequelize.DATE,
    });
    await queryInterface.addColumn('sonar_requests', 'completed_at', {
      type: Sequelize.DATE,
    });

    await queryInterface.changeColumn('bill_items', 'category', {
      type: Sequelize.ENUM(
        'consultation',
        'medication',
        'lab',
        'sonar',
        'ward',
        'nursing',
        'other'
      ),
      allowNull: false,
    });

    const [facilities] = await queryInterface.sequelize.query(
      'SELECT id FROM facilities'
    );
    const rows = [];
    for (const f of facilities) {
      for (const fee of DEFAULT_FEES) {
        rows.push({
          facility_id: f.id,
          fee_key: fee.fee_key,
          amount: fee.amount,
        });
      }
    }
    if (rows.length) {
      await queryInterface.bulkInsert('facility_billing_fees', rows);
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('facility_billing_fees');
    await queryInterface.removeColumn('pharmacy_inventory', 'unit_price');
    await queryInterface.removeColumn('bills', 'cash_paid');
    await queryInterface.removeColumn('bills', 'eft_paid');
    await queryInterface.removeColumn('bills', 'paid_by');
    await queryInterface.removeColumn('bills', 'paid_at');
    await queryInterface.removeColumn('sonar_requests', 'started_at');
    await queryInterface.removeColumn('sonar_requests', 'completed_at');
    await queryInterface.changeColumn('bill_items', 'category', {
      type: Sequelize.ENUM('consultation', 'medication', 'lab', 'sonar', 'ward', 'other'),
      allowNull: false,
    });
  },
};
