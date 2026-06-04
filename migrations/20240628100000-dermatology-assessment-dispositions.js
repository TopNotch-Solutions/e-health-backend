'use strict';

const { addColumnIfMissing } = require('./utils/columnHelpers');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, 'dermatology_assessments', 'routed_to_pharmacy_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await addColumnIfMissing(queryInterface, 'dermatology_assessments', 'session_completed_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('dermatology_assessments', 'routed_to_pharmacy_at');
    await queryInterface.removeColumn('dermatology_assessments', 'session_completed_at');
  },
};
