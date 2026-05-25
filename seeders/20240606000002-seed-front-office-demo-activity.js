'use strict';

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { ROLES } = require('../config/roles');
const {
  generatePatientNumber,
  generateVisitNumber,
} = require('../utils/idGenerator');

const DEMO_PASSWORD = 'Demo123!';
const SEED_MARKER = 'DEMO-FO-ACTIVITY';

const EXTRA_CLERKS = [
  { email: 'front_office_clerk2@demo.ehealth.gov', first: 'Anna', last: 'Shikongo', employeeId: 'FO-CLERK-02' },
  { email: 'front_office_clerk3@demo.ehealth.gov', first: 'Paul', last: 'Nghipondoka', employeeId: 'FO-CLERK-03' },
];

function atHourToday(hour, minute = 0) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

function atHourYesterday(hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(hour, minute, 0, 0);
  return d;
}

module.exports = {
  async up(queryInterface) {
    const [facilityRows] = await queryInterface.sequelize.query(
      'SELECT id FROM facilities ORDER BY created_at ASC LIMIT 1'
    );
    const facilityId = facilityRows[0]?.id;
    if (!facilityId) {
      throw new Error('seed-front-office-demo-activity: no facility found.');
    }

    const [marker] = await queryInterface.sequelize.query(
      `SELECT id FROM visits WHERE visit_number LIKE :pattern LIMIT 1`,
      { replacements: { pattern: `${SEED_MARKER}%` } }
    );
    if (marker.length > 0) {
      console.log('seed-front-office-demo-activity: demo visits already present, skipping.');
      return;
    }

    const [roleRows] = await queryInterface.sequelize.query(
      'SELECT id FROM roles WHERE name = :name LIMIT 1',
      { replacements: { name: ROLES.FRONT_OFFICE } }
    );
    const frontOfficeRoleId = roleRows[0]?.id;
    if (!frontOfficeRoleId) {
      throw new Error('front_office role not found.');
    }

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const clerkIds = [];

    const [primaryClerk] = await queryInterface.sequelize.query(
      'SELECT id FROM users WHERE email = :email LIMIT 1',
      { replacements: { email: 'front_office@demo.ehealth.gov' } }
    );
    if (primaryClerk[0]?.id) clerkIds.push(primaryClerk[0].id);

    for (const clerk of EXTRA_CLERKS) {
      const [exists] = await queryInterface.sequelize.query(
        'SELECT id FROM users WHERE email = :email LIMIT 1',
        { replacements: { email: clerk.email } }
      );
      if (exists[0]?.id) {
        clerkIds.push(exists[0].id);
        continue;
      }
      const id = uuidv4();
      await queryInterface.bulkInsert('users', [{
        id,
        facility_id: facilityId,
        role_id: frontOfficeRoleId,
        employee_id: clerk.employeeId,
        first_name: clerk.first,
        last_name: clerk.last,
        email: clerk.email,
        password_hash: passwordHash,
        phone: '+26461000000',
        is_active: true,
        last_login: null,
        created_at: new Date(),
      }]);
      clerkIds.push(id);
      console.log(`seed-front-office-demo-activity: created clerk ${clerk.email}`);
    }

    if (clerkIds.length === 0) {
      throw new Error('No front office clerk users found. Run demo users seeder first.');
    }

    const scenarios = [
      { visitType: 'new', hour: 7, minute: 15, clerk: 0, payment: 'state', first: 'Maria', last: 'Amutenya' },
      { visitType: 'new', hour: 8, minute: 5, clerk: 0, payment: 'private', first: 'John', last: 'Hausiku' },
      { visitType: 'follow_up', hour: 8, minute: 40, clerk: 1, payment: 'state', first: 'Lydia', last: 'Shilongo' },
      { visitType: 'follow_up', hour: 9, minute: 10, clerk: 1, payment: 'state', first: 'Simon', last: 'Nambahu' },
      { visitType: 'emergency', hour: 9, minute: 45, clerk: 2, payment: 'state', first: 'Unknown', last: 'EMG-4401', emergency: true, category: 'unknown' },
      { visitType: 'new', hour: 10, minute: 20, clerk: 2, payment: 'private', first: 'Grace', last: 'Kandjii' },
      { visitType: 'follow_up', hour: 11, minute: 0, clerk: 0, payment: 'state', first: 'David', last: 'Iipinge' },
      { visitType: 'new', hour: 14, minute: 30, clerk: 1, payment: 'state', first: 'Helena', last: 'Shikwambi' },
      { visitType: 'follow_up', hour: 15, minute: 10, clerk: 2, payment: 'private', first: 'Petrus', last: 'Angula' },
      { visitType: 'new', hour: 16, minute: 0, clerk: 0, payment: 'state', first: 'Selma', last: 'Gariseb' },
      { visitType: 'follow_up', hour: 7, minute: 50, clerk: 1, payment: 'state', first: 'Yesterday', last: 'Patient A', yesterday: true },
      { visitType: 'new', hour: 12, minute: 15, clerk: 2, payment: 'private', first: 'Yesterday', last: 'Patient B', yesterday: true },
    ];

    const patients = [];
    const visits = [];

    scenarios.forEach((s, idx) => {
      const patientId = uuidv4();
      const visitId = uuidv4();
      const createdAt = s.yesterday
        ? atHourYesterday(s.hour, s.minute)
        : atHourToday(s.hour, s.minute);
      const clerkId = clerkIds[s.clerk % clerkIds.length];
      const seq = String(idx + 1).padStart(3, '0');

      patients.push({
        id: patientId,
        patient_number: generatePatientNumber(),
        category: s.category || 'known',
        payment_type: s.payment || 'state',
        first_name: s.first,
        last_name: s.last,
        sex: idx % 2 === 0 ? 'female' : 'male',
        date_of_birth: '1990-01-15',
        id_number: s.category === 'unknown' ? null : `900115${10000 + idx}`,
        phone: '+264811234567',
        is_emergency: Boolean(s.emergency),
        created_at: createdAt,
        updated_at: createdAt,
      });

      visits.push({
        id: visitId,
        patient_id: patientId,
        facility_id: facilityId,
        visit_number: `${SEED_MARKER}-${seq}`,
        visit_type: s.visitType,
        status: 'in_progress',
        current_department: 'nurse',
        created_by: clerkId,
        created_at: createdAt,
      });
    });

    await queryInterface.bulkInsert('patients', patients);
    await queryInterface.bulkInsert('visits', visits);

    console.log(
      `seed-front-office-demo-activity: seeded ${visits.length} visits across ${clerkIds.length} front office staff.`
    );
  },

  async down(queryInterface) {
    const [visitRows] = await queryInterface.sequelize.query(
      `SELECT patient_id FROM visits WHERE visit_number LIKE :pattern`,
      { replacements: { pattern: `${SEED_MARKER}%` } }
    );
    const patientIds = visitRows.map((r) => r.patient_id).filter(Boolean);

    await queryInterface.sequelize.query(
      'DELETE FROM visits WHERE visit_number LIKE :pattern',
      { replacements: { pattern: `${SEED_MARKER}%` } }
    );
    if (patientIds.length) {
      await queryInterface.sequelize.query(
        'DELETE FROM patients WHERE id IN (:ids)',
        { replacements: { ids: patientIds } }
      );
    }
    for (const clerk of EXTRA_CLERKS) {
      await queryInterface.sequelize.query(
        'DELETE FROM users WHERE email = :email',
        { replacements: { email: clerk.email } }
      );
    }
  },
};
