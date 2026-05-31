'use strict';

const { addColumnIfMissing, enumColumnIncludes, removeColumnIfExists, tableExists } = require('./utils/columnHelpers');

const DEFAULT_FEES = [
  { fee_key: 'nurse_queue', amount: 35.0 },
  { fee_key: 'doctor_consultation', amount: 30.0 },
  { fee_key: 'ward_daily', amount: 250.0 },
  { fee_key: 'sonar_per_30min', amount: 75.0 },
];

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await tableExists(queryInterface, 'facility_billing_fees'))) {
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
    }

    await addColumnIfMissing(queryInterface, 'pharmacy_inventory', 'unit_price', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });

    await addColumnIfMissing(queryInterface, 'bills', 'cash_paid', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addColumnIfMissing(queryInterface, 'bills', 'eft_paid', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addColumnIfMissing(queryInterface, 'bills', 'paid_by', {
      type: Sequelize.CHAR(36),
      references: { model: 'users', key: 'id' },
    });
    await addColumnIfMissing(queryInterface, 'bills', 'paid_at', {
      type: Sequelize.DATE,
    });

    await addColumnIfMissing(queryInterface, 'sonar_requests', 'started_at', {
      type: Sequelize.DATE,
    });
    await addColumnIfMissing(queryInterface, 'sonar_requests', 'completed_at', {
      type: Sequelize.DATE,
    });

    const hasNursingCategory = await enumColumnIncludes(
      queryInterface,
      'bill_items',
      'category',
      'nursing'
    );
    if (!hasNursingCategory) {
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
    }

    const [facilities] = await queryInterface.sequelize.query('SELECT id FROM facilities');
    const now = new Date();
    for (const f of facilities) {
      for (const fee of DEFAULT_FEES) {
        const feeKeysToCheck =
          fee.fee_key === 'nurse_queue' ? ['nurse_queue', 'admission_fee'] : [fee.fee_key];
        const [existing] = await queryInterface.sequelize.query(
          `SELECT 1 AS ok FROM facility_billing_fees
           WHERE facility_id = :facilityId AND fee_key IN (:feeKeys) LIMIT 1`,
          { replacements: { facilityId: f.id, feeKeys: feeKeysToCheck } }
        );
        if (existing.length === 0) {
          await queryInterface.bulkInsert('facility_billing_fees', [{
            facility_id: f.id,
            fee_key: fee.fee_key,
            amount: fee.amount,
            updated_at: now,
          }]);
        }
      }
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('facility_billing_fees');
    await removeColumnIfExists(queryInterface, 'pharmacy_inventory', 'unit_price');
    await removeColumnIfExists(queryInterface, 'bills', 'cash_paid');
    await removeColumnIfExists(queryInterface, 'bills', 'eft_paid');
    await removeColumnIfExists(queryInterface, 'bills', 'paid_by');
    await removeColumnIfExists(queryInterface, 'bills', 'paid_at');
    await removeColumnIfExists(queryInterface, 'sonar_requests', 'started_at');
    await removeColumnIfExists(queryInterface, 'sonar_requests', 'completed_at');
    await queryInterface.changeColumn('bill_items', 'category', {
      type: Sequelize.ENUM('consultation', 'medication', 'lab', 'sonar', 'ward', 'other'),
      allowNull: false,
    });
  },
};
