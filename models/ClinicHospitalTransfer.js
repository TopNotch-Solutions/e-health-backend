'use strict';

module.exports = (sequelize, DataTypes) => {
  const ClinicHospitalTransfer = sequelize.define('ClinicHospitalTransfer', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    clinic_facility_id: { type: DataTypes.CHAR(36), allowNull: false },
    hospital_facility_id: { type: DataTypes.CHAR(36) },
    hospital_visit_id: { type: DataTypes.CHAR(36) },
    destination_department: { type: DataTypes.STRING(80), allowNull: false },
    referral_id: { type: DataTypes.CHAR(36) },
    external_transport_id: { type: DataTypes.CHAR(36) },
    internal_transport_id: { type: DataTypes.CHAR(36) },
    transfer_status: {
      type: DataTypes.ENUM(
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
    transfer_reason: { type: DataTypes.TEXT },
    equipment_required: {
      type: DataTypes.ENUM('wheelchair', 'stretcher', 'bed', 'walking', 'other'),
    },
    equipment_notes: { type: DataTypes.STRING(255) },
    equipment_checklist: { type: DataTypes.JSON },
    external_porter_notes: { type: DataTypes.TEXT },
    internal_porter_notes: { type: DataTypes.TEXT },
    critical_notes: { type: DataTypes.TEXT },
    planned_by: { type: DataTypes.CHAR(36) },
    planned_at: { type: DataTypes.DATE },
    initiated_by: { type: DataTypes.CHAR(36) },
    initiated_at: { type: DataTypes.DATE },
    external_picked_up_by: { type: DataTypes.CHAR(36) },
    external_picked_up_at: { type: DataTypes.DATE },
    departure_confirmed_by: { type: DataTypes.CHAR(36) },
    departure_confirmed_at: { type: DataTypes.DATE },
    arrived_hospital_at: { type: DataTypes.DATE },
    internal_picked_up_by: { type: DataTypes.CHAR(36) },
    internal_picked_up_at: { type: DataTypes.DATE },
    delivered_to_department_at: { type: DataTypes.DATE },
    received_by: { type: DataTypes.CHAR(36) },
    received_at: { type: DataTypes.DATE },
    source_role: { type: DataTypes.STRING(50) },
  }, {
    tableName: 'clinic_hospital_transfers',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  ClinicHospitalTransfer.associate = (models) => {
    ClinicHospitalTransfer.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    ClinicHospitalTransfer.belongsTo(models.Visit, { foreignKey: 'hospital_visit_id', as: 'hospitalVisit' });
    ClinicHospitalTransfer.belongsTo(models.Facility, { foreignKey: 'clinic_facility_id', as: 'clinicFacility' });
    ClinicHospitalTransfer.belongsTo(models.Facility, { foreignKey: 'hospital_facility_id', as: 'hospitalFacility' });
    ClinicHospitalTransfer.belongsTo(models.Referral, { foreignKey: 'referral_id', as: 'referral' });
    ClinicHospitalTransfer.belongsTo(models.TransportRequest, { foreignKey: 'external_transport_id', as: 'externalTransport' });
    ClinicHospitalTransfer.belongsTo(models.TransportRequest, { foreignKey: 'internal_transport_id', as: 'internalTransport' });
    ClinicHospitalTransfer.belongsTo(models.User, { foreignKey: 'planned_by', as: 'plannedBy' });
    ClinicHospitalTransfer.belongsTo(models.User, { foreignKey: 'initiated_by', as: 'initiatedBy' });
    ClinicHospitalTransfer.belongsTo(models.User, { foreignKey: 'external_picked_up_by', as: 'externalPickedUpBy' });
    ClinicHospitalTransfer.belongsTo(models.User, { foreignKey: 'departure_confirmed_by', as: 'departureConfirmedBy' });
    ClinicHospitalTransfer.belongsTo(models.User, { foreignKey: 'internal_picked_up_by', as: 'internalPickedUpBy' });
    ClinicHospitalTransfer.belongsTo(models.User, { foreignKey: 'received_by', as: 'receivedBy' });
  };

  return ClinicHospitalTransfer;
};
