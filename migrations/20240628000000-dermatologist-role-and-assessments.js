'use strict';

const { ROLES, ROLE_PERMISSIONS } = require('../config/roles');
const { AUTHORIZED_CLINIC_ROLES } = require('../config/clinicRoles');
const { tableExists } = require('./utils/columnHelpers');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const roleName = 'dermatologist';
    const [existingRole] = await queryInterface.sequelize.query(
      'SELECT id FROM roles WHERE name = :name LIMIT 1',
      { replacements: { name: roleName } }
    );
    if (existingRole.length === 0) {
      await queryInterface.bulkInsert('roles', [{
        name: roleName,
        display_name: AUTHORIZED_CLINIC_ROLES[roleName] || 'Dermatologist',
      }]);

      const [inserted] = await queryInterface.sequelize.query(
        'SELECT id FROM roles WHERE name = :name LIMIT 1',
        { replacements: { name: roleName } }
      );
      const roleId = inserted[0]?.id;
      const [permissions] = await queryInterface.sequelize.query(
        'SELECT id, resource, action FROM permissions'
      );
      const perms = ROLE_PERMISSIONS[roleName] || ROLE_PERMISSIONS[ROLES.DOCTOR] || {};
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

    if (await tableExists(queryInterface, 'dermatology_assessments')) return;

    await queryInterface.createTable('dermatology_assessments', {
      id: {
        type: Sequelize.CHAR(36),
        primaryKey: true,
      },
      visit_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'visits', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      patient_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'patients', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      assessed_by: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      clinical_observations: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      skin_assessment: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      differential_diagnosis: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      treatment_plan: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      observations_saved: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      observations_saved_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      routed_to_booking_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('dermatology_assessments', ['visit_id']);
    await queryInterface.addIndex('dermatology_assessments', ['patient_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('dermatology_assessments');
  },
};
