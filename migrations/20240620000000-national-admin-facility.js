'use strict';

const { NATIONAL_ADMIN_FACILITY_NAME } = require('../utils/nationalAdmin');

module.exports = {
  async up(queryInterface) {
    const [[existing]] = await queryInterface.sequelize.query(
      `SELECT id FROM facilities WHERE name = :name LIMIT 1`,
      { replacements: { name: NATIONAL_ADMIN_FACILITY_NAME } }
    );

    let facilityId = existing?.id;
    if (!facilityId) {
      const { v4: uuidv4 } = require('uuid');
      facilityId = uuidv4();
      await queryInterface.bulkInsert('facilities', [{
        id: facilityId,
        name: NATIONAL_ADMIN_FACILITY_NAME,
        type: 'health_center',
        province: 'National',
        district: 'Central Administration',
        address: 'National e-health administration office',
        phone: null,
        created_at: new Date(),
      }]);
    }

    const [adminRoles] = await queryInterface.sequelize.query(
      "SELECT id FROM roles WHERE name = 'system_admin'"
    );
    const adminRoleId = adminRoles[0]?.id;
    if (!adminRoleId) return;

    await queryInterface.sequelize.query(
      `UPDATE users SET facility_id = :facilityId
       WHERE role_id = :roleId AND facility_id != :facilityId`,
      { replacements: { facilityId, roleId: adminRoleId } }
    );
  },

  async down(queryInterface) {
    // Keep national facility and assignments — no destructive rollback.
  },
};
