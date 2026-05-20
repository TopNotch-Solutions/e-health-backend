'use strict';

/**
 * Removes duplicate indexes on `users` created by repeated sequelize.sync({ alter: true }).
 * Keeps the first index per column; drops extras so UNIQUE constraints can be applied again.
 */
async function dropExtraIndexesOnColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SHOW INDEX FROM \`${table}\` WHERE Column_name = :column`,
    { replacements: { column } }
  );
  const keyNames = [...new Set(rows.map((r) => r.Key_name))].filter((k) => k !== 'PRIMARY');
  if (keyNames.length <= 1) return;

  for (let i = 1; i < keyNames.length; i += 1) {
    const key = keyNames[i];
    try {
      await sequelize.query(`ALTER TABLE \`${table}\` DROP INDEX \`${key}\``);
      console.log(`Dropped duplicate index ${table}.${key} (${column})`);
    } catch (err) {
      console.warn(`Could not drop index ${table}.${key}:`, err.message);
    }
  }
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;
    await dropExtraIndexesOnColumn(sequelize, 'users', 'employee_id');
    await dropExtraIndexesOnColumn(sequelize, 'users', 'email');
  },

  async down() {
    // Irreversible — duplicate indexes should not be recreated.
  },
};
