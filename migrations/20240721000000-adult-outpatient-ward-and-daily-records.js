'use strict';

const { enumColumnIncludes } = require('./utils/columnHelpers');

const WARD_TYPES = [
  'general',
  'maternity',
  'pediatric',
  'icu',
  'surgical_complex',
  'specialized_inpatient',
  'outpatient_specialist',
  'psychiatric',
  'adult_outpatient',
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const hasAdultOutpatient = await enumColumnIncludes(
      queryInterface,
      'wards',
      'ward_type',
      'adult_outpatient'
    );
    if (!hasAdultOutpatient) {
      await queryInterface.changeColumn('wards', 'ward_type', {
        type: Sequelize.ENUM(...WARD_TYPES),
        allowNull: false,
      });
    }

    await queryInterface.createTable('adult_outpatient_daily_records', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
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
      record_date: { type: Sequelize.DATEONLY, allowNull: false },
      heart_rate: { type: Sequelize.INTEGER, allowNull: true },
      oxygen_saturation: { type: Sequelize.DECIMAL(5, 2), allowNull: true },
      respiration_rate: { type: Sequelize.INTEGER, allowNull: true },
      body_temperature: { type: Sequelize.DECIMAL(4, 1), allowNull: true },
      blood_pressure_systolic: { type: Sequelize.INTEGER, allowNull: true },
      blood_pressure_diastolic: { type: Sequelize.INTEGER, allowNull: true },
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

    await queryInterface.addIndex('adult_outpatient_daily_records', ['admission_id', 'record_date'], {
      unique: true,
      name: 'ao_daily_records_admission_date_unique',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('adult_outpatient_daily_records');

    const hasAdultOutpatient = await enumColumnIncludes(
      queryInterface,
      'wards',
      'ward_type',
      'adult_outpatient'
    );
    if (hasAdultOutpatient) {
      await queryInterface.changeColumn('wards', 'ward_type', {
        type: Sequelize.ENUM(
          'general',
          'maternity',
          'pediatric',
          'icu',
          'surgical_complex',
          'specialized_inpatient',
          'outpatient_specialist',
          'psychiatric'
        ),
        allowNull: false,
      });
    }
  },
};
