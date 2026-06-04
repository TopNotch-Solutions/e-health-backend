'use strict';

const { tableExists } = require('./utils/columnHelpers');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    if (await tableExists(queryInterface, 'pediatric_assessments')) return;

    await queryInterface.createTable('pediatric_assessments', {
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
      temperature: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
      },
      weight: {
        type: Sequelize.DECIMAL(7, 2),
        allowNull: false,
      },
      general_assessment: {
        type: Sequelize.TEXT,
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
      routed_to_master_doctor_at: {
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

    await queryInterface.addIndex('pediatric_assessments', ['visit_id']);
    await queryInterface.addIndex('pediatric_assessments', ['patient_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('pediatric_assessments');
  },
};
