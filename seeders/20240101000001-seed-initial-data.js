'use strict';
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { ROLES, PERMISSIONS, ROLE_PERMISSIONS } = require('../config/roles');

module.exports = {
  async up(queryInterface) {
    const facilityId = uuidv4();

    // 1. Seed facility
    await queryInterface.bulkInsert('facilities', [{
      id: facilityId,
      name: 'Central State Hospital',
      type: 'hospital',
      province: 'Khomas',
      district: 'Windhoek',
      address: '1 Hospital Road, Windhoek',
      phone: '+264612030000',
      created_at: new Date(),
    }]);

    // 2. Seed roles
    const roleRows = Object.values(ROLES).map((name) => ({
      name,
      display_name: name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    }));
    await queryInterface.bulkInsert('roles', roleRows);

    // 3. Seed permissions
    const permRows = [];
    for (const [resource, actions] of Object.entries(PERMISSIONS)) {
      for (const action of actions) {
        permRows.push({ resource, action });
      }
    }
    await queryInterface.bulkInsert('permissions', permRows);

    // 4. Seed role_permissions
    // First get inserted role and permission IDs
    const [roles] = await queryInterface.sequelize.query('SELECT id, name FROM roles');
    const [permissions] = await queryInterface.sequelize.query('SELECT id, resource, action FROM permissions');

    const rolePermRows = [];
    for (const [roleName, perms] of Object.entries(ROLE_PERMISSIONS)) {
      const role = roles.find(r => r.name === roleName);
      if (!role) continue;
      for (const [resource, actions] of Object.entries(perms)) {
        for (const action of actions) {
          const perm = permissions.find(p => p.resource === resource && p.action === action);
          if (perm) {
            rolePermRows.push({ role_id: role.id, permission_id: perm.id });
          }
        }
      }
    }
    await queryInterface.bulkInsert('role_permissions', rolePermRows);

    // 5. Seed admin user
    const adminRole = roles.find(r => r.name === 'system_admin');
    const passwordHash = await bcrypt.hash('admin123', 10);

    await queryInterface.bulkInsert('users', [{
      id: uuidv4(),
      facility_id: facilityId,
      role_id: adminRole.id,
      employee_id: 'EMP-001',
      first_name: 'System',
      last_name: 'Administrator',
      email: 'admin@ehealth.gov',
      password_hash: passwordHash,
      phone: '+264612030001',
      is_active: true,
      created_at: new Date(),
    }]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('users', null, {});
    await queryInterface.bulkDelete('role_permissions', null, {});
    await queryInterface.bulkDelete('permissions', null, {});
    await queryInterface.bulkDelete('roles', null, {});
    await queryInterface.bulkDelete('facilities', null, {});
  },
};
