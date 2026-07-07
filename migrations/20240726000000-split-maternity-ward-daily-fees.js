'use strict';

const { tableExists } = require('./utils/columnHelpers');

const LEGACY_KEY = 'maternity_ward_daily';
const NEW_KEYS = [
  'maternity_anw_daily',
  'maternity_pnw_daily',
  'maternity_icu_daily',
];

module.exports = {
  async up(queryInterface) {
    if (!(await tableExists(queryInterface, 'facility_billing_fees'))) return;

    const [legacyRows] = await queryInterface.sequelize.query(
      `SELECT facility_id, amount, updated_by, updated_at
       FROM facility_billing_fees
       WHERE fee_key = :legacyKey`,
      { replacements: { legacyKey: LEGACY_KEY } }
    );

    for (const row of legacyRows) {
      for (const feeKey of NEW_KEYS) {
        const [existing] = await queryInterface.sequelize.query(
          `SELECT 1 AS ok FROM facility_billing_fees
           WHERE facility_id = :facilityId AND fee_key = :feeKey LIMIT 1`,
          { replacements: { facilityId: row.facility_id, feeKey } }
        );
        if (existing.length) continue;

        await queryInterface.bulkInsert('facility_billing_fees', [{
          facility_id: row.facility_id,
          fee_key: feeKey,
          amount: row.amount,
          updated_by: row.updated_by,
          updated_at: row.updated_at,
        }]);
      }
    }

    await queryInterface.sequelize.query(
      `DELETE FROM facility_billing_fees WHERE fee_key = :legacyKey`,
      { replacements: { legacyKey: LEGACY_KEY } }
    );
  },

  async down(queryInterface) {
    if (!(await tableExists(queryInterface, 'facility_billing_fees'))) return;

    const [anwRows] = await queryInterface.sequelize.query(
      `SELECT facility_id, amount, updated_by, updated_at
       FROM facility_billing_fees
       WHERE fee_key = 'maternity_anw_daily'`
    );

    for (const row of anwRows) {
      const [existing] = await queryInterface.sequelize.query(
        `SELECT 1 AS ok FROM facility_billing_fees
         WHERE facility_id = :facilityId AND fee_key = :legacyKey LIMIT 1`,
        { replacements: { facilityId: row.facility_id, legacyKey: LEGACY_KEY } }
      );
      if (!existing.length) {
        await queryInterface.bulkInsert('facility_billing_fees', [{
          facility_id: row.facility_id,
          fee_key: LEGACY_KEY,
          amount: row.amount,
          updated_by: row.updated_by,
          updated_at: row.updated_at,
        }]);
      }
    }

    for (const feeKey of NEW_KEYS) {
      await queryInterface.sequelize.query(
        `DELETE FROM facility_billing_fees WHERE fee_key = :feeKey`,
        { replacements: { feeKey } }
      );
    }
  },
};
