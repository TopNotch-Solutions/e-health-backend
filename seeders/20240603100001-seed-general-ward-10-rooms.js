'use strict';

const { v4: uuidv4 } = require('uuid');

/** General ward: 10 rooms, 10 beds (all active — supervisor marks inactive in UI). */
module.exports = {
  async up(queryInterface) {
    const [facilities] = await queryInterface.sequelize.query(
      'SELECT id FROM facilities ORDER BY created_at ASC LIMIT 1'
    );
    if (!facilities.length) {
      console.warn('seed-general-ward: no facility found, skipping');
      return;
    }
    const facilityId = facilities[0].id;

    const [existing] = await queryInterface.sequelize.query(
      "SELECT id FROM wards WHERE ward_number = 'GW-10' AND facility_id = :facilityId LIMIT 1",
      { replacements: { facilityId } }
    );
    if (existing.length) {
      console.log('seed-general-ward: ward GW-10 already exists, skipping');
      return;
    }

    const wardId = uuidv4();
    await queryInterface.bulkInsert('wards', [
      {
        id: wardId,
        facility_id: facilityId,
        name: 'General Ward — 10 Rooms',
        ward_number: 'GW-10',
        ward_type: 'general',
        supervisor_id: null,
        total_beds: 10,
      },
    ]);

    const beds = [];
    for (let i = 1; i <= 10; i += 1) {
      const roomNum = String(i);
      beds.push({
        id: uuidv4(),
        ward_id: wardId,
        room_number: roomNum,
        bed_number: roomNum,
        status: 'available',
        condition_note: null,
      });
    }

    await queryInterface.bulkInsert('beds', beds);
    console.log('seed-general-ward: created GW-10 with 10 active beds');
  },

  async down(queryInterface) {
    const [wards] = await queryInterface.sequelize.query(
      "SELECT id FROM wards WHERE ward_number = 'GW-10' LIMIT 1"
    );
    if (!wards.length) return;
    const wardId = wards[0].id;
    await queryInterface.bulkDelete('beds', { ward_id: wardId });
    await queryInterface.bulkDelete('wards', { id: wardId });
  },
};
