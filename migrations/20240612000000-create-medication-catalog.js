'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('medication_catalog', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      medication_name: { type: Sequelize.STRING(255), allowNull: false, unique: true },
      generic_name: { type: Sequelize.STRING(255), allowNull: false },
      category: { type: Sequelize.STRING(100) },
      unit_price: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('medication_catalog');
  },
};
