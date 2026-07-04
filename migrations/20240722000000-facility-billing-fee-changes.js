'use strict';

const { tableExists } = require('./utils/columnHelpers');

module.exports = {
  async up(queryInterface, Sequelize) {
    if (await tableExists(queryInterface, 'facility_billing_fee_changes')) return;

    await queryInterface.createTable('facility_billing_fee_changes', {
      id: {
        type: Sequelize.CHAR(36),
        primaryKey: true,
      },
      facility_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'facilities', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      fee_key: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      previous_amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
      },
      new_amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      reason: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      changed_by: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('facility_billing_fee_changes', ['facility_id', 'created_at'], {
      name: 'facility_billing_fee_changes_facility_created',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('facility_billing_fee_changes');
  },
};
