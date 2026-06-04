'use strict';

const { tableExists } = require('./utils/columnHelpers');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    if (await tableExists(queryInterface, 'social_worker_assessments')) return;

    await queryInterface.createTable('social_worker_assessments', {
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
      social_assessment_details: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      case_history: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      clinical_notes: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      severity: {
        type: Sequelize.ENUM('routine', 'severe'),
        allowNull: false,
      },
      assessment_saved: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      assessment_saved_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      escalated_to_booking_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      session_completed_at: {
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

    await queryInterface.addIndex('social_worker_assessments', ['visit_id']);
    await queryInterface.addIndex('social_worker_assessments', ['patient_id']);
    await queryInterface.addIndex('social_worker_assessments', ['severity']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('social_worker_assessments');
  },
};
