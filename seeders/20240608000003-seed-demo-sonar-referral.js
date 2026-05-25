'use strict';

const { v4: uuidv4 } = require('uuid');
const { ROLES } = require('../config/roles');
const { generatePatientNumber, generateVisitNumber } = require('../utils/idGenerator');

const SEED_VISIT = 'DEMO-SONAR-QUEUE-001';

module.exports = {
  async up(queryInterface) {
    const [marker] = await queryInterface.sequelize.query(
      'SELECT id FROM visits WHERE visit_number = :vn LIMIT 1',
      { replacements: { vn: SEED_VISIT } }
    );
    if (marker.length > 0) {
      console.log('seed-demo-sonar-referral: already exists, skip.');
      return;
    }

    const [facilityRows] = await queryInterface.sequelize.query(
      'SELECT id FROM facilities ORDER BY created_at ASC LIMIT 1'
    );
    const facilityId = facilityRows[0]?.id;
    if (!facilityId) throw new Error('No facility found.');

    const [doctorRows] = await queryInterface.sequelize.query(
      `SELECT u.id FROM users u INNER JOIN roles r ON r.id = u.role_id AND r.name = :role LIMIT 1`,
      { replacements: { role: ROLES.DOCTOR } }
    );
    const doctorId = doctorRows[0]?.id;
    if (!doctorId) throw new Error('No doctor user found.');

    const now = new Date();
    const patientId = uuidv4();
    const visitId = uuidv4();
    const sonarId = uuidv4();

    await queryInterface.bulkInsert('patients', [{
      id: patientId,
      patient_number: generatePatientNumber(),
      category: 'known',
      payment_type: 'state',
      first_name: 'Sonar',
      last_name: 'Queue Demo',
      sex: 'female',
      date_of_birth: '1985-03-20',
      id_number: '85032012345',
      phone: '+264811111111',
      is_emergency: false,
      created_at: now,
      updated_at: now,
    }]);

    await queryInterface.bulkInsert('visits', [{
      id: visitId,
      patient_id: patientId,
      facility_id: facilityId,
      visit_number: SEED_VISIT,
      visit_type: 'follow_up',
      status: 'in_progress',
      current_department: 'sonar',
      created_by: doctorId,
      created_at: now,
    }]);

    await queryInterface.bulkInsert('sonar_requests', [{
      id: sonarId,
      visit_id: visitId,
      requested_by: doctorId,
      scan_type: 'Abdominal ultrasound',
      symptoms: 'RUQ pain, nausea — rule out biliary pathology',
      diagnostic_questions: 'Gallstones? Wall thickening? CBD diameter?',
      prep_instructions: 'Fast for 6–8 hours before the scan.',
      clinical_notes: 'Demo referral for radiologist queue',
      is_emergency: false,
      status: 'pending',
      created_at: now,
    }]);

    console.log('seed-demo-sonar-referral: created pending sonar queue item.');
  },

  async down(queryInterface) {
    const [visits] = await queryInterface.sequelize.query(
      'SELECT id, patient_id FROM visits WHERE visit_number = :vn',
      { replacements: { vn: SEED_VISIT } }
    );
    const visitId = visits[0]?.id;
    const patientId = visits[0]?.patient_id;
    if (visitId) {
      await queryInterface.sequelize.query(
        'DELETE FROM sonar_requests WHERE visit_id = :visitId',
        { replacements: { visitId } }
      );
      await queryInterface.sequelize.query(
        'DELETE FROM visits WHERE id = :visitId',
        { replacements: { visitId } }
      );
    }
    if (patientId) {
      await queryInterface.sequelize.query(
        'DELETE FROM patients WHERE id = :patientId',
        { replacements: { patientId } }
      );
    }
  },
};
