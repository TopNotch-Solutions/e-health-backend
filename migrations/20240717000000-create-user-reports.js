'use strict';

const { ROLE_PERMISSIONS } = require('../config/roles');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_reports', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      reported_by: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      issue_type: {
        type: Sequelize.ENUM('enquiry', 'issue', 'improvement'),
        allowNull: false,
      },
      description: { type: Sequelize.STRING(360), allowNull: false },
      image_path: { type: Sequelize.STRING(500), allowNull: true },
      status: {
        type: Sequelize.ENUM('pending', 'in_progress', 'completed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      admin_response: { type: Sequelize.TEXT, allowNull: true },
      responded_by: {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      responded_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('user_reports', ['reported_by']);
    await queryInterface.addIndex('user_reports', ['status']);
    await queryInterface.addIndex('user_reports', ['created_at']);

    const actions = ['create', 'read', 'update'];
    const [existingPerms] = await queryInterface.sequelize.query(
      "SELECT id, resource, action FROM permissions WHERE resource = 'user_report'"
    );
    const permByAction = new Map(existingPerms.map((p) => [p.action, p.id]));

    for (const action of actions) {
      if (!permByAction.has(action)) {
        await queryInterface.bulkInsert('permissions', [{ resource: 'user_report', action }]);
      }
    }

    const [permissions] = await queryInterface.sequelize.query(
      "SELECT id, resource, action FROM permissions WHERE resource = 'user_report'"
    );
    const [roles] = await queryInterface.sequelize.query('SELECT id, name FROM roles');
    const rows = [];

    for (const role of roles) {
      const perms = ROLE_PERMISSIONS[role.name];
      if (!perms?.user_report) continue;
      const [existingRp] = await queryInterface.sequelize.query(
        'SELECT permission_id FROM role_permissions WHERE role_id = :roleId',
        { replacements: { roleId: role.id } }
      );
      const linked = new Set(existingRp.map((r) => r.permission_id));
      for (const action of perms.user_report) {
        const perm = permissions.find((p) => p.action === action);
        if (perm && !linked.has(perm.id)) {
          rows.push({ role_id: role.id, permission_id: perm.id });
        }
      }
    }

    if (rows.length) {
      await queryInterface.bulkInsert('role_permissions', rows);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_reports');
    await queryInterface.sequelize.query(
      "DELETE rp FROM role_permissions rp INNER JOIN permissions p ON p.id = rp.permission_id WHERE p.resource = 'user_report'"
    );
    await queryInterface.sequelize.query("DELETE FROM permissions WHERE resource = 'user_report'");
  },
};
