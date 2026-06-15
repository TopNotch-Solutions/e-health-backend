'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('icd10_codes', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      icd10_code: { type: Sequelize.STRING(20), allowNull: false, unique: true },
      description: { type: Sequelize.TEXT, allowNull: false },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('icd10_codes');
  },
};
