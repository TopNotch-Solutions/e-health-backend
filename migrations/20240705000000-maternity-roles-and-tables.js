'use strict';

const { ROLES, ROLE_PERMISSIONS } = require('../config/roles');
const { MATERNITY_ROLE_LABELS } = require('../config/maternityConfig');
const { tableExists } = require('./utils/columnHelpers');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const maternityRoles = [
      ROLES.MATERNITY_FRONT_OFFICER,
      ROLES.MATERNITY_ANC_STAFF,
      ROLES.MATERNITY_ANW_STAFF,
      ROLES.MATERNITY_PNW_STAFF,
      ROLES.MATERNITY_ICU_STAFF,
      ROLES.MATERNITY_NICU_STAFF,
    ];

    const [permissions] = await queryInterface.sequelize.query(
      'SELECT id, resource, action FROM permissions'
    );

    for (const roleName of maternityRoles) {
      const [existing] = await queryInterface.sequelize.query(
        'SELECT id FROM roles WHERE name = :name LIMIT 1',
        { replacements: { name: roleName } }
      );
      if (existing.length > 0) continue;

      await queryInterface.bulkInsert('roles', [{
        name: roleName,
        display_name: MATERNITY_ROLE_LABELS[roleName] || roleName,
      }]);

      const [inserted] = await queryInterface.sequelize.query(
        'SELECT id FROM roles WHERE name = :name LIMIT 1',
        { replacements: { name: roleName } }
      );
      const roleId = inserted[0]?.id;
      if (!roleId) continue;

      const perms = ROLE_PERMISSIONS[roleName] || {};
      const rows = [];
      for (const [resource, actions] of Object.entries(perms)) {
        for (const action of actions) {
          const perm = permissions.find((p) => p.resource === resource && p.action === action);
          if (perm) rows.push({ role_id: roleId, permission_id: perm.id });
        }
      }
      if (rows.length) {
        await queryInterface.bulkInsert('role_permissions', rows);
      }
    }

    const ts = {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    };

    if (!(await tableExists(queryInterface, 'maternity_episodes'))) {
      await queryInterface.createTable('maternity_episodes', {
        id: { type: Sequelize.CHAR(36), primaryKey: true },
        visit_id: {
          type: Sequelize.CHAR(36), allowNull: false, unique: true,
          references: { model: 'visits', key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'CASCADE',
        },
        patient_id: {
          type: Sequelize.CHAR(36), allowNull: false,
          references: { model: 'patients', key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'CASCADE',
        },
        current_ward: { type: Sequelize.ENUM('anw', 'pnw', 'icu'), allowNull: true },
        admitted_at: { type: Sequelize.DATE, allowNull: true },
        discharged_at: { type: Sequelize.DATE, allowNull: true },
        front_office_visits: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        anw_days: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        pnw_days: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        icu_days: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        feeding_counselling_done: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        six_week_follow_up_date: { type: Sequelize.DATEONLY, allowNull: true },
        status: { type: Sequelize.ENUM('active', 'discharged'), allowNull: false, defaultValue: 'active' },
        created_at: ts,
        updated_at: ts,
      });
      await queryInterface.addIndex('maternity_episodes', ['patient_id']);
    }

    if (!(await tableExists(queryInterface, 'maternity_anc_sessions'))) {
      await queryInterface.createTable('maternity_anc_sessions', {
        id: { type: Sequelize.CHAR(36), primaryKey: true },
        visit_id: {
          type: Sequelize.CHAR(36), allowNull: false,
          references: { model: 'visits', key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'CASCADE',
        },
        patient_id: {
          type: Sequelize.CHAR(36), allowNull: false,
          references: { model: 'patients', key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'CASCADE',
        },
        session_number: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
        is_first_visit: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        baseline_history: { type: Sequelize.JSON, allowNull: true },
        general_physical_exam: { type: Sequelize.JSON, allowNull: true },
        special_investigations: { type: Sequelize.JSON, allowNull: true },
        delivery_details: { type: Sequelize.JSON, allowNull: true },
        no_further_session_required: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        follow_up_date: { type: Sequelize.DATEONLY, allowNull: true },
        recorded_by: {
          type: Sequelize.CHAR(36), allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'RESTRICT',
        },
        signed_off_at: { type: Sequelize.DATE, allowNull: true },
        created_at: ts,
        updated_at: ts,
      });
      await queryInterface.addIndex('maternity_anc_sessions', ['visit_id']);
    }

    const dailyRecordTable = async (name, extraCols) => {
      if (await tableExists(queryInterface, name)) return;
      await queryInterface.createTable(name, {
        id: { type: Sequelize.CHAR(36), primaryKey: true },
        episode_id: {
          type: Sequelize.CHAR(36), allowNull: false,
          references: { model: 'maternity_episodes', key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'CASCADE',
        },
        visit_id: {
          type: Sequelize.CHAR(36), allowNull: false,
          references: { model: 'visits', key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'CASCADE',
        },
        record_date: { type: Sequelize.DATEONLY, allowNull: false },
        recorded_by: {
          type: Sequelize.CHAR(36), allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'RESTRICT',
        },
        signed_off_at: { type: Sequelize.DATE, allowNull: true },
        ...extraCols,
        created_at: ts,
        updated_at: ts,
      });
      await queryInterface.addIndex(name, ['episode_id', 'record_date'], { unique: true });
    };

    await dailyRecordTable('maternity_anw_daily_records', {
      is_admission_day: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      admission_reason: { type: Sequelize.TEXT, allowNull: true },
      mode_of_arrival: { type: Sequelize.STRING(50), allowNull: true },
      vitals: { type: Sequelize.JSON, allowNull: true },
      abdominal_update: { type: Sequelize.JSON, allowNull: true },
      active_labour: { type: Sequelize.JSON, allowNull: true },
      serial_progress: { type: Sequelize.JSON, allowNull: true },
    });

    await dailyRecordTable('maternity_pnw_daily_records', {
      is_post_delivery_day: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      delivery_type: { type: Sequelize.STRING(100), allowNull: true },
      post_op_recovery: { type: Sequelize.TEXT, allowNull: true },
      vitals: { type: Sequelize.JSON, allowNull: true },
      uterine_index: { type: Sequelize.JSON, allowNull: true },
      physiological_output: { type: Sequelize.JSON, allowNull: true },
      breast_examination: { type: Sequelize.JSON, allowNull: true },
    });

    await dailyRecordTable('maternity_icu_daily_records', {
      extreme_indicators: { type: Sequelize.JSON, allowNull: true },
      continuous_parameters: { type: Sequelize.JSON, allowNull: true },
      multiple_origin_tracking: { type: Sequelize.JSON, allowNull: true },
    });

    if (!(await tableExists(queryInterface, 'maternity_nicu_records'))) {
      await queryInterface.createTable('maternity_nicu_records', {
        id: { type: Sequelize.CHAR(36), primaryKey: true },
        mother_patient_id: {
          type: Sequelize.CHAR(36), allowNull: false,
          references: { model: 'patients', key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'CASCADE',
        },
        mother_visit_id: {
          type: Sequelize.CHAR(36), allowNull: false,
          references: { model: 'visits', key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'CASCADE',
        },
        child_patient_id: {
          type: Sequelize.CHAR(36), allowNull: true,
          references: { model: 'patients', key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'SET NULL',
        },
        date_time_of_birth: { type: Sequelize.DATE, allowNull: false },
        sex: { type: Sequelize.ENUM('male', 'female', 'other'), allowNull: false },
        name: { type: Sequelize.STRING(150), allowNull: true },
        gestation_weeks: { type: Sequelize.INTEGER, allowNull: true },
        clinical_status: { type: Sequelize.JSON, allowNull: true },
        apgar_matrix: { type: Sequelize.JSON, allowNull: true },
        recorded_by: {
          type: Sequelize.CHAR(36), allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'RESTRICT',
        },
        created_at: ts,
        updated_at: ts,
      });
      await queryInterface.addIndex('maternity_nicu_records', ['mother_visit_id']);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('maternity_nicu_records');
    await queryInterface.dropTable('maternity_icu_daily_records');
    await queryInterface.dropTable('maternity_pnw_daily_records');
    await queryInterface.dropTable('maternity_anw_daily_records');
    await queryInterface.dropTable('maternity_anc_sessions');
    await queryInterface.dropTable('maternity_episodes');
  },
};
