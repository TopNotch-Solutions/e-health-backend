'use strict';
module.exports = (sequelize, DataTypes) => {
  const Ward = sequelize.define('Ward', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    facility_id: { type: DataTypes.CHAR(36), allowNull: false },
    name: { type: DataTypes.STRING(100), allowNull: false },
    ward_number: { type: DataTypes.STRING(20), allowNull: false },
    ward_type: {
      type: DataTypes.ENUM(
        'general',
        'maternity',
        'pediatric',
        'icu',
        'surgical_complex',
        'specialized_inpatient',
        'outpatient_specialist',
        'psychiatric',
        'adult_outpatient'
      ),
      allowNull: false,
    },
    supervisor_id: { type: DataTypes.CHAR(36) },
    total_beds: { type: DataTypes.INTEGER, defaultValue: 0 },
  }, {
    tableName: 'wards',
    timestamps: false,
  });

  Ward.associate = (models) => {
    Ward.belongsTo(models.Facility, { foreignKey: 'facility_id', as: 'facility' });
    Ward.belongsTo(models.User, { foreignKey: 'supervisor_id', as: 'supervisor' });
    Ward.hasMany(models.Bed, { foreignKey: 'ward_id', as: 'beds' });
  };

  return Ward;
};
