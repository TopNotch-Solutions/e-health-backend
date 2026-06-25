'use strict';

async function columnExists(queryInterface, table, column) {
  const desc = await queryInterface.describeTable(table);
  return Boolean(desc[column]);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = [
      { name: 'planned_at', type: Sequelize.DATE, allowNull: true },
      { name: 'initiated_at', type: Sequelize.DATE, allowNull: true },
      { name: 'external_picked_up_at', type: Sequelize.DATE, allowNull: true },
      { name: 'external_picked_up_by', type: Sequelize.CHAR(36), allowNull: true, references: { model: 'users', key: 'id' } },
      { name: 'arrived_hospital_at', type: Sequelize.DATE, allowNull: true },
      { name: 'internal_picked_up_at', type: Sequelize.DATE, allowNull: true },
      { name: 'internal_picked_up_by', type: Sequelize.CHAR(36), allowNull: true, references: { model: 'users', key: 'id' } },
      { name: 'delivered_to_department_at', type: Sequelize.DATE, allowNull: true },
    ];

    for (const col of columns) {
      if (!(await columnExists(queryInterface, 'clinic_hospital_transfers', col.name))) {
        await queryInterface.addColumn('clinic_hospital_transfers', col.name, col);
      }
    }

    await queryInterface.sequelize.query(`
      UPDATE clinic_hospital_transfers
      SET planned_at = created_at
      WHERE planned_at IS NULL
    `);
    await queryInterface.sequelize.query(`
      UPDATE clinic_hospital_transfers
      SET initiated_at = updated_at
      WHERE initiated_at IS NULL AND transfer_status != 'pending_booking'
    `);
  },

  async down(queryInterface) {
    for (const name of [
      'delivered_to_department_at',
      'internal_picked_up_by',
      'internal_picked_up_at',
      'arrived_hospital_at',
      'external_picked_up_by',
      'external_picked_up_at',
      'initiated_at',
      'planned_at',
    ]) {
      if (await columnExists(queryInterface, 'clinic_hospital_transfers', name)) {
        await queryInterface.removeColumn('clinic_hospital_transfers', name);
      }
    }
  },
};
