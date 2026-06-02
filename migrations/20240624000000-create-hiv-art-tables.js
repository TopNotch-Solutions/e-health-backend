'use strict';

const { tableExists } = require('./utils/columnHelpers');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await tableExists(queryInterface, 'hiv_test_results'))) {
      await queryInterface.createTable('hiv_test_results', {
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
        result: {
          type: Sequelize.ENUM('negative', 'positive'),
          allowNull: false,
        },
        tested_by: {
          type: Sequelize.CHAR(36),
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        test_method: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        kit_batch: {
          type: Sequelize.STRING(80),
          allowNull: true,
        },
        notes: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      });
      await queryInterface.addIndex('hiv_test_results', ['visit_id']);
      await queryInterface.addIndex('hiv_test_results', ['patient_id']);
    }

    if (!(await tableExists(queryInterface, 'art_episodes'))) {
      await queryInterface.createTable('art_episodes', {
        id: {
          type: Sequelize.CHAR(36),
          primaryKey: true,
        },
        patient_id: {
          type: Sequelize.CHAR(36),
          allowNull: false,
          references: { model: 'patients', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        visit_id: {
          type: Sequelize.CHAR(36),
          allowNull: false,
          references: { model: 'visits', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        hiv_test_result_id: {
          type: Sequelize.CHAR(36),
          allowNull: true,
          references: { model: 'hiv_test_results', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        enrolled_by: {
          type: Sequelize.CHAR(36),
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        pathway_state: {
          type: Sequelize.ENUM('day_1', 'week_1', 'month_1', 'month_3_6', 'maintenance'),
          allowNull: false,
          defaultValue: 'day_1',
        },
        state_entered_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        enrolled_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        status: {
          type: Sequelize.ENUM('active', 'transferred', 'closed'),
          allowNull: false,
          defaultValue: 'active',
        },
        pathway_data: {
          type: Sequelize.JSON,
          allowNull: false,
          defaultValue: '{}',
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
      await queryInterface.addIndex('art_episodes', ['patient_id']);
      await queryInterface.addIndex('art_episodes', ['visit_id']);
      await queryInterface.addIndex('art_episodes', ['status']);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('art_episodes');
    await queryInterface.dropTable('hiv_test_results');
  },
};
