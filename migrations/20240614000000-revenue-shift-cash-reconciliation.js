'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('revenue_shifts', 'facility_id', {
      type: Sequelize.CHAR(36),
      allowNull: true,
      references: { model: 'facilities', key: 'id' },
    });

    await queryInterface.addColumn('revenue_shifts', 'expected_cash', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.addColumn('revenue_shifts', 'expected_eft', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.addColumn('revenue_shifts', 'verified_cash', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: true,
    });

    await queryInterface.addColumn('revenue_shifts', 'cash_deficit', {
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
    await queryInterface.removeColumn('revenue_shifts', 'cash_deficit');
    await queryInterface.removeColumn('revenue_shifts', 'verified_cash');
    await queryInterface.removeColumn('revenue_shifts', 'expected_eft');
    await queryInterface.removeColumn('revenue_shifts', 'expected_cash');
    await queryInterface.removeColumn('revenue_shifts', 'facility_id');
  },
};
