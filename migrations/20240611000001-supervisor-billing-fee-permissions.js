'use strict';

const { ROLES, ROLE_PERMISSIONS } = require('../config/roles');

const SUPERVISORS_WITH_BILLING = [
  ROLES.NURSE_SUPERVISOR,
  ROLES.DOCTOR_SUPERVISOR,
  ROLES.WARD_SUPERVISOR,
  ROLES.RADIOLOGIST_SUPERVISOR,
];

module.exports = {
  async up(queryInterface) {
    const [permissions] = await queryInterface.sequelize.query(
      'SELECT id, resource, action FROM permissions'
    );
    const [roles] = await queryInterface.sequelize.query('SELECT id, name FROM roles');

    const rows = [];
    for (const roleName of SUPERVISORS_WITH_BILLING) {
      const role = roles.find((r) => r.name === roleName);
      if (!role) continue;
      const perms = ROLE_PERMISSIONS[roleName]?.billing || [];
      for (const action of perms) {
        const perm = permissions.find((p) => p.resource === 'billing' && p.action === action);
        if (perm) rows.push({ role_id: role.id, permission_id: perm.id });
      }
    }

    if (!rows.length) return;

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
      `SELECT id FROM roles WHERE name IN ('nurse_supervisor','doctor_supervisor','ward_supervisor','radiologist_supervisor')`
    );
    const roleIds = roles.map((r) => r.id);
    if (!roleIds.length) return;

    const [perms] = await queryInterface.sequelize.query(
      "SELECT id FROM permissions WHERE resource = 'billing'"
    );
    const permIds = perms.map((p) => p.id);
    if (!permIds.length) return;

    await queryInterface.sequelize.query(
      `DELETE FROM role_permissions WHERE role_id IN (:roleIds) AND permission_id IN (:permIds)`,
      { replacements: { roleIds, permIds } }
    );
  },
};
