'use strict';

const { enumColumnIncludes } = require('./utils/columnHelpers');

const BILL_ITEM_CATEGORIES = [
  'consultation',
  'medication',
  'lab',
  'sonar',
  'ward',
  'nursing',
  'clinic_visit',
  'maternity_front_office',
  'maternity_anw_daily',
  'maternity_pnw_daily',
  'maternity_icu_daily',
  'other',
];

const PATIENT_CATEGORIES = ['known', 'unknown', 'returning'];

module.exports = {
  async up(queryInterface, Sequelize) {
    const hasMaternityFo = await enumColumnIncludes(
      queryInterface,
      'bill_items',
      'category',
      'maternity_front_office'
    );
    if (!hasMaternityFo) {
      await queryInterface.changeColumn('bill_items', 'category', {
        type: Sequelize.ENUM(...BILL_ITEM_CATEGORIES),
        allowNull: false,
      });
    }

    const hasReturning = await enumColumnIncludes(
      queryInterface,
      'patients',
      'category',
      'returning'
    );
    if (!hasReturning) {
      await queryInterface.changeColumn('patients', 'category', {
        type: Sequelize.ENUM(...PATIENT_CATEGORIES),
        allowNull: false,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const hasMaternityFo = await enumColumnIncludes(
      queryInterface,
      'bill_items',
      'category',
      'maternity_front_office'
    );
    if (hasMaternityFo) {
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
};
