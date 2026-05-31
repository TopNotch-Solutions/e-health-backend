'use strict';

const { addColumnIfMissing, removeColumnIfExists } = require('./utils/columnHelpers');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, 'vitals', 'visit_classification', {
      type: Sequelize.ENUM('follow_up', 'sick'),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await removeColumnIfExists(queryInterface, 'vitals', 'visit_classification');
  },
};
