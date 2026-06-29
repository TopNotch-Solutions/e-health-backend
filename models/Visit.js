'use strict';
module.exports = (sequelize, DataTypes) => {
  const Visit = sequelize.define('Visit', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    patient_id: { type: DataTypes.CHAR(36), allowNull: false },
    facility_id: { type: DataTypes.CHAR(36), allowNull: false },
    visit_number: { type: DataTypes.STRING(20), unique: true, allowNull: false },
    visit_type: { type: DataTypes.ENUM('new', 'follow_up', 'emergency'), allowNull: false },
    status: { type: DataTypes.ENUM('in_progress', 'completed', 'discharged', 'deceased'), defaultValue: 'in_progress' },
    current_department: { type: DataTypes.STRING(50) },
    current_queue_position: { type: DataTypes.INTEGER },
    created_by: { type: DataTypes.CHAR(36), allowNull: false },
    completed_at: { type: DataTypes.DATE },
  }, {
    tableName: 'visits',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
  });

  Visit.associate = (models) => {
    Visit.belongsTo(models.Patient, { foreignKey: 'patient_id', as: 'patient' });
    Visit.belongsTo(models.Facility, { foreignKey: 'facility_id', as: 'facility' });
    Visit.belongsTo(models.User, { foreignKey: 'created_by', as: 'createdBy' });
    Visit.hasMany(models.QueueEntry, { foreignKey: 'visit_id', as: 'queueEntries' });
    Visit.hasOne(models.Vital, { foreignKey: 'visit_id', as: 'vitals' });
    Visit.hasOne(models.ScreeningAssessment, { foreignKey: 'visit_id', as: 'screeningAssessment' });
    Visit.hasOne(models.HivTestResult, { foreignKey: 'visit_id', as: 'hivTestResult' });
    Visit.hasOne(models.ArtEpisode, { foreignKey: 'visit_id', as: 'artEpisode' });
    Visit.hasOne(models.PrepEpisode, { foreignKey: 'visit_id', as: 'prepEpisode' });
    Visit.hasOne(models.DermatologyAssessment, { foreignKey: 'visit_id', as: 'dermatologyAssessment' });
    Visit.hasOne(models.PapSmearScreening, { foreignKey: 'visit_id', as: 'papSmearScreening' });
    Visit.hasOne(models.SocialWorkerAssessment, { foreignKey: 'visit_id', as: 'socialWorkerAssessment' });
    Visit.hasOne(models.FamilyPlanningRecord, { foreignKey: 'visit_id', as: 'familyPlanningRecord' });
    Visit.hasOne(models.PediatricAssessment, { foreignKey: 'visit_id', as: 'pediatricAssessment' });
    Visit.hasMany(models.EmergencyIntervention, { foreignKey: 'visit_id', as: 'emergencyInterventions' });
    Visit.hasMany(models.Consultation, { foreignKey: 'visit_id', as: 'consultations' });
    Visit.hasMany(models.Prescription, { foreignKey: 'visit_id', as: 'prescriptions' });
    Visit.hasMany(models.LabRequest, { foreignKey: 'visit_id', as: 'labRequests' });
    Visit.hasMany(models.SonarRequest, { foreignKey: 'visit_id', as: 'sonarRequests' });
    Visit.hasOne(models.Admission, { foreignKey: 'visit_id', as: 'admission' });
    Visit.hasMany(models.TransportRequest, { foreignKey: 'visit_id', as: 'transportRequests' });
    Visit.hasOne(models.ClinicHospitalTransfer, { foreignKey: 'visit_id', as: 'clinicHospitalTransfer' });
    Visit.hasMany(models.Referral, { foreignKey: 'visit_id', as: 'referrals' });
    Visit.hasOne(models.MortuaryRecord, { foreignKey: 'visit_id', as: 'mortuaryRecord' });
    Visit.hasOne(models.MaternityEpisode, { foreignKey: 'visit_id', as: 'maternityEpisode' });
    Visit.hasMany(models.MaternityAncSession, { foreignKey: 'visit_id', as: 'maternityAncSessions' });
    Visit.hasMany(models.MaternityAnwDailyRecord, { foreignKey: 'visit_id', as: 'maternityAnwRecords' });
    Visit.hasMany(models.MaternityPnwDailyRecord, { foreignKey: 'visit_id', as: 'maternityPnwRecords' });
    Visit.hasMany(models.MaternityIcuDailyRecord, { foreignKey: 'visit_id', as: 'maternityIcuRecords' });
    Visit.hasMany(models.MaternityNicuRecord, { foreignKey: 'mother_visit_id', as: 'maternityNicuRecords' });
  };

  return Visit;
};
