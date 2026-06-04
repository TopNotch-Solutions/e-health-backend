'use strict';

const { tableExists } = require('./utils/columnHelpers');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    if (await tableExists(queryInterface, 'prep_episodes')) return;

    await queryInterface.createTable('prep_episodes', {
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
      administered_by: {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      status: {
        type: Sequelize.ENUM('active', 'completed'),
        allowNull: false,
        defaultValue: 'active',
      },
      injection_administered: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      session_data: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: '{}',
      },
      enrolled_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      injection_administered_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      completed_at: {
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

    await queryInterface.addIndex('prep_episodes', ['patient_id']);
    await queryInterface.addIndex('prep_episodes', ['visit_id']);
    await queryInterface.addIndex('prep_episodes', ['status']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('prep_episodes');
  },
};
