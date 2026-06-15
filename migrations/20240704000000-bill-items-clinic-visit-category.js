'use strict';

const { enumColumnIncludes } = require('./utils/columnHelpers');

module.exports = {
  async up(queryInterface, Sequelize) {
    const hasClinicVisit = await enumColumnIncludes(
      queryInterface,
      'bill_items',
      'category',
      'clinic_visit'
    );
    if (!hasClinicVisit) {
      await queryInterface.changeColumn('bill_items', 'category', {
        type: Sequelize.ENUM(
          'consultation',
          'medication',
          'lab',
          'sonar',
          'ward',
          'nursing',
          'clinic_visit',
          'other'
        ),
        allowNull: false,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const hasClinicVisit = await enumColumnIncludes(
      queryInterface,
      'bill_items',
      'category',
      'clinic_visit'
    );
    if (hasClinicVisit) {
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
  },
};
