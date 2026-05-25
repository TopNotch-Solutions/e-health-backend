'use strict';

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { ROLES } = require('../config/roles');
const { deleteRefreshTokensForUserEmailLike } = require('../utils/seedHelpers');

/** Shared password for all demo accounts (non-production). Change in production. */
const DEMO_PASSWORD = 'Demo123!';

function roleDisplayName(roleSlug) {
  return roleSlug
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

module.exports = {
  async up(queryInterface) {
    const [facilityRows] = await queryInterface.sequelize.query(
      'SELECT id FROM facilities ORDER BY created_at ASC LIMIT 1'
    );
    const facility = facilityRows[0];
    if (!facility?.id) {
      throw new Error('seed-demo-users-all-roles: no facility found. Run initial seeder first.');
    }

    const facilityId = facility.id;

    const demoPattern = '%@demo.ehealth.gov';
    await deleteRefreshTokensForUserEmailLike(queryInterface, demoPattern);

    await queryInterface.sequelize.query(
      'DELETE FROM users WHERE email LIKE :demoPattern',
      { replacements: { demoPattern } }
    );

    const [roles] = await queryInterface.sequelize.query('SELECT id, name FROM roles');
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const now = new Date();

    const roleNames = Object.values(ROLES);
    const users = [];

    for (const roleName of roleNames) {
      const role = roles.find((r) => r.name === roleName);
      if (!role) continue;

      const display = roleDisplayName(roleName);
      const emailLocal = roleName; // e.g. pharmacy_supervisor@demo.ehealth.gov
      users.push({
        id: uuidv4(),
        facility_id: facilityId,
        role_id: role.id,
        employee_id: `DEMO-${roleName.toUpperCase().replace(/_/g, '-')}`,
        first_name: 'Demo',
        last_name: display,
        email: `${emailLocal}@demo.ehealth.gov`,
        password_hash: passwordHash,
        phone: '+26461000000',
        is_active: true,
        last_login: null,
        created_at: now,
      });
    }

    if (users.length === 0) {
      throw new Error('seed-demo-users-all-roles: no users built — check roles table.');
    }

    await queryInterface.bulkInsert('users', users);
  },

  async down(queryInterface) {
    const demoPattern = '%@demo.ehealth.gov';
    await deleteRefreshTokensForUserEmailLike(queryInterface, demoPattern);
    await queryInterface.sequelize.query(
      'DELETE FROM users WHERE email LIKE :demoPattern',
      { replacements: { demoPattern } }
    );
  },
};
