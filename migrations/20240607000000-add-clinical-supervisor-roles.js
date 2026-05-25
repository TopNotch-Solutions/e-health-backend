'use strict';

const { ROLES, ROLE_PERMISSIONS } = require('../config/roles');

const SUPERVISOR_ROLES = [
  ROLES.NURSE_SUPERVISOR,
  ROLES.DOCTOR_SUPERVISOR,
  ROLES.LABORATORY_SUPERVISOR,
];

const DISPLAY_NAMES = {
  [ROLES.NURSE_SUPERVISOR]: 'Nurse Supervisor',
  [ROLES.DOCTOR_SUPERVISOR]: 'Doctor Supervisor',
  [ROLES.LABORATORY_SUPERVISOR]: 'Laboratory Supervisor',
};

module.exports = {
  async up(queryInterface) {
    const [permissions] = await queryInterface.sequelize.query(
      'SELECT id, resource, action FROM permissions'
    );

    for (const roleName of SUPERVISOR_ROLES) {
      const [existing] = await queryInterface.sequelize.query(
        'SELECT id FROM roles WHERE name = :name LIMIT 1',
        { replacements: { name: roleName } }
      );
      if (existing.length > 0) continue;

      await queryInterface.bulkInsert('roles', [{
        name: roleName,
        display_name: DISPLAY_NAMES[roleName] || roleName,
      }]);

      const [inserted] = await queryInterface.sequelize.query(
        'SELECT id FROM roles WHERE name = :name LIMIT 1',
        { replacements: { name: roleName } }
      );
      const roleId = inserted[0]?.id;
      if (!roleId) continue;

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
    }
  },

  async down(queryInterface) {
    for (const roleName of SUPERVISOR_ROLES) {
      const [roles] = await queryInterface.sequelize.query(
        'SELECT id FROM roles WHERE name = :name LIMIT 1',
        { replacements: { name: roleName } }
      );
      const roleId = roles[0]?.id;
      if (!roleId) continue;
      await queryInterface.bulkDelete('role_permissions', { role_id: roleId });
      await queryInterface.bulkDelete('roles', { id: roleId });
    }
  },
};
