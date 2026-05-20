'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('lab_requests');

    if (!table.is_emergency) {
      await queryInterface.addColumn('lab_requests', 'is_emergency', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }

    if (!table.tests) {
      await queryInterface.addColumn('lab_requests', 'tests', {
        type: Sequelize.JSON,
        allowNull: true,
      });
    }

    if (!table.queue_entry_id) {
      await queryInterface.addColumn('lab_requests', 'queue_entry_id', {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: { model: 'queue_entries', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('lab_requests');
    if (table.queue_entry_id) {
      await queryInterface.removeColumn('lab_requests', 'queue_entry_id');
    }
    if (table.tests) {
      await queryInterface.removeColumn('lab_requests', 'tests');
    }
    if (table.is_emergency) {
      await queryInterface.removeColumn('lab_requests', 'is_emergency');
    }
  },
};
