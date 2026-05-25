'use strict';

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { ROLES } = require('../config/roles');

const DEMO_PASSWORD = 'Demo123!';

const SUPERVISORS = [
  { role: ROLES.NURSE_SUPERVISOR, email: 'nurse_supervisor@demo.ehealth.gov', last: 'Nurse Supervisor', emp: 'DEMO-NURSE-SUPERVISOR' },
  { role: ROLES.DOCTOR_SUPERVISOR, email: 'doctor_supervisor@demo.ehealth.gov', last: 'Doctor Supervisor', emp: 'DEMO-DOCTOR-SUPERVISOR' },
  { role: ROLES.LABORATORY_SUPERVISOR, email: 'laboratory_supervisor@demo.ehealth.gov', last: 'Laboratory Supervisor', emp: 'DEMO-LAB-SUPERVISOR' },
];

module.exports = {
  async up(queryInterface) {
    const [facilityRows] = await queryInterface.sequelize.query(
      'SELECT id FROM facilities ORDER BY created_at ASC LIMIT 1'
    );
    const facilityId = facilityRows[0]?.id;
    if (!facilityId) throw new Error('No facility found. Run initial seeder first.');

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

    for (const sup of SUPERVISORS) {
      const [existing] = await queryInterface.sequelize.query(
        'SELECT id FROM users WHERE email = :email LIMIT 1',
        { replacements: { email: sup.email } }
      );
      if (existing.length > 0) {
        console.log(`seed-clinical-supervisor-users: ${sup.email} exists, skip.`);
        continue;
      }

      const [roleRows] = await queryInterface.sequelize.query(
        'SELECT id FROM roles WHERE name = :name LIMIT 1',
        { replacements: { name: sup.role } }
      );
      const roleId = roleRows[0]?.id;
      if (!roleId) {
        throw new Error(`${sup.role} not found. Run migration 20240607000000 first.`);
      }

      await queryInterface.bulkInsert('users', [{
        id: uuidv4(),
        facility_id: facilityId,
        role_id: roleId,
        employee_id: sup.emp,
        first_name: 'Demo',
        last_name: sup.last,
        email: sup.email,
        password_hash: passwordHash,
        phone: '+26461000000',
        is_active: true,
        last_login: null,
        created_at: new Date(),
      }]);
      console.log(`seed-clinical-supervisor-users: created ${sup.email}`);
    }
  },

  async down(queryInterface) {
    for (const sup of SUPERVISORS) {
      await queryInterface.sequelize.query(
        'DELETE FROM users WHERE email = :email',
        { replacements: { email: sup.email } }
      );
    }
  },
};
