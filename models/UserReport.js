'use strict';

module.exports = (sequelize, DataTypes) => {
  const UserReport = sequelize.define('UserReport', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    reported_by: { type: DataTypes.CHAR(36), allowNull: false },
    issue_type: {
      type: DataTypes.ENUM('enquiry', 'issue', 'improvement'),
      allowNull: false,
    },
    description: { type: DataTypes.STRING(360), allowNull: false },
    image_path: { type: DataTypes.STRING(500), allowNull: true },
    status: {
      type: DataTypes.ENUM('pending', 'in_progress', 'completed'),
      allowNull: false,
      defaultValue: 'pending',
    },
    admin_response: { type: DataTypes.TEXT, allowNull: true },
    responded_by: { type: DataTypes.CHAR(36), allowNull: true },
    responded_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'user_reports',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  UserReport.associate = (models) => {
    UserReport.belongsTo(models.User, { foreignKey: 'reported_by', as: 'reporter' });
    UserReport.belongsTo(models.User, { foreignKey: 'responded_by', as: 'responder' });
  };

  return UserReport;
};
