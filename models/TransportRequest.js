'use strict';
module.exports = (sequelize, DataTypes) => {
  const TransportRequest = sequelize.define('TransportRequest', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: true },
    transport_scope: { type: DataTypes.ENUM('internal', 'external'), allowNull: false, defaultValue: 'internal' },
    facility_id: { type: DataTypes.CHAR(36), allowNull: true },
    origin_facility_name: { type: DataTypes.STRING(200) },
    origin_address: { type: DataTypes.TEXT },
    external_patient_name: { type: DataTypes.STRING(200) },
    external_patient_phone: { type: DataTypes.STRING(50) },
    from_location: { type: DataTypes.STRING(100), allowNull: false },
    to_location: { type: DataTypes.STRING(100), allowNull: false },
    equipment_required: { type: DataTypes.ENUM('wheelchair', 'stretcher', 'bed', 'walking', 'other'), allowNull: false },
    equipment_notes: { type: DataTypes.STRING(255) },
    critical_notes: { type: DataTypes.TEXT },
    /** Doctor-selected checklist at admit: [{ id, label }] or [{ id, label, checked }] */
    equipment_checklist: { type: DataTypes.JSON },
    priority: { type: DataTypes.ENUM('normal', 'urgent', 'emergency'), defaultValue: 'normal' },
    status: { type: DataTypes.ENUM('pending', 'in_transit', 'completed'), defaultValue: 'pending' },
    assigned_porter: { type: DataTypes.CHAR(36) },
    requested_by: { type: DataTypes.CHAR(36), allowNull: false },
    requested_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    started_at: { type: DataTypes.DATE },
    completed_at: { type: DataTypes.DATE },
    clinic_hospital_transfer_id: { type: DataTypes.CHAR(36) },
    origin_facility_id: { type: DataTypes.CHAR(36) },
    destination_department: { type: DataTypes.STRING(80) },
    source_admission_id: { type: DataTypes.CHAR(36) },
    target_admission_id: { type: DataTypes.CHAR(36) },
    transfer_type: { type: DataTypes.ENUM('ward_transfer', 'mortuary') },
    mortuary_record_id: { type: DataTypes.CHAR(36) },
  }, {
    tableName: 'transport_requests',
    timestamps: false,
  });

  TransportRequest.associate = (models) => {
    TransportRequest.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    TransportRequest.belongsTo(models.Facility, { foreignKey: 'facility_id', as: 'facility' });
    TransportRequest.belongsTo(models.User, { foreignKey: 'assigned_porter', as: 'porter' });
    TransportRequest.belongsTo(models.User, { foreignKey: 'requested_by', as: 'requestedBy' });
    TransportRequest.belongsTo(models.Admission, { foreignKey: 'source_admission_id', as: 'sourceAdmission' });
    TransportRequest.belongsTo(models.Admission, { foreignKey: 'target_admission_id', as: 'targetAdmission' });
    TransportRequest.belongsTo(models.MortuaryRecord, { foreignKey: 'mortuary_record_id', as: 'mortuaryRecord' });
  };

  return TransportRequest;
};
