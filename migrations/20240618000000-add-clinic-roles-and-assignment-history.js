'use strict';

const { v4: uuidv4 } = require('uuid');
const { AUTHORIZED_CLINIC_ROLES } = require('../config/clinicRoles');
const { ROLE_PERMISSIONS } = require('../config/roles');
const { tableExists } = require('./utils/columnHelpers');
const NEW_CLINIC_ROLE_SLUGS = [
  'parameter_nurse',
  'screening_nurse',
  'anc_nurse',
  'pediatric_corner',
  'prep_suite',
  'pap_smear_suite',
  'family_planner',
  'hiv_tester',
  'emergency_unit_nurse',
  'emergency_unit_doctor',
  'booking_room',
  'art_nurse',
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const [permissions] = await queryInterface.sequelize.query(
      'SELECT id, resource, action FROM permissions'
    );

    for (const roleName of NEW_CLINIC_ROLE_SLUGS) {
      const [existing] = await queryInterface.sequelize.query(
        'SELECT id FROM roles WHERE name = :name LIMIT 1',
        { replacements: { name: roleName } }
      );
      if (existing.length > 0) continue;

      await queryInterface.bulkInsert('roles', [{
        name: roleName,
        display_name: AUTHORIZED_CLINIC_ROLES[roleName] || roleName,
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

    if (!(await tableExists(queryInterface, 'employee_facility_assignments'))) {
      await queryInterface.createTable('employee_facility_assignments', {
        id: {
        type: Sequelize.CHAR(36),
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      facility_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'facilities', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      role_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'roles', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      started_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      ended_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      transferred_by: {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

      await queryInterface.addIndex('employee_facility_assignments', ['user_id']);
      await queryInterface.addIndex('employee_facility_assignments', ['facility_id']);
    }

    const [existingAssignments] = await queryInterface.sequelize.query(
      'SELECT 1 AS ok FROM employee_facility_assignments LIMIT 1'
    );
    if (existingAssignments.length > 0) return;

    // Backfill open assignments for existing employees.
    const [users] = await queryInterface.sequelize.query(
      'SELECT id, facility_id, role_id, created_at FROM users'
    );
    if (users.length) {
      const now = new Date();
      await queryInterface.bulkInsert(
        'employee_facility_assignments',
        users.map((u) => ({
          id: uuidv4(),
          user_id: u.id,
          facility_id: u.facility_id,
          role_id: u.role_id,
          started_at: u.created_at || now,
          ended_at: null,
          transferred_by: null,
          notes: 'Initial assignment (backfilled)',
          created_at: now,
        }))
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('employee_facility_assignments');

    for (const roleName of NEW_CLINIC_ROLE_SLUGS) {
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
