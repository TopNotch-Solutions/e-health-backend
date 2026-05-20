'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('beds');
    if (!table.room_number) {
      await queryInterface.addColumn('beds', 'room_number', {
        type: Sequelize.STRING(20),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('beds');
    if (table.room_number) {
      await queryInterface.removeColumn('beds', 'room_number');
    }
  },
};
