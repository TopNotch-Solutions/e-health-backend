'use strict';

const { v4: uuidv4 } = require('uuid');
const { MEDICATIONS, resolveUnitPrice } = require('../constants/medicationCatalogSeed');

module.exports = {
  async up(queryInterface) {
    const [existing] = await queryInterface.sequelize.query(
      'SELECT COUNT(*) AS cnt FROM medication_catalog'
    );
    if (Number(existing[0]?.cnt) > 0) {
      console.log('seed-medication-catalog: already populated, skipping.');
      return;
    }

    const now = new Date();
    const rows = MEDICATIONS.map((m) => ({
      id: uuidv4(),
      medication_name: m.name,
      generic_name: m.generic,
      category: m.category || 'Other',
      unit_price: resolveUnitPrice(m),
      is_active: true,
      created_at: now,
      updated_at: now,
    }));

    await queryInterface.bulkInsert('medication_catalog', rows);
    console.log(`seed-medication-catalog: inserted ${rows.length} medications.`);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('medication_catalog', {});
  },
};
