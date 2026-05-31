'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const [columns] = await queryInterface.sequelize.query(
      `SELECT 1 AS ok FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'created_by' LIMIT 1`
    );
    if (columns.length > 0) return;

    await queryInterface.addColumn('users', 'created_by', {
      type: Sequelize.CHAR(36),
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addIndex('users', ['created_by']);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'created_by');
  },
};
