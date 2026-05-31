'use strict';

const { AUTHORIZED_CLINIC_ROLES } = require('../config/clinicRoles');
const { ROLE_PERMISSIONS, ROLES } = require('../config/roles');

/** Master Doctor — clinic consultation queue (parameter/screening nurse handoffs). */
module.exports = {
  async up(queryInterface) {
    const roleName = ROLES.MASTER_DOCTOR;

    const [existing] = await queryInterface.sequelize.query(
      'SELECT id FROM roles WHERE name = :name LIMIT 1',
      { replacements: { name: roleName } }
    );
    if (existing.length > 0) return;

    const [permissions] = await queryInterface.sequelize.query(
      'SELECT id, resource, action FROM permissions'
    );

    await queryInterface.bulkInsert('roles', [{
      name: roleName,
      display_name: AUTHORIZED_CLINIC_ROLES[roleName] || 'Master Doctor',
    }]);

    const [inserted] = await queryInterface.sequelize.query(
      'SELECT id FROM roles WHERE name = :name LIMIT 1',
      { replacements: { name: roleName } }
    );
    const roleId = inserted[0]?.id;
    if (!roleId) return;

    const perms = ROLE_PERMISSIONS[roleName] || {};
    const rows = [];
    for (const [resource, actions] of Object.entries(perms)) {
      for (const action of actions) {
        const perm = permissions.find((p) => p.resource === resource && p.action === action);
        if (perm) rows.push({ role_id: roleId, permission_id: perm.id });
      }
    }
    if (rows.length) {
      await queryInterface.bulkInsert('role_permissions', rows);
    }
  },

  async down(queryInterface) {
    const roleName = ROLES.MASTER_DOCTOR;
    const [roles] = await queryInterface.sequelize.query(
      'SELECT id FROM roles WHERE name = :name LIMIT 1',
      { replacements: { name: roleName } }
    );
    const roleId = roles[0]?.id;
    if (!roleId) return;

    await queryInterface.sequelize.query(
      'DELETE FROM role_permissions WHERE role_id = :roleId',
      { replacements: { roleId } }
    );
    await queryInterface.sequelize.query(
      'DELETE FROM roles WHERE id = :roleId',
      { replacements: { roleId } }
    );
  },
};
