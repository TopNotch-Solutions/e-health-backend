'use strict';

const { ROLES, ROLE_PERMISSIONS } = require('../config/roles');

const RESOURCES_TO_SYNC = ['inventory', 'prescription'];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const [permissions] = await queryInterface.sequelize.query(
      'SELECT id, resource, action FROM permissions'
    );
    const [roles] = await queryInterface.sequelize.query(
      'SELECT id, name FROM roles WHERE name = :name LIMIT 1',
      { replacements: { name: ROLES.EMERGENCY_UNIT_NURSE } }
    );
    const role = roles[0];
    if (!role) return;

    const perms = ROLE_PERMISSIONS[ROLES.EMERGENCY_UNIT_NURSE] || {};
    const rows = [];

    for (const resource of RESOURCES_TO_SYNC) {
      const actions = perms[resource] || [];
      for (const action of actions) {
        const perm = permissions.find((p) => p.resource === resource && p.action === action);
        if (perm) rows.push({ role_id: role.id, permission_id: perm.id });
      }
    }

    for (const row of rows) {
      const [exists] = await queryInterface.sequelize.query(
        'SELECT 1 FROM role_permissions WHERE role_id = :roleId AND permission_id = :permId LIMIT 1',
        { replacements: { roleId: row.role_id, permId: row.permission_id } }
      );
      if (!exists.length) {
        await queryInterface.bulkInsert('role_permissions', [row]);
      }
    }
  },

  async down(queryInterface) {
    const [roles] = await queryInterface.sequelize.query(
      'SELECT id FROM roles WHERE name = :name LIMIT 1',
      { replacements: { name: ROLES.EMERGENCY_UNIT_NURSE } }
    );
    const roleId = roles[0]?.id;
    if (!roleId) return;

    const [perms] = await queryInterface.sequelize.query(
      "SELECT id FROM permissions WHERE resource IN ('inventory', 'prescription')"
    );
    const permIds = perms.map((p) => p.id);
    if (!permIds.length) return;

    await queryInterface.sequelize.query(
      'DELETE FROM role_permissions WHERE role_id = :roleId AND permission_id IN (:permIds)',
      { replacements: { roleId, permIds } }
    );
  },
};
