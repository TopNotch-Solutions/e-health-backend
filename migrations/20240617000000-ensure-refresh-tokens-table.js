'use strict';

/** Creates refresh_tokens if missing (older DBs created before this table was in base migration). */
module.exports = {
  async up(queryInterface, Sequelize) {
    const [rows] = await queryInterface.sequelize.query(
      `SELECT 1 AS ok FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'refresh_tokens' LIMIT 1`
    );
    if (rows.length > 0) return;

    await queryInterface.createTable('refresh_tokens', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      user_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      token: { type: Sequelize.STRING(500), allowNull: false },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      revoked: { type: Sequelize.BOOLEAN, defaultValue: false },
    });
    await queryInterface.addIndex('refresh_tokens', ['user_id']);
    await queryInterface.addIndex('refresh_tokens', ['token']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('refresh_tokens');
  },
};
