'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('vitals', 'onset_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('vitals', 'aggravating_factors', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('vitals', 'alleviating_factors', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('vitals', 'current_medications', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('vitals', 'immunization_status', {
      type: Sequelize.STRING(100),
      allowNull: true,
    });
    await queryInterface.addColumn('vitals', 'social_history', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('vitals', 'physical_examination', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    const cols = [
      'onset_at',
      'aggravating_factors',
      'alleviating_factors',
      'current_medications',
      'immunization_status',
      'social_history',
      'physical_examination',
    ];
    for (const col of cols) {
      await queryInterface.removeColumn('vitals', col);
    }
  },
};
