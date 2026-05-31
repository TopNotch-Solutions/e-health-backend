'use strict';

/** Rename nurse_queue fee → admission_fee; relabel existing bill line items. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DELETE nq FROM facility_billing_fees nq
      INNER JOIN facility_billing_fees af
        ON af.facility_id = nq.facility_id
       AND af.fee_key = 'admission_fee'
      WHERE nq.fee_key = 'nurse_queue'
    `);

    await queryInterface.sequelize.query(`
      UPDATE facility_billing_fees
      SET fee_key = 'admission_fee'
      WHERE fee_key = 'nurse_queue'
    `);

    await queryInterface.sequelize.query(`
      UPDATE bill_items
      SET description = 'Admission fee'
      WHERE description IN ('Nurse triage fee', 'Nurse triage')
         OR description LIKE '%Nurse triage%'
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE facility_billing_fees
      SET fee_key = 'nurse_queue'
      WHERE fee_key = 'admission_fee'
    `);

    await queryInterface.sequelize.query(`
      UPDATE bill_items
      SET description = 'Nurse triage fee'
      WHERE description = 'Admission fee'
    `);
  },
};
