'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('surgical_complex_daily_records', {
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
      pulse_oximetry_spo2: { type: Sequelize.DECIMAL(5, 2), allowNull: true },
      capnography_etco2: { type: Sequelize.STRING(120), allowNull: true },
      fio2: { type: Sequelize.STRING(80), allowNull: true },
      anesthesia_neuro_monitoring: { type: Sequelize.TEXT, allowNull: true },
      neuromuscular_tof: { type: Sequelize.STRING(120), allowNull: true },
      pain_sedation_scores: { type: Sequelize.TEXT, allowNull: true },
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

    await queryInterface.addIndex('surgical_complex_daily_records', ['admission_id', 'record_date'], {
      unique: true,
      name: 'sc_daily_records_admission_date_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('surgical_complex_daily_records');
  },
};
