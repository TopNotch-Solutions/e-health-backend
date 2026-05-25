'use strict';

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { ROLES } = require('../config/roles');

const DEMO_PASSWORD = 'Demo123!';
const EMAIL = 'pharmacy_supervisor@demo.ehealth.gov';

module.exports = {
  async up(queryInterface) {
    const [existing] = await queryInterface.sequelize.query(
      'SELECT id FROM users WHERE email = :email LIMIT 1',
      { replacements: { email: EMAIL } }
    );
    if (existing.length > 0) {
      console.log(`seed-pharmacy-supervisor-user: ${EMAIL} already exists, skipping.`);
      return;
    }

    const [facilityRows] = await queryInterface.sequelize.query(
      'SELECT id FROM facilities ORDER BY created_at ASC LIMIT 1'
    );
    const facilityId = facilityRows[0]?.id;
    if (!facilityId) {
      throw new Error('No facility found. Run initial seeder first.');
    }

    const [roleRows] = await queryInterface.sequelize.query(
      'SELECT id FROM roles WHERE name = :name LIMIT 1',
      { replacements: { name: ROLES.PHARMACY_SUPERVISOR } }
    );
    const roleId = roleRows[0]?.id;
    if (!roleId) {
      throw new Error('pharmacy_supervisor role not found. Run migration 20240605000000 first.');
    }

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    await queryInterface.bulkInsert('users', [{
      id: uuidv4(),
      facility_id: facilityId,
      role_id: roleId,
      employee_id: 'DEMO-PHARMACY-SUPERVISOR',
      first_name: 'Demo',
      last_name: 'Pharmacy Supervisor',
      email: EMAIL,
      password_hash: passwordHash,
      phone: '+26461000000',
      is_active: true,
      last_login: null,
      created_at: new Date(),
    }]);

    console.log(`seed-pharmacy-supervisor-user: created ${EMAIL} (password: ${DEMO_PASSWORD})`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'DELETE FROM users WHERE email = :email',
      { replacements: { email: EMAIL } }
    );
  },
};
