'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('icu_daily_records', {
      id: {
        type: Sequelize.CHAR(36),
        primaryKey: true,
      },
      admission_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'admissions', key: 'id' },
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
      record_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      heart_rate: { type: Sequelize.INTEGER, allowNull: true },
      oxygen_saturation: { type: Sequelize.DECIMAL(5, 2), allowNull: true },
      respiration_rate: { type: Sequelize.INTEGER, allowNull: true },
      body_temperature: { type: Sequelize.DECIMAL(4, 1), allowNull: true },
      blood_pressure_systolic: { type: Sequelize.INTEGER, allowNull: true },
      blood_pressure_diastolic: { type: Sequelize.INTEGER, allowNull: true },
      ventilator_pressures_volumes: { type: Sequelize.TEXT, allowNull: true },
      urine_output: { type: Sequelize.STRING(120), allowNull: true },
      arterial_blood_gases: { type: Sequelize.TEXT, allowNull: true },
      neurological_checks: { type: Sequelize.TEXT, allowNull: true },
      recorded_by: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('icu_daily_records', ['admission_id', 'record_date'], {
      unique: true,
      name: 'icu_daily_records_admission_date_unique',
    });

    await queryInterface.addColumn('transport_requests', 'source_admission_id', {
      type: Sequelize.CHAR(36),
      allowNull: true,
      references: { model: 'admissions', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('transport_requests', 'target_admission_id', {
      type: Sequelize.CHAR(36),
      allowNull: true,
      references: { model: 'admissions', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('transport_requests', 'transfer_type', {
      type: Sequelize.ENUM('ward_transfer', 'mortuary'),
      allowNull: true,
    });
    await queryInterface.addColumn('transport_requests', 'mortuary_record_id', {
      type: Sequelize.CHAR(36),
      allowNull: true,
      references: { model: 'mortuary_records', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('transport_requests', 'mortuary_record_id');
    await queryInterface.removeColumn('transport_requests', 'transfer_type');
    await queryInterface.removeColumn('transport_requests', 'target_admission_id');
    await queryInterface.removeColumn('transport_requests', 'source_admission_id');
    await queryInterface.dropTable('icu_daily_records');
  },
};
