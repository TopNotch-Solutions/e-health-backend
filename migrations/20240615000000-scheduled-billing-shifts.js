'use strict';

const { addColumnIfMissing, removeColumnIfExists } = require('./utils/columnHelpers');

module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, 'revenue_shifts', 'shift_slot', {
      type: Sequelize.ENUM('day', 'night'),
      allowNull: true,
    });

    await queryInterface.changeColumn('revenue_shifts', 'billing_clerk_id', {
      type: Sequelize.CHAR(36),
      allowNull: true,
      references: { model: 'users', key: 'id' },
    });
  },

  async down(queryInterface, Sequelize) {
    await removeColumnIfExists(queryInterface, 'revenue_shifts', 'shift_slot');
    await queryInterface.changeColumn('revenue_shifts', 'billing_clerk_id', {
      type: Sequelize.CHAR(36),
      allowNull: false,
      references: { model: 'users', key: 'id' },
    });
  },
};
