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
  'department_visit',
  'maternity_front_office',
  'maternity_anw_daily',
  'maternity_pnw_daily',
  'maternity_icu_daily',
  'other',
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const hasCategory = await enumColumnIncludes(
      queryInterface,
      'bill_items',
      'category',
      'department_visit'
    );
    if (!hasCategory) {
      await queryInterface.changeColumn('bill_items', 'category', {
        type: Sequelize.ENUM(...BILL_ITEM_CATEGORIES),
        allowNull: false,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const hasCategory = await enumColumnIncludes(
      queryInterface,
      'bill_items',
      'category',
      'department_visit'
    );
    if (hasCategory) {
      await queryInterface.changeColumn('bill_items', 'category', {
        type: Sequelize.ENUM(
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
          'other'
        ),
        allowNull: false,
      });
    }
  },
};
