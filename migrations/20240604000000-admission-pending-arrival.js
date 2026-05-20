'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('admissions', 'admitted_at', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
    });

    await queryInterface.changeColumn('admissions', 'status', {
      type: Sequelize.ENUM('pending_arrival', 'admitted', 'discharged', 'transferred', 'deceased'),
      defaultValue: 'pending_arrival',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      "UPDATE admissions SET status = 'admitted' WHERE status = 'pending_arrival'"
    );

    await queryInterface.changeColumn('admissions', 'status', {
      type: Sequelize.ENUM('admitted', 'discharged', 'transferred', 'deceased'),
      defaultValue: 'admitted',
    });

    await queryInterface.changeColumn('admissions', 'admitted_at', {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    });
  },
};
