'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('stock_transactions', 'status', {
      type: Sequelize.ENUM('pending', 'confirmed'),
      allowNull: false,
      defaultValue: 'confirmed',
    });
    await queryInterface.addColumn('stock_transactions', 'confirmed_by', {
      type: Sequelize.CHAR(36),
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('stock_transactions', 'confirmed_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.sequelize.query(`
      UPDATE stock_transactions
      SET confirmed_by = performed_by,
          confirmed_at = created_at
      WHERE type = 'received' AND status = 'confirmed'
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('stock_transactions', 'confirmed_at');
    await queryInterface.removeColumn('stock_transactions', 'confirmed_by');
    await queryInterface.removeColumn('stock_transactions', 'status');
  },
};
