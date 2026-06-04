'use strict';

const { ROLES, ROLE_PERMISSIONS } = require('../config/roles');
const { AUTHORIZED_CLINIC_ROLES } = require('../config/clinicRoles');

/** Ensure social_worker is a clinic-assignable role with suite permissions. */
module.exports = {
  async up(queryInterface) {
    const roleName = ROLES.SOCIAL_WORKER;

    const [existing] = await queryInterface.sequelize.query(
      'SELECT id FROM roles WHERE name = :name LIMIT 1',
      { replacements: { name: roleName } }
    );

    if (existing.length === 0) {
      await queryInterface.bulkInsert('roles', [{
        name: roleName,
        display_name: AUTHORIZED_CLINIC_ROLES[roleName] || 'Social Worker',
      }]);
    } else {
      await queryInterface.sequelize.query(
        'UPDATE roles SET display_name = :displayName WHERE name = :name',
        {
          replacements: {
            name: roleName,
            displayName: AUTHORIZED_CLINIC_ROLES[roleName] || 'Social Worker',
          },
        }
      );
    }

    const [inserted] = await queryInterface.sequelize.query(
      'SELECT id FROM roles WHERE name = :name LIMIT 1',
      { replacements: { name: roleName } }
    );
    const roleId = inserted[0]?.id;
    if (!roleId) return;

    const [permissions] = await queryInterface.sequelize.query(
      'SELECT id, resource, action FROM permissions'
    );
    const [existingRp] = await queryInterface.sequelize.query(
      'SELECT permission_id FROM role_permissions WHERE role_id = :roleId',
      { replacements: { roleId } }
    );
    const linked = new Set(existingRp.map((r) => r.permission_id));

    const perms = ROLE_PERMISSIONS[roleName] || {};
    const rows = [];
    for (const [resource, actions] of Object.entries(perms)) {
      for (const action of actions) {
        const perm = permissions.find((p) => p.resource === resource && p.action === action);
        if (perm && !linked.has(perm.id)) {
          rows.push({ role_id: roleId, permission_id: perm.id });
        }
      }
    }
    if (rows.length) {
      await queryInterface.bulkInsert('role_permissions', rows);
    }
  },

  async down(queryInterface) {
    // Role remains valid for hospitals; only clinic config change is reverted manually.
  },
};
