'use strict';

const { addColumnIfMissing, removeColumnIfExists } = require('./utils/columnHelpers');

module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, 'stock_transactions', 'status', {
      type: Sequelize.ENUM('pending', 'confirmed'),
      allowNull: false,
      defaultValue: 'confirmed',
    });
    await addColumnIfMissing(queryInterface, 'stock_transactions', 'confirmed_by', {
      type: Sequelize.CHAR(36),
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await addColumnIfMissing(queryInterface, 'stock_transactions', 'confirmed_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.sequelize.query(`
      UPDATE stock_transactions
      SET confirmed_by = performed_by,
          confirmed_at = created_at
      WHERE type = 'received'
        AND (confirmed_by IS NULL OR confirmed_at IS NULL)
    `);
  },

  async down(queryInterface) {
    await removeColumnIfExists(queryInterface, 'stock_transactions', 'confirmed_at');
    await removeColumnIfExists(queryInterface, 'stock_transactions', 'confirmed_by');
    await removeColumnIfExists(queryInterface, 'stock_transactions', 'status');
  },
};
