'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('vitals', 'visit_classification', {
      type: Sequelize.ENUM('follow_up', 'sick'),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('vitals', 'visit_classification');
  },
};
