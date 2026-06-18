'use strict';
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { ROLES, PERMISSIONS, ROLE_PERMISSIONS } = require('../config/roles');
const { deleteRefreshTokensForUserEmail } = require('../utils/seedHelpers');

const FACILITY_NAME = 'Central State Hospital';
const ADMIN_EMAIL = 'admin@ehealth.gov';

function dedupeRolePermissions(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.role_id}:${row.permission_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {
  async up(queryInterface) {
    const [[existingAdmin]] = await queryInterface.sequelize.query(
      `SELECT id FROM users WHERE email = '${ADMIN_EMAIL}' LIMIT 1`
    );
    if (existingAdmin) {
      console.log(`seed-initial-data: ${ADMIN_EMAIL} already exists — skipping`);
      return;
    }

    let facilityId;
    const [[existingFacility]] = await queryInterface.sequelize.query(
      `SELECT id FROM facilities WHERE name = '${FACILITY_NAME}' LIMIT 1`
    );
    if (existingFacility?.id) {
      facilityId = existingFacility.id;
    } else {
      facilityId = uuidv4();
      await queryInterface.bulkInsert('facilities', [{
        id: facilityId,
        name: FACILITY_NAME,
        type: 'hospital',
        province: 'Khomas',
        district: 'Windhoek',
        address: '1 Hospital Road, Windhoek',
        phone: '+264612030000',
        created_at: new Date(),
      }]);
    }

    const [existingRoles] = await queryInterface.sequelize.query('SELECT name FROM roles');
    const roleNames = new Set(existingRoles.map((r) => r.name));
    const roleRows = Object.values(ROLES)
      .filter((name) => !roleNames.has(name))
      .map((name) => ({
        name,
        display_name: name.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      }));
    if (roleRows.length > 0) {
      await queryInterface.bulkInsert('roles', roleRows);
    }

    const [existingPerms] = await queryInterface.sequelize.query(
      'SELECT resource, action FROM permissions'
    );
    const permKeys = new Set(existingPerms.map((p) => `${p.resource}:${p.action}`));
    const permRows = [];
    for (const [resource, actions] of Object.entries(PERMISSIONS)) {
      for (const action of actions) {
        const key = `${resource}:${action}`;
        if (!permKeys.has(key)) {
          permRows.push({ resource, action });
        }
      }
    }
    if (permRows.length > 0) {
      await queryInterface.bulkInsert('permissions', permRows);
    }

    const [roles] = await queryInterface.sequelize.query('SELECT id, name FROM roles');
    const [permissions] = await queryInterface.sequelize.query(
      'SELECT id, resource, action FROM permissions'
    );

    const rolePermRows = [];
    for (const [roleName, perms] of Object.entries(ROLE_PERMISSIONS)) {
      const role = roles.find((r) => r.name === roleName);
      if (!role) continue;
      for (const [resource, actions] of Object.entries(perms)) {
        for (const action of actions) {
          const perm = permissions.find((p) => p.resource === resource && p.action === action);
          if (perm && perm.id != null) {
            rolePermRows.push({ role_id: role.id, permission_id: perm.id });
          }
        }
      }
    }

    const uniqueRolePerms = dedupeRolePermissions(rolePermRows);
    if (uniqueRolePerms.length > 0) {
      await queryInterface.bulkInsert('role_permissions', uniqueRolePerms, {
        ignoreDuplicates: true,
      });
    }

    const [[adminRole]] = await queryInterface.sequelize.query(
      "SELECT id FROM roles WHERE name = 'system_admin' LIMIT 1"
    );
    if (!adminRole?.id) {
      throw new Error('seed-initial-data: system_admin role not found after inserting roles');
    }

    const passwordHash = await bcrypt.hash('Demo123!', 10);

    await queryInterface.bulkInsert('users', [{
      id: uuidv4(),
      facility_id: facilityId,
      role_id: adminRole.id,
      employee_id: 'EMP-001',
      first_name: 'System',
      last_name: 'Administrator',
      email: ADMIN_EMAIL,
      password_hash: passwordHash,
      phone: '+264612030001',
      is_active: true,
      created_at: new Date(),
    }]);
  },

  async down(queryInterface) {
    await deleteRefreshTokensForUserEmail(queryInterface, ADMIN_EMAIL);
    await queryInterface.bulkDelete('users', { email: ADMIN_EMAIL }, {});
    await queryInterface.bulkDelete('role_permissions', null, {});
    await queryInterface.bulkDelete('permissions', null, {});
    await queryInterface.bulkDelete('roles', null, {});
    await queryInterface.bulkDelete('facilities', null, {});
  },
};
