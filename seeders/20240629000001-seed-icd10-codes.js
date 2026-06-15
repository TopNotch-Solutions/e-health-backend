'use strict';

const { v4: uuidv4 } = require('uuid');
const { ICD10_CODES } = require('../constants/icd10Seed');

module.exports = {
  async up(queryInterface) {
    const [existing] = await queryInterface.sequelize.query(
      'SELECT COUNT(*) AS cnt FROM icd10_codes'
    );
    if (Number(existing[0]?.cnt) > 0) {
      console.log('seed-icd10-codes: already populated, skipping.');
      return;
    }

    const now = new Date();
    const rows = ICD10_CODES.map((row) => ({
      id: uuidv4(),
      icd10_code: row.code,
      description: row.description,
      is_active: true,
      created_at: now,
      updated_at: now,
    }));

    await queryInterface.bulkInsert('icd10_codes', rows);
    console.log(`seed-icd10-codes: inserted ${rows.length} ICD-10 codes.`);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('icd10_codes', {});
  },
};
