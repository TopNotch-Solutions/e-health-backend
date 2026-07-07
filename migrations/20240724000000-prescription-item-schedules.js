'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('prescription_items', 'schedule_type', {
      type: Sequelize.ENUM('once_off', 'monthly_day', 'recurring_weekdays'),
      allowNull: false,
      defaultValue: 'once_off',
    });
    await queryInterface.addColumn('prescription_items', 'recurring_day_of_month', {
      type: Sequelize.TINYINT.UNSIGNED,
      allowNull: true,
    });
    await queryInterface.addColumn('prescription_items', 'recurring_weekdays', {
      type: Sequelize.JSON,
      allowNull: true,
    });
    await queryInterface.addColumn('prescription_items', 'schedule_active', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
    await queryInterface.addColumn('prescription_items', 'schedule_stopped_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('prescription_items', 'schedule_stopped_by', {
      type: Sequelize.CHAR(36),
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('prescription_items', 'schedule_stopped_by');
    await queryInterface.removeColumn('prescription_items', 'schedule_stopped_at');
    await queryInterface.removeColumn('prescription_items', 'schedule_active');
    await queryInterface.removeColumn('prescription_items', 'recurring_weekdays');
    await queryInterface.removeColumn('prescription_items', 'recurring_day_of_month');
    await queryInterface.removeColumn('prescription_items', 'schedule_type');
  },
};
