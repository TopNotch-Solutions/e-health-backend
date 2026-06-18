'use strict';

module.exports = (sequelize, DataTypes) => {
  const MaternityAncSession = sequelize.define('MaternityAncSession', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    visit_id: { type: DataTypes.CHAR(36), allowNull: false },
    patient_id: { type: DataTypes.CHAR(36), allowNull: false },
    session_number: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    is_first_visit: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    baseline_history: { type: DataTypes.JSON, allowNull: true },
    general_physical_exam: { type: DataTypes.JSON, allowNull: true },
    special_investigations: { type: DataTypes.JSON, allowNull: true },
    delivery_details: { type: DataTypes.JSON, allowNull: true },
    no_further_session_required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    follow_up_date: { type: DataTypes.DATEONLY, allowNull: true },
    recorded_by: { type: DataTypes.CHAR(36), allowNull: false },
    signed_off_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'maternity_anc_sessions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  MaternityAncSession.associate = (models) => {
    MaternityAncSession.belongsTo(models.Visit, { foreignKey: 'visit_id', as: 'visit' });
    MaternityAncSession.belongsTo(models.Patient, { foreignKey: 'patient_id', as: 'patient' });
    MaternityAncSession.belongsTo(models.User, { foreignKey: 'recorded_by', as: 'recordedBy' });
  };

  return MaternityAncSession;
};
