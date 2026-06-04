'use strict';

const { tableExists } = require('./utils/columnHelpers');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    if (await tableExists(queryInterface, 'family_planning_records')) return;

    await queryInterface.createTable('family_planning_records', {
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
      recorded_by: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      subdermal_insertion_date: { type: Sequelize.DATEONLY, allowNull: true },
      subdermal_insertion_notes: { type: Sequelize.TEXT, allowNull: true },
      subdermal_replacement_date: { type: Sequelize.DATEONLY, allowNull: true },
      subdermal_replacement_notes: { type: Sequelize.TEXT, allowNull: true },
      device_type: { type: Sequelize.STRING(80), allowNull: true },
      device_insertion_date: { type: Sequelize.DATEONLY, allowNull: true },
      device_insertion_notes: { type: Sequelize.TEXT, allowNull: true },
      device_removal_date: { type: Sequelize.DATEONLY, allowNull: true },
      device_removal_notes: { type: Sequelize.TEXT, allowNull: true },
      oral_contraceptive_log: { type: Sequelize.JSON, allowNull: true },
      circumcision_surgical_criteria: { type: Sequelize.TEXT, allowNull: true },
      circumcision_procedure_notes: { type: Sequelize.TEXT, allowNull: true },
      circumcision_post_op_metrics: { type: Sequelize.TEXT, allowNull: true },
      record_saved: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      record_saved_at: { type: Sequelize.DATE, allowNull: true },
      routed_to_pharmacy_at: { type: Sequelize.DATE, allowNull: true },
      session_completed_at: { type: Sequelize.DATE, allowNull: true },
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

    await queryInterface.addIndex('family_planning_records', ['visit_id']);
    await queryInterface.addIndex('family_planning_records', ['patient_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('family_planning_records');
  },
};
