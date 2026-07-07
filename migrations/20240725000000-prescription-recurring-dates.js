'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE prescription_items
      MODIFY schedule_type ENUM(
        'once_off',
        'monthly_day',
        'recurring_weekdays',
        'recurring_dates'
      ) NOT NULL DEFAULT 'once_off'
    `);
    await queryInterface.addColumn('prescription_items', 'recurring_dates', {
      type: Sequelize.JSON,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('prescription_items', 'recurring_dates');
    await queryInterface.sequelize.query(`
      ALTER TABLE prescription_items
      MODIFY schedule_type ENUM(
        'once_off',
        'monthly_day',
        'recurring_weekdays'
      ) NOT NULL DEFAULT 'once_off'
    `);
  },
};
