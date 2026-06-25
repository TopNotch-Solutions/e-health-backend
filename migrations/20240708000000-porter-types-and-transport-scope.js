'use strict';

async function columnExists(queryInterface, table, column) {
  const desc = await queryInterface.describeTable(table);
  return Boolean(desc[column]);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await columnExists(queryInterface, 'transport_requests', 'transport_scope'))) {
      await queryInterface.addColumn('transport_requests', 'transport_scope', {
        type: Sequelize.ENUM('internal', 'external'),
        allowNull: false,
        defaultValue: 'internal',
      });
    }

    if (!(await columnExists(queryInterface, 'transport_requests', 'origin_facility_name'))) {
      await queryInterface.addColumn('transport_requests', 'origin_facility_name', {
        type: Sequelize.STRING(200),
        allowNull: true,
      });
    }

    if (!(await columnExists(queryInterface, 'transport_requests', 'origin_address'))) {
      await queryInterface.addColumn('transport_requests', 'origin_address', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }

    if (!(await columnExists(queryInterface, 'transport_requests', 'external_patient_name'))) {
      await queryInterface.addColumn('transport_requests', 'external_patient_name', {
        type: Sequelize.STRING(200),
        allowNull: true,
      });
    }

    if (!(await columnExists(queryInterface, 'transport_requests', 'external_patient_phone'))) {
      await queryInterface.addColumn('transport_requests', 'external_patient_phone', {
        type: Sequelize.STRING(50),
        allowNull: true,
      });
    }

    if (!(await columnExists(queryInterface, 'transport_requests', 'facility_id'))) {
      await queryInterface.addColumn('transport_requests', 'facility_id', {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: { model: 'facilities', key: 'id' },
      });
      await queryInterface.sequelize.query(`
        UPDATE transport_requests tr
        INNER JOIN visits v ON v.id = tr.visit_id
        SET tr.facility_id = v.facility_id
        WHERE tr.facility_id IS NULL
      `);
    }

    await queryInterface.changeColumn('transport_requests', 'visit_id', {
      type: Sequelize.CHAR(36),
      allowNull: true,
      references: { model: 'visits', key: 'id' },
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('transport_requests', 'visit_id', {
      type: Sequelize.CHAR(36),
      allowNull: false,
      references: { model: 'visits', key: 'id' },
    });

    for (const col of [
      'external_patient_phone',
      'external_patient_name',
      'origin_address',
      'origin_facility_name',
      'transport_scope',
    ]) {
      if (await columnExists(queryInterface, 'transport_requests', col)) {
        await queryInterface.removeColumn('transport_requests', col);
      }
    }
  },
};
