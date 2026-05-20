'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('transport_requests');

    if (!table.critical_notes) {
      await queryInterface.addColumn('transport_requests', 'critical_notes', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }

    if (!table.equipment_checklist) {
      await queryInterface.addColumn('transport_requests', 'equipment_checklist', {
        type: Sequelize.JSON,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('transport_requests');
    if (table.equipment_checklist) {
      await queryInterface.removeColumn('transport_requests', 'equipment_checklist');
    }
    if (table.critical_notes) {
      await queryInterface.removeColumn('transport_requests', 'critical_notes');
    }
  },
};
