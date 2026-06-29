'use strict';

const { enumColumnIncludes } = require('./utils/columnHelpers');

const WARD_TYPES_WITHOUT_SURGICAL = [
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
    const hasSurgical = await enumColumnIncludes(
      queryInterface,
      'wards',
      'ward_type',
      'surgical'
    );
    if (!hasSurgical) return;

    await queryInterface.sequelize.query(
      `UPDATE wards SET ward_type = 'surgical_complex' WHERE ward_type = 'surgical'`
    );
    await queryInterface.changeColumn('wards', 'ward_type', {
      type: Sequelize.ENUM(...WARD_TYPES_WITHOUT_SURGICAL),
      allowNull: false,
    });
  },

  async down(queryInterface, Sequelize) {
    const hasSurgical = await enumColumnIncludes(
      queryInterface,
      'wards',
      'ward_type',
      'surgical'
    );
    if (hasSurgical) return;

    await queryInterface.changeColumn('wards', 'ward_type', {
      type: Sequelize.ENUM(
        'general',
        'maternity',
        'pediatric',
        'icu',
        'surgical',
        'surgical_complex',
        'specialized_inpatient',
        'outpatient_specialist',
        'psychiatric'
      ),
      allowNull: false,
    });
  },
};
