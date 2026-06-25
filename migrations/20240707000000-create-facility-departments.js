'use strict';

const { tableExists } = require('./utils/columnHelpers');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await tableExists(queryInterface, 'facility_departments'))) {
      await queryInterface.createTable('facility_departments', {
        id: { type: Sequelize.CHAR(36), primaryKey: true },
        facility_id: {
          type: Sequelize.CHAR(36),
          allowNull: false,
          references: { model: 'facilities', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        department_key: { type: Sequelize.STRING(50), allowNull: false },
        is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      });
      await queryInterface.addIndex('facility_departments', ['facility_id']);
      await queryInterface.addIndex('facility_departments', ['facility_id', 'department_key'], {
        unique: true,
        name: 'facility_departments_facility_key_unique',
      });
    }

    if (!(await tableExists(queryInterface, 'facility_department_changes'))) {
      await queryInterface.createTable('facility_department_changes', {
        id: { type: Sequelize.CHAR(36), primaryKey: true },
        facility_id: {
          type: Sequelize.CHAR(36),
          allowNull: false,
          references: { model: 'facilities', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        department_key: { type: Sequelize.STRING(50), allowNull: false },
        action: { type: Sequelize.ENUM('added', 'removed'), allowNull: false },
        reason: { type: Sequelize.TEXT, allowNull: false },
        changed_by: {
          type: Sequelize.CHAR(36),
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      });
      await queryInterface.addIndex('facility_department_changes', ['facility_id']);
      await queryInterface.addIndex('facility_department_changes', ['department_key']);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('facility_department_changes');
    await queryInterface.dropTable('facility_departments');
  },
};
