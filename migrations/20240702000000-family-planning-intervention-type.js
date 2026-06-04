'use strict';

const { tableExists, addColumnIfMissing } = require('./utils/columnHelpers');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await tableExists(queryInterface, 'family_planning_records'))) return;

    await addColumnIfMissing(queryInterface, 'family_planning_records', 'intervention_type', {
      type: Sequelize.ENUM('subdermal', 'device', 'oral'),
      allowNull: true,
    });

    await queryInterface.sequelize.query(`
      UPDATE family_planning_records
      SET intervention_type = CASE
        WHEN oral_contraceptive_log IS NOT NULL
          AND JSON_LENGTH(oral_contraceptive_log) > 0 THEN 'oral'
        WHEN device_insertion_notes IS NOT NULL OR device_removal_notes IS NOT NULL THEN 'device'
        WHEN subdermal_insertion_notes IS NOT NULL OR subdermal_replacement_notes IS NOT NULL THEN 'subdermal'
        ELSE NULL
      END
      WHERE intervention_type IS NULL
    `);
  },

  async down(queryInterface) {
    const { removeColumnIfExists } = require('./utils/columnHelpers');
    await removeColumnIfExists(queryInterface, 'family_planning_records', 'intervention_type');
  },
};
