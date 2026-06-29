'use strict';

const { enumColumnIncludes } = require('./utils/columnHelpers');

const WARD_TYPES = [
  'general',
  'maternity',
  'pediatric',
  'icu',
  'surgical_complex',
  'specialized_inpatient',
  'outpatient_specialist',
  'psychiatric',
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const hasSurgicalComplex = await enumColumnIncludes(
      queryInterface,
      'wards',
      'ward_type',
      'surgical_complex'
    );
    if (!hasSurgicalComplex) {
      await queryInterface.sequelize.query(
        `UPDATE wards SET ward_type = 'surgical_complex' WHERE ward_type = 'surgical'`
      );
      await queryInterface.changeColumn('wards', 'ward_type', {
        type: Sequelize.ENUM(...WARD_TYPES),
        allowNull: false,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const hasSurgicalComplex = await enumColumnIncludes(
      queryInterface,
      'wards',
      'ward_type',
      'surgical_complex'
    );
    if (hasSurgicalComplex) {
      await queryInterface.changeColumn('wards', 'ward_type', {
        type: Sequelize.ENUM(
          'general',
          'maternity',
          'pediatric',
          'icu',
          'surgical',
          'psychiatric'
        ),
        allowNull: false,
      });
    }
  },
};
