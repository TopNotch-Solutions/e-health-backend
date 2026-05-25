'use strict';

const { v4: uuidv4 } = require('uuid');
const dietPrescriptionService = require('../services/dietPrescriptionService');
const { generatePatientNumber } = require('../utils/idGenerator');

const SEED_VISIT = 'DEMO-KITCHEN-001';

/**
 * Creates a sample admitted patient with diet + meal plans for kitchen UI demos.
 * Requires: facility, doctor user, general ward beds from prior seeders.
 */
module.exports = {
  async up(queryInterface) {
    const [existing] = await queryInterface.sequelize.query(
      'SELECT id FROM visits WHERE visit_number = :vn LIMIT 1',
      { replacements: { vn: SEED_VISIT } }
    );
    if (existing.length > 0) {
      console.log('seed-demo-kitchen-diet-order: already exists, skipping.');
      return;
    }

    const [facilityRows] = await queryInterface.sequelize.query(
      'SELECT id FROM facilities ORDER BY created_at ASC LIMIT 1'
    );
    const facilityId = facilityRows[0]?.id;
    if (!facilityId) return;

    const [doctorRows] = await queryInterface.sequelize.query(
      `SELECT u.id FROM users u INNER JOIN roles r ON r.id = u.role_id
       WHERE r.name = 'doctor' AND u.facility_id = :facilityId LIMIT 1`,
      { replacements: { facilityId } }
    );
    const doctorId = doctorRows[0]?.id;
    if (!doctorId) return;

    const [bedRows] = await queryInterface.sequelize.query(
      `SELECT b.id, b.room_number, b.bed_number, w.name AS ward_name
       FROM beds b
       INNER JOIN wards w ON w.id = b.ward_id
       WHERE w.facility_id = :facilityId AND b.status IN ('available', 'reserved', 'occupied')
       ORDER BY w.name, b.room_number, b.bed_number
       LIMIT 1`,
      { replacements: { facilityId } }
    );
    const bed = bedRows[0];
    if (!bed) {
      console.log('seed-demo-kitchen-diet-order: no bed found, skipping.');
      return;
    }

    const patientId = uuidv4();
    const visitId = uuidv4();
    const admissionId = uuidv4();
    const now = new Date();
    const today = dietPrescriptionService.todayDateString();

    await queryInterface.bulkInsert('patients', [{
      id: patientId,
      patient_number: generatePatientNumber(),
      category: 'known',
      payment_type: 'state',
      first_name: 'Kitchen',
      last_name: 'Demo Patient',
      sex: 'female',
      date_of_birth: '1985-06-15',
      phone: '+26461000999',
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
      current_department: 'ward',
      created_by: doctorId,
      created_at: now,
    }]);

    await queryInterface.bulkInsert('admissions', [{
      id: admissionId,
      visit_id: visitId,
      bed_id: bed.id,
      admitted_by: doctorId,
      admitted_at: now,
      status: 'admitted',
    }]);

    await queryInterface.sequelize.query(
      'UPDATE beds SET status = :status WHERE id = :id',
      { replacements: { status: 'occupied', id: bed.id } }
    );

    const result = await dietPrescriptionService.prescribeForAdmission({
      admissionId,
      prescribedBy: doctorId,
      diet_type: 'diabetic',
      description: 'Controlled carbohydrate — demo order for kitchen board',
      restrictions: 'No added sugar; monitor blood glucose',
      special_instructions: `Deliver to ${bed.ward_name}, Room ${bed.room_number || '—'}, Bed ${bed.bed_number}`,
      start_date: today,
    });

    console.log('seed-demo-kitchen-diet-order: created demo inpatient diet for kitchen UI.');
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE mp FROM meal_plans mp
       INNER JOIN diet_prescriptions dp ON dp.id = mp.diet_prescription_id
       INNER JOIN admissions a ON a.id = dp.admission_id
       INNER JOIN visits v ON v.id = a.visit_id
       INNER JOIN patients p ON p.id = v.patient_id
       WHERE p.patient_number = 'DEMO-KITCHEN-001'`
    );
    await queryInterface.sequelize.query(
      `DELETE dp FROM diet_prescriptions dp
       INNER JOIN admissions a ON a.id = dp.admission_id
       INNER JOIN visits v ON v.id = a.visit_id
       INNER JOIN patients p ON p.id = v.patient_id
       WHERE p.patient_number = 'DEMO-KITCHEN-001'`
    );
    await queryInterface.sequelize.query(
      `DELETE a FROM admissions a
       INNER JOIN visits v ON v.id = a.visit_id
       INNER JOIN patients p ON p.id = v.patient_id
       WHERE p.patient_number = 'DEMO-KITCHEN-001'`
    );
    await queryInterface.sequelize.query(
      'DELETE FROM visits WHERE visit_number = :vn',
      { replacements: { vn: SEED_VISIT } }
    );
    await queryInterface.sequelize.query(
      `DELETE p FROM patients p
       LEFT JOIN visits v ON v.patient_id = p.id
       WHERE v.id IS NULL AND p.first_name = 'Kitchen' AND p.last_name = 'Demo Patient'`
    );
  },
};
