'use strict';

const { addColumnIfMissing, removeColumnIfExists } = require('./utils/columnHelpers');

module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, 'revenue_shifts', 'facility_id', {
      type: Sequelize.CHAR(36),
      allowNull: true,
      references: { model: 'facilities', key: 'id' },
    });

    await addColumnIfMissing(queryInterface, 'revenue_shifts', 'expected_cash', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    });

    await addColumnIfMissing(queryInterface, 'revenue_shifts', 'expected_eft', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    });

    await addColumnIfMissing(queryInterface, 'revenue_shifts', 'verified_cash', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: true,
    });

    await addColumnIfMissing(queryInterface, 'revenue_shifts', 'cash_deficit', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: true,
    });

    await queryInterface.sequelize.query(`
      UPDATE revenue_shifts rs
      INNER JOIN users u ON u.id = rs.billing_clerk_id
      SET rs.facility_id = u.facility_id
      WHERE rs.facility_id IS NULL
    `);
  },

  async down(queryInterface) {
    await removeColumnIfExists(queryInterface, 'revenue_shifts', 'cash_deficit');
    await removeColumnIfExists(queryInterface, 'revenue_shifts', 'verified_cash');
    await removeColumnIfExists(queryInterface, 'revenue_shifts', 'expected_eft');
    await removeColumnIfExists(queryInterface, 'revenue_shifts', 'expected_cash');
    await removeColumnIfExists(queryInterface, 'revenue_shifts', 'facility_id');
  },
};
