'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('clinic_hospital_transfers', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      visit_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'visits', key: 'id' },
      },
      clinic_facility_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'facilities', key: 'id' },
      },
      hospital_facility_id: {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: { model: 'facilities', key: 'id' },
      },
      hospital_visit_id: {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: { model: 'visits', key: 'id' },
      },
      destination_department: { type: Sequelize.STRING(80), allowNull: false },
      referral_id: {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: { model: 'referrals', key: 'id' },
      },
      external_transport_id: {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: { model: 'transport_requests', key: 'id' },
      },
      internal_transport_id: {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: { model: 'transport_requests', key: 'id' },
      },
      transfer_status: {
        type: Sequelize.ENUM(
          'pending_booking',
          'transport_initiated',
          'external_in_transit',
          'departed_clinic',
          'arrived_hospital',
          'internal_in_transit',
          'delivered_to_department',
          'received',
          'cancelled'
        ),
        allowNull: false,
        defaultValue: 'pending_booking',
      },
      transfer_reason: { type: Sequelize.TEXT },
      equipment_required: {
        type: Sequelize.ENUM('wheelchair', 'stretcher', 'bed', 'walking', 'other'),
        allowNull: true,
      },
      equipment_notes: { type: Sequelize.STRING(255) },
      equipment_checklist: { type: Sequelize.JSON },
      external_porter_notes: { type: Sequelize.TEXT },
      internal_porter_notes: { type: Sequelize.TEXT },
      critical_notes: { type: Sequelize.TEXT },
      planned_by: {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      initiated_by: {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      departure_confirmed_by: {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      departure_confirmed_at: { type: Sequelize.DATE },
      received_by: {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      received_at: { type: Sequelize.DATE },
      source_role: { type: Sequelize.STRING(50), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP') },
    });

    await queryInterface.addColumn('referrals', 'destination_facility_id', {
      type: Sequelize.CHAR(36),
      allowNull: true,
      references: { model: 'facilities', key: 'id' },
    });
    await queryInterface.addColumn('referrals', 'destination_department', {
      type: Sequelize.STRING(80),
      allowNull: true,
    });
    await queryInterface.addColumn('referrals', 'clinic_hospital_transfer_id', {
      type: Sequelize.CHAR(36),
      allowNull: true,
      references: { model: 'clinic_hospital_transfers', key: 'id' },
    });

    await queryInterface.addColumn('transport_requests', 'clinic_hospital_transfer_id', {
      type: Sequelize.CHAR(36),
      allowNull: true,
      references: { model: 'clinic_hospital_transfers', key: 'id' },
    });
    await queryInterface.addColumn('transport_requests', 'origin_facility_id', {
      type: Sequelize.CHAR(36),
      allowNull: true,
      references: { model: 'facilities', key: 'id' },
    });
    await queryInterface.addColumn('transport_requests', 'destination_department', {
      type: Sequelize.STRING(80),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('transport_requests', 'destination_department');
    await queryInterface.removeColumn('transport_requests', 'origin_facility_id');
    await queryInterface.removeColumn('transport_requests', 'clinic_hospital_transfer_id');
    await queryInterface.removeColumn('referrals', 'clinic_hospital_transfer_id');
    await queryInterface.removeColumn('referrals', 'destination_department');
    await queryInterface.removeColumn('referrals', 'destination_facility_id');
    await queryInterface.dropTable('clinic_hospital_transfers');
  },
};
