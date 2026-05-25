'use strict';

const { ROLES, ROLE_PERMISSIONS } = require('../config/roles');

/** Adds pharmacy_supervisor role and permissions for existing databases. */
module.exports = {
  async up(queryInterface) {
    const roleName = ROLES.PHARMACY_SUPERVISOR;
    const [existing] = await queryInterface.sequelize.query(
      'SELECT id FROM roles WHERE name = :name LIMIT 1',
      { replacements: { name: roleName } }
    );
    if (existing.length > 0) return;

    await queryInterface.bulkInsert('roles', [{
      name: roleName,
      display_name: 'Pharmacy Supervisor',
    }]);

    const [inserted] = await queryInterface.sequelize.query(
      'SELECT id FROM roles WHERE name = :name LIMIT 1',
      { replacements: { name: roleName } }
    );
    const roleId = inserted[0]?.id;
    if (!roleId) return;

    const [permissions] = await queryInterface.sequelize.query(
      'SELECT id, resource, action FROM permissions'
    );
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
    const roleName = ROLES.PHARMACY_SUPERVISOR;
    const [roles] = await queryInterface.sequelize.query(
      'SELECT id FROM roles WHERE name = :name LIMIT 1',
      { replacements: { name: roleName } }
    );
    const roleId = roles[0]?.id;
    if (!roleId) return;
    await queryInterface.bulkDelete('role_permissions', { role_id: roleId });
    await queryInterface.bulkDelete('roles', { id: roleId });
  },
};
