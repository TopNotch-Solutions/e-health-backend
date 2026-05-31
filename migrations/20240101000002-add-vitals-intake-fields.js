'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('vitals');

    const columns = {
      onset_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      aggravating_factors: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      alleviating_factors: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      current_medications: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      immunization_status: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      social_history: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      physical_examination: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
    };

    for (const [name, definition] of Object.entries(columns)) {
      if (!table[name]) {
        await queryInterface.addColumn('vitals', name, definition);
      }
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('vitals');
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
      if (table[col]) {
        await queryInterface.removeColumn('vitals', col);
      }
    }
  },
};
