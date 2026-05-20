'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('beds', 'status', {
      type: Sequelize.ENUM('available', 'reserved', 'occupied', 'out_of_service'),
      defaultValue: 'available',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      "UPDATE beds SET status = 'occupied' WHERE status = 'reserved'"
    );
    await queryInterface.changeColumn('beds', 'status', {
      type: Sequelize.ENUM('available', 'occupied', 'out_of_service'),
      defaultValue: 'available',
    });
  },
};
