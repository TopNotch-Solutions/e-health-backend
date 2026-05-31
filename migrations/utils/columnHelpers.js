'use strict';

async function columnExists(queryInterface, tableName, columnName) {
  const table = await queryInterface.describeTable(tableName);
  return Boolean(table[columnName]);
}

async function addColumnIfMissing(queryInterface, tableName, columnName, definition) {
  if (!(await columnExists(queryInterface, tableName, columnName))) {
    await queryInterface.addColumn(tableName, columnName, definition);
  }
}

async function removeColumnIfExists(queryInterface, tableName, columnName) {
  if (await columnExists(queryInterface, tableName, columnName)) {
    await queryInterface.removeColumn(tableName, columnName);
  }
}

async function tableExists(queryInterface, tableName) {
  const tables = await queryInterface.showAllTables();
  return tables.some((entry) => {
    if (typeof entry === 'string') return entry === tableName;
    return entry?.tableName === tableName || entry?.TABLE_NAME === tableName;
  });
}

async function enumColumnIncludes(queryInterface, tableName, columnName, enumValue) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT COLUMN_TYPE AS columnType FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column LIMIT 1`,
    { replacements: { table: tableName, column: columnName } }
  );
  const columnType = rows[0]?.columnType || '';
  return columnType.includes(`'${enumValue}'`);
}

module.exports = {
  addColumnIfMissing,
  removeColumnIfExists,
  tableExists,
  enumColumnIncludes,
};
