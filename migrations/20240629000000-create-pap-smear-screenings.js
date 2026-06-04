'use strict';

const { tableExists } = require('./utils/columnHelpers');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    if (await tableExists(queryInterface, 'pap_smear_screenings')) return;

    await queryInterface.createTable('pap_smear_screenings', {
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
      screened_by: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      screening_details: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      test_observations: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      clinical_findings: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      severity: {
        type: Sequelize.ENUM('routine', 'severe'),
        allowNull: false,
      },
      findings_saved: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      findings_saved_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      escalated_to_master_doctor_at: {
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

    await queryInterface.addIndex('pap_smear_screenings', ['visit_id']);
    await queryInterface.addIndex('pap_smear_screenings', ['patient_id']);
    await queryInterface.addIndex('pap_smear_screenings', ['severity']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('pap_smear_screenings');
  },
};
