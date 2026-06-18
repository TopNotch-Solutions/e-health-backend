'use strict';

const bcrypt = require('bcryptjs');
const { DEFAULT_DEMO_PASSWORD } = require('../config/clinicRoles');

/** Reset demo and bootstrap admin accounts to the shared Demo123! password. */
module.exports = {
  async up(queryInterface) {
    const passwordHash = await bcrypt.hash(DEFAULT_DEMO_PASSWORD, 10);
    await queryInterface.sequelize.query(
      `UPDATE users SET password_hash = :hash
       WHERE email LIKE '%@demo.ehealth.gov'
          OR email = 'admin@ehealth.gov'`,
      { replacements: { hash: passwordHash } }
    );
  },

  async down() {
    // Password reset is not reversed.
  },
};
