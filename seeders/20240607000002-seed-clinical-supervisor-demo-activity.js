'use strict';

const { v4: uuidv4 } = require('uuid');
const { ROLES } = require('../config/roles');
const { generatePatientNumber, generateVisitNumber } = require('../utils/idGenerator');

const SEED_VISIT_PREFIX = 'DEMO-CLINICAL-';

function atHourToday(hour, minute = 0) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function getUserIdByEmail(queryInterface, email) {
  const [rows] = await queryInterface.sequelize.query(
    'SELECT id FROM users WHERE email = :email LIMIT 1',
    { replacements: { email } }
  );
  return rows[0]?.id;
}

async function getRoleUserIds(queryInterface, facilityId, roleName, limit = 3) {
  const [rows] = await queryInterface.sequelize.query(
    `
    SELECT u.id FROM users u
    INNER JOIN roles r ON r.id = u.role_id AND r.name = :roleName
    WHERE u.facility_id = :facilityId AND u.is_active = 1
    LIMIT :limit
    `,
    { replacements: { roleName, facilityId, limit } }
  );
  return rows.map((r) => r.id);
}

module.exports = {
  async up(queryInterface) {
    const [marker] = await queryInterface.sequelize.query(
      'SELECT id FROM visits WHERE visit_number LIKE :pattern LIMIT 1',
      { replacements: { pattern: `${SEED_VISIT_PREFIX}%` } }
    );
    if (marker.length > 0) {
      console.log('seed-clinical-supervisor-demo-activity: already seeded, skip.');
      return;
    }

    const [facilityRows] = await queryInterface.sequelize.query(
      'SELECT id FROM facilities ORDER BY created_at ASC LIMIT 1'
    );
    const facilityId = facilityRows[0]?.id;
    if (!facilityId) throw new Error('No facility found.');

    const nurseIds = await getRoleUserIds(queryInterface, facilityId, ROLES.NURSE, 3);
    const doctorIds = await getRoleUserIds(queryInterface, facilityId, ROLES.DOCTOR, 3);
    const labIds = await getRoleUserIds(queryInterface, facilityId, ROLES.LAB_TECHNICIAN, 2);

    if (!nurseIds.length || !doctorIds.length || !labIds.length) {
      throw new Error('Need nurse, doctor, and lab_technician demo users. Run demo users seeder.');
    }

    const scenarios = [
      { hour: 7, min: 10, nurse: 0, doctor: 0, lab: 0, emergency: false },
      { hour: 8, min: 20, nurse: 0, doctor: 0, lab: 0, emergency: false },
      { hour: 9, min: 5, nurse: 1, doctor: 1, lab: 0, emergency: true },
      { hour: 9, min: 50, nurse: 1, doctor: 1, lab: 0, emergency: false },
      { hour: 10, min: 30, nurse: 0, doctor: 0, lab: 1, emergency: false },
      { hour: 11, min: 15, nurse: 2, doctor: 2, lab: 0, emergency: false },
      { hour: 14, min: 0, nurse: 0, doctor: 1, lab: 1, emergency: false },
      { hour: 15, min: 45, nurse: 1, doctor: 0, lab: 0, emergency: false },
    ];

    const patients = [];
    const visits = [];
    const vitals = [];
    const consultations = [];
    const labRequests = [];
    const labResults = [];
    const prescriptions = [];

    scenarios.forEach((s, idx) => {
      const seq = String(idx + 1).padStart(3, '0');
      const patientId = uuidv4();
      const visitId = uuidv4();
      const consultationId = uuidv4();
      const labRequestId = uuidv4();
      const prescriptionId = uuidv4();
      const recordedAt = atHourToday(s.hour, s.min);
      const nurseId = nurseIds[s.nurse % nurseIds.length];
      const doctorId = doctorIds[s.doctor % doctorIds.length];
      const labId = labIds[s.lab % labIds.length];

      patients.push({
        id: patientId,
        patient_number: generatePatientNumber(),
        category: 'known',
        payment_type: idx % 3 === 0 ? 'private' : 'state',
        first_name: 'Clinical',
        last_name: `Demo ${seq}`,
        sex: idx % 2 === 0 ? 'female' : 'male',
        date_of_birth: '1988-06-01',
        id_number: `880601${10000 + idx}`,
        phone: '+264811000000',
        is_emergency: s.emergency,
        created_at: recordedAt,
        updated_at: recordedAt,
      });

      visits.push({
        id: visitId,
        patient_id: patientId,
        facility_id: facilityId,
        visit_number: `${SEED_VISIT_PREFIX}${seq}`,
        visit_type: s.emergency ? 'emergency' : 'new',
        status: 'in_progress',
        current_department: 'doctor',
        created_by: nurseId,
        created_at: recordedAt,
      });

      vitals.push({
        id: uuidv4(),
        visit_id: visitId,
        recorded_by: nurseId,
        temperature: 36.8 + idx * 0.1,
        pulse_rate: 72 + idx,
        chief_complaint: `Demo complaint ${seq}`,
        recorded_at: recordedAt,
      });

      const consultAt = new Date(recordedAt.getTime() + 15 * 60000);
      consultations.push({
        id: consultationId,
        visit_id: visitId,
        doctor_id: doctorId,
        diagnosis: JSON.stringify([{ code: 'R50.9', description: 'Fever, unspecified' }]),
        notes: `Demo consultation ${seq}`,
        created_at: consultAt,
      });

      prescriptions.push({
        id: prescriptionId,
        consultation_id: consultationId,
        visit_id: visitId,
        prescribed_by: doctorId,
        status: 'pending',
        created_at: new Date(consultAt.getTime() + 5 * 60000),
      });

      const labAt = new Date(consultAt.getTime() + 10 * 60000);
      labRequests.push({
        id: labRequestId,
        visit_id: visitId,
        requested_by: doctorId,
        test_type: 'Full blood count',
        clinical_notes: `Demo lab ${seq}`,
        is_emergency: s.emergency,
        tests: JSON.stringify([{ id: 'fbc', name: 'Full blood count' }]),
        status: 'completed',
        created_at: labAt,
      });

      labResults.push({
        id: uuidv4(),
        lab_request_id: labRequestId,
        processed_by: labId,
        results: `Demo results ${seq}: WBC normal, RBC normal`,
        completed_at: new Date(labAt.getTime() + 45 * 60000),
      });
    });

    await queryInterface.bulkInsert('patients', patients);
    await queryInterface.bulkInsert('visits', visits);
    await queryInterface.bulkInsert('vitals', vitals);
    await queryInterface.bulkInsert('consultations', consultations);
    await queryInterface.bulkInsert('prescriptions', prescriptions);
    await queryInterface.bulkInsert('lab_requests', labRequests);
    await queryInterface.bulkInsert('lab_results', labResults);

    console.log(
      `seed-clinical-supervisor-demo-activity: ${scenarios.length} clinical demo visits with vitals, consults, labs.`
    );
  },

  async down(queryInterface) {
    const [visitRows] = await queryInterface.sequelize.query(
      'SELECT id, patient_id FROM visits WHERE visit_number LIKE :pattern',
      { replacements: { pattern: `${SEED_VISIT_PREFIX}%` } }
    );
    const visitIds = visitRows.map((r) => r.id);
    const patientIds = visitRows.map((r) => r.patient_id);

    if (visitIds.length) {
      await queryInterface.sequelize.query(
        'DELETE FROM lab_results WHERE lab_request_id IN (SELECT id FROM lab_requests WHERE visit_id IN (:visitIds))',
        { replacements: { visitIds } }
      );
      await queryInterface.sequelize.query(
        'DELETE FROM lab_requests WHERE visit_id IN (:visitIds)',
        { replacements: { visitIds } }
      );
      await queryInterface.sequelize.query(
        'DELETE FROM prescriptions WHERE visit_id IN (:visitIds)',
        { replacements: { visitIds } }
      );
      await queryInterface.sequelize.query(
        'DELETE FROM consultations WHERE visit_id IN (:visitIds)',
        { replacements: { visitIds } }
      );
      await queryInterface.sequelize.query(
        'DELETE FROM vitals WHERE visit_id IN (:visitIds)',
        { replacements: { visitIds } }
      );
      await queryInterface.sequelize.query(
        'DELETE FROM visits WHERE id IN (:visitIds)',
        { replacements: { visitIds } }
      );
    }
    if (patientIds.length) {
      await queryInterface.sequelize.query(
        'DELETE FROM patients WHERE id IN (:patientIds)',
        { replacements: { patientIds } }
      );
    }
  },
};
