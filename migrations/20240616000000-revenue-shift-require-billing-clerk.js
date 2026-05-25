'use strict';

/** Facility shifts must be tied to a billing clerk — remove orphan rows and enforce NOT NULL. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      'DELETE FROM revenue_shifts WHERE billing_clerk_id IS NULL'
    );

    await queryInterface.changeColumn('revenue_shifts', 'billing_clerk_id', {
      type: Sequelize.CHAR(36),
      allowNull: false,
      references: { model: 'users', key: 'id' },
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('revenue_shifts', 'billing_clerk_id', {
      type: Sequelize.CHAR(36),
      allowNull: true,
      references: { model: 'users', key: 'id' },
    });
  },
};
