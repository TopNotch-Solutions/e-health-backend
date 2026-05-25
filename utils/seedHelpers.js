'use strict';

async function tableExists(queryInterface, tableName) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT 1 AS ok FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = :tableName LIMIT 1`,
    { replacements: { tableName } }
  );
  return rows.length > 0;
}

/** Delete refresh_tokens for users matching an email SQL LIKE pattern (e.g. '%@demo.ehealth.gov'). */
async function deleteRefreshTokensForUserEmailLike(queryInterface, emailPattern) {
  if (!(await tableExists(queryInterface, 'refresh_tokens'))) {
    return;
  }
  await queryInterface.sequelize.query(
    `DELETE rt FROM refresh_tokens rt
     INNER JOIN users u ON u.id = rt.user_id
     WHERE u.email LIKE :pattern`,
    { replacements: { pattern: emailPattern } }
  );
}

/** Delete refresh_tokens for users with exact email. */
async function deleteRefreshTokensForUserEmail(queryInterface, email) {
  if (!(await tableExists(queryInterface, 'refresh_tokens'))) {
    return;
  }
  await queryInterface.sequelize.query(
    `DELETE rt FROM refresh_tokens rt
     INNER JOIN users u ON u.id = rt.user_id
     WHERE u.email = :email`,
    { replacements: { email } }
  );
}

module.exports = {
  tableExists,
  deleteRefreshTokensForUserEmailLike,
  deleteRefreshTokensForUserEmail,
};
