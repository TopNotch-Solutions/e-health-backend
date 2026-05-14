'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Facilities
    await queryInterface.createTable('facilities', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      name: { type: Sequelize.STRING(255), allowNull: false },
      type: { type: Sequelize.ENUM('hospital', 'clinic', 'health_center'), allowNull: false },
      province: { type: Sequelize.STRING(100) },
      district: { type: Sequelize.STRING(100) },
      address: { type: Sequelize.TEXT },
      phone: { type: Sequelize.STRING(20) },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // Roles
    await queryInterface.createTable('roles', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: Sequelize.STRING(50), allowNull: false, unique: true },
      display_name: { type: Sequelize.STRING(100) },
    });

    // Permissions
    await queryInterface.createTable('permissions', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      resource: { type: Sequelize.STRING(50), allowNull: false },
      action: { type: Sequelize.STRING(20), allowNull: false },
    });
    await queryInterface.addIndex('permissions', ['resource', 'action'], { unique: true });

    // Role Permissions
    await queryInterface.createTable('role_permissions', {
      role_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'roles', key: 'id' } },
      permission_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'permissions', key: 'id' } },
    });
    await queryInterface.addConstraint('role_permissions', {
      fields: ['role_id', 'permission_id'],
      type: 'primary key',
      name: 'role_permissions_pkey',
    });

    // Users
    await queryInterface.createTable('users', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      facility_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'facilities', key: 'id' } },
      role_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'roles', key: 'id' } },
      employee_id: { type: Sequelize.STRING(50), unique: true },
      first_name: { type: Sequelize.STRING(100), allowNull: false },
      last_name: { type: Sequelize.STRING(100), allowNull: false },
      email: { type: Sequelize.STRING(255), unique: true },
      password_hash: { type: Sequelize.STRING(255), allowNull: false },
      phone: { type: Sequelize.STRING(20) },
      is_active: { type: Sequelize.BOOLEAN, defaultValue: true },
      last_login: { type: Sequelize.DATE },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // Refresh Tokens
    await queryInterface.createTable('refresh_tokens', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      user_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' } },
      token: { type: Sequelize.STRING(500), allowNull: false },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      revoked: { type: Sequelize.BOOLEAN, defaultValue: false },
    });

    // Patients
    await queryInterface.createTable('patients', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      patient_number: { type: Sequelize.STRING(20), unique: true, allowNull: false },
      category: { type: Sequelize.ENUM('known', 'unknown', 'returning'), allowNull: false },
      payment_type: { type: Sequelize.ENUM('state', 'private'), defaultValue: 'state' },
      first_name: { type: Sequelize.STRING(100) },
      last_name: { type: Sequelize.STRING(100) },
      sex: { type: Sequelize.ENUM('male', 'female', 'other') },
      date_of_birth: { type: Sequelize.DATEONLY },
      id_number: { type: Sequelize.STRING(20) },
      phone: { type: Sequelize.STRING(20) },
      address: { type: Sequelize.TEXT },
      emergency_contact_name: { type: Sequelize.STRING(100) },
      emergency_contact_phone: { type: Sequelize.STRING(20) },
      is_emergency: { type: Sequelize.BOOLEAN, defaultValue: false },
      temp_id: { type: Sequelize.STRING(20) },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP') },
    });

    // Visits
    await queryInterface.createTable('visits', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      patient_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'patients', key: 'id' } },
      facility_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'facilities', key: 'id' } },
      visit_number: { type: Sequelize.STRING(20), unique: true, allowNull: false },
      visit_type: { type: Sequelize.ENUM('new', 'follow_up', 'emergency'), allowNull: false },
      status: { type: Sequelize.ENUM('in_progress', 'completed', 'discharged', 'deceased'), defaultValue: 'in_progress' },
      current_department: { type: Sequelize.STRING(50) },
      current_queue_position: { type: Sequelize.INTEGER },
      created_by: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' } },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      completed_at: { type: Sequelize.DATE },
    });

    // Queue Entries
    await queryInterface.createTable('queue_entries', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      visit_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'visits', key: 'id' } },
      department: { type: Sequelize.STRING(50), allowNull: false },
      priority: { type: Sequelize.ENUM('normal', 'urgent', 'emergency'), defaultValue: 'normal' },
      status: { type: Sequelize.ENUM('waiting', 'in_progress', 'completed', 'skipped'), defaultValue: 'waiting' },
      position: { type: Sequelize.INTEGER, allowNull: false },
      assigned_to: { type: Sequelize.CHAR(36), references: { model: 'users', key: 'id' } },
      pushed_by: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' } },
      notes: { type: Sequelize.TEXT },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      started_at: { type: Sequelize.DATE },
      completed_at: { type: Sequelize.DATE },
    });

    // Vitals
    await queryInterface.createTable('vitals', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      visit_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'visits', key: 'id' } },
      recorded_by: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' } },
      temperature: { type: Sequelize.DECIMAL(4, 1) },
      blood_pressure_systolic: { type: Sequelize.INTEGER },
      blood_pressure_diastolic: { type: Sequelize.INTEGER },
      pulse_rate: { type: Sequelize.INTEGER },
      respiratory_rate: { type: Sequelize.INTEGER },
      weight: { type: Sequelize.DECIMAL(5, 2) },
      height: { type: Sequelize.DECIMAL(5, 2) },
      oxygen_saturation: { type: Sequelize.DECIMAL(4, 1) },
      allergies: { type: Sequelize.TEXT },
      accompanied_by: { type: Sequelize.STRING(200) },
      chief_complaint: { type: Sequelize.TEXT },
      notes: { type: Sequelize.TEXT },
      recorded_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // Consultations
    await queryInterface.createTable('consultations', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      visit_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'visits', key: 'id' } },
      doctor_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' } },
      diagnosis: { type: Sequelize.TEXT },
      notes: { type: Sequelize.TEXT },
      actions_taken: { type: Sequelize.JSON },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // Prescriptions
    await queryInterface.createTable('prescriptions', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      consultation_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'consultations', key: 'id' } },
      visit_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'visits', key: 'id' } },
      prescribed_by: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' } },
      status: { type: Sequelize.ENUM('pending', 'partially_dispensed', 'dispensed', 'unavailable'), defaultValue: 'pending' },
      referral_generated: { type: Sequelize.BOOLEAN, defaultValue: false },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // Prescription Items
    await queryInterface.createTable('prescription_items', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      prescription_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'prescriptions', key: 'id' } },
      medication_name: { type: Sequelize.STRING(255), allowNull: false },
      dosage: { type: Sequelize.STRING(100) },
      quantity: { type: Sequelize.INTEGER, allowNull: false },
      frequency: { type: Sequelize.STRING(100) },
      duration: { type: Sequelize.STRING(100) },
      instructions: { type: Sequelize.TEXT },
      is_dispensed: { type: Sequelize.BOOLEAN, defaultValue: false },
      is_available: { type: Sequelize.BOOLEAN, defaultValue: true },
      dispensed_by: { type: Sequelize.CHAR(36), references: { model: 'users', key: 'id' } },
      dispensed_at: { type: Sequelize.DATE },
      stock_at_prescribe: { type: Sequelize.INTEGER },
    });

    // Wards
    await queryInterface.createTable('wards', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      facility_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'facilities', key: 'id' } },
      name: { type: Sequelize.STRING(100), allowNull: false },
      ward_number: { type: Sequelize.STRING(20), allowNull: false },
      ward_type: { type: Sequelize.ENUM('general', 'maternity', 'pediatric', 'icu', 'surgical', 'psychiatric'), allowNull: false },
      supervisor_id: { type: Sequelize.CHAR(36), references: { model: 'users', key: 'id' } },
      total_beds: { type: Sequelize.INTEGER, defaultValue: 0 },
    });

    // Beds
    await queryInterface.createTable('beds', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      ward_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'wards', key: 'id' } },
      bed_number: { type: Sequelize.STRING(20), allowNull: false },
      status: { type: Sequelize.ENUM('available', 'occupied', 'out_of_service'), defaultValue: 'available' },
      condition_note: { type: Sequelize.STRING(255) },
    });

    // Admissions
    await queryInterface.createTable('admissions', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      visit_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'visits', key: 'id' } },
      bed_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'beds', key: 'id' } },
      admitted_by: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' } },
      admitted_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      discharged_at: { type: Sequelize.DATE },
      discharged_by: { type: Sequelize.CHAR(36), references: { model: 'users', key: 'id' } },
      discharge_notes: { type: Sequelize.TEXT },
      status: { type: Sequelize.ENUM('admitted', 'discharged', 'transferred', 'deceased'), defaultValue: 'admitted' },
    });

    // Transport Requests
    await queryInterface.createTable('transport_requests', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      visit_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'visits', key: 'id' } },
      from_location: { type: Sequelize.STRING(100), allowNull: false },
      to_location: { type: Sequelize.STRING(100), allowNull: false },
      equipment_required: { type: Sequelize.ENUM('wheelchair', 'stretcher', 'bed', 'walking', 'other'), allowNull: false },
      equipment_notes: { type: Sequelize.STRING(255) },
      priority: { type: Sequelize.ENUM('normal', 'urgent', 'emergency'), defaultValue: 'normal' },
      status: { type: Sequelize.ENUM('pending', 'in_transit', 'completed'), defaultValue: 'pending' },
      assigned_porter: { type: Sequelize.CHAR(36), references: { model: 'users', key: 'id' } },
      requested_by: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' } },
      requested_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      started_at: { type: Sequelize.DATE },
      completed_at: { type: Sequelize.DATE },
    });

    // Lab Requests
    await queryInterface.createTable('lab_requests', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      visit_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'visits', key: 'id' } },
      requested_by: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' } },
      test_type: { type: Sequelize.STRING(100), allowNull: false },
      clinical_notes: { type: Sequelize.TEXT },
      blood_details: { type: Sequelize.TEXT },
      nurse_id: { type: Sequelize.CHAR(36), references: { model: 'users', key: 'id' } },
      status: { type: Sequelize.ENUM('pending_sample', 'sample_collected', 'processing', 'completed'), defaultValue: 'pending_sample' },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // Lab Results
    await queryInterface.createTable('lab_results', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      lab_request_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'lab_requests', key: 'id' } },
      processed_by: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' } },
      results: { type: Sequelize.TEXT, allowNull: false },
      result_data: { type: Sequelize.JSON },
      attachments: { type: Sequelize.JSON },
      completed_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // Sonar Requests
    await queryInterface.createTable('sonar_requests', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      visit_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'visits', key: 'id' } },
      requested_by: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' } },
      scan_type: { type: Sequelize.STRING(100), allowNull: false },
      clinical_notes: { type: Sequelize.TEXT },
      status: { type: Sequelize.ENUM('pending', 'in_progress', 'completed'), defaultValue: 'pending' },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // Sonar Results
    await queryInterface.createTable('sonar_results', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      sonar_request_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'sonar_requests', key: 'id' } },
      performed_by: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' } },
      findings: { type: Sequelize.TEXT },
      images: { type: Sequelize.JSON },
      report: { type: Sequelize.TEXT },
      completed_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // Diet Prescriptions
    await queryInterface.createTable('diet_prescriptions', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      admission_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'admissions', key: 'id' } },
      prescribed_by: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' } },
      diet_type: { type: Sequelize.STRING(100), allowNull: false },
      description: { type: Sequelize.TEXT },
      restrictions: { type: Sequelize.TEXT },
      special_instructions: { type: Sequelize.TEXT },
      start_date: { type: Sequelize.DATEONLY, allowNull: false },
      end_date: { type: Sequelize.DATEONLY },
      status: { type: Sequelize.ENUM('active', 'completed', 'cancelled'), defaultValue: 'active' },
    });

    // Meal Plans
    await queryInterface.createTable('meal_plans', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      diet_prescription_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'diet_prescriptions', key: 'id' } },
      meal_type: { type: Sequelize.ENUM('breakfast', 'lunch', 'dinner', 'snack'), allowNull: false },
      meal_date: { type: Sequelize.DATEONLY, allowNull: false },
      prepared: { type: Sequelize.BOOLEAN, defaultValue: false },
      dispensed: { type: Sequelize.BOOLEAN, defaultValue: false },
      prepared_by: { type: Sequelize.CHAR(36), references: { model: 'users', key: 'id' } },
      dispensed_at: { type: Sequelize.DATE },
      notes: { type: Sequelize.STRING(255) },
    });

    // Bills
    await queryInterface.createTable('bills', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      visit_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'visits', key: 'id' } },
      patient_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'patients', key: 'id' } },
      total_amount: { type: Sequelize.DECIMAL(12, 2), defaultValue: 0.00 },
      paid_amount: { type: Sequelize.DECIMAL(12, 2), defaultValue: 0.00 },
      status: { type: Sequelize.ENUM('accumulating', 'pending_payment', 'paid', 'waived'), defaultValue: 'accumulating' },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // Bill Items
    await queryInterface.createTable('bill_items', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      bill_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'bills', key: 'id' } },
      description: { type: Sequelize.STRING(255), allowNull: false },
      category: { type: Sequelize.ENUM('consultation', 'medication', 'lab', 'sonar', 'ward', 'other'), allowNull: false },
      amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      reference_id: { type: Sequelize.CHAR(36) },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // Revenue Shifts
    await queryInterface.createTable('revenue_shifts', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      billing_clerk_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' } },
      shift_start: { type: Sequelize.DATE, allowNull: false },
      shift_end: { type: Sequelize.DATE },
      expected_amount: { type: Sequelize.DECIMAL(12, 2), defaultValue: 0.00 },
      collected_amount: { type: Sequelize.DECIMAL(12, 2), defaultValue: 0.00 },
      status: { type: Sequelize.ENUM('open', 'closed', 'reconciled', 'discrepancy'), defaultValue: 'open' },
      reconciled_by: { type: Sequelize.CHAR(36), references: { model: 'users', key: 'id' } },
      notes: { type: Sequelize.TEXT },
    });

    // Pharmacy Inventory
    await queryInterface.createTable('pharmacy_inventory', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      facility_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'facilities', key: 'id' } },
      medication_name: { type: Sequelize.STRING(255), allowNull: false },
      generic_name: { type: Sequelize.STRING(255) },
      category: { type: Sequelize.STRING(100) },
      quantity_in_stock: { type: Sequelize.INTEGER, defaultValue: 0 },
      reorder_level: { type: Sequelize.INTEGER, defaultValue: 10 },
      unit: { type: Sequelize.STRING(50) },
      expiry_date: { type: Sequelize.DATEONLY },
    });

    // Stock Transactions
    await queryInterface.createTable('stock_transactions', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      inventory_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'pharmacy_inventory', key: 'id' } },
      type: { type: Sequelize.ENUM('received', 'dispensed', 'expired', 'adjustment'), allowNull: false },
      quantity: { type: Sequelize.INTEGER, allowNull: false },
      reference_id: { type: Sequelize.CHAR(36) },
      performed_by: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' } },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // Kitchen Inventory
    await queryInterface.createTable('kitchen_inventory', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      facility_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'facilities', key: 'id' } },
      item_name: { type: Sequelize.STRING(255), allowNull: false },
      category: { type: Sequelize.STRING(100) },
      quantity: { type: Sequelize.DECIMAL(10, 2), defaultValue: 0 },
      unit: { type: Sequelize.STRING(50) },
      reorder_level: { type: Sequelize.DECIMAL(10, 2), defaultValue: 0 },
    });

    // Mortuary Records
    await queryInterface.createTable('mortuary_records', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      patient_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'patients', key: 'id' } },
      visit_id: { type: Sequelize.CHAR(36), references: { model: 'visits', key: 'id' } },
      cause_of_death: { type: Sequelize.TEXT },
      date_of_death: { type: Sequelize.DATE, allowNull: false },
      declared_by: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' } },
      body_status: { type: Sequelize.ENUM('in_mortuary', 'released', 'transferred'), defaultValue: 'in_mortuary' },
      released_to: { type: Sequelize.STRING(255) },
      released_at: { type: Sequelize.DATE },
      undertaker_name: { type: Sequelize.STRING(255) },
      undertaker_contact: { type: Sequelize.STRING(50) },
      notes: { type: Sequelize.TEXT },
    });

    // Social Worker Cases
    await queryInterface.createTable('social_worker_cases', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      patient_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'patients', key: 'id' } },
      visit_id: { type: Sequelize.CHAR(36), references: { model: 'visits', key: 'id' } },
      assigned_to: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' } },
      case_type: { type: Sequelize.ENUM('unknown_patient_id', 'government_assistance', 'family_tracing', 'abuse', 'other'), allowNull: false },
      status: { type: Sequelize.ENUM('open', 'in_progress', 'resolved', 'closed'), defaultValue: 'open' },
      notes: { type: Sequelize.TEXT },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      resolved_at: { type: Sequelize.DATE },
    });

    // Referrals
    await queryInterface.createTable('referrals', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      visit_id: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'visits', key: 'id' } },
      referred_by: { type: Sequelize.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' } },
      referral_type: { type: Sequelize.ENUM('pharmacy_unavailable', 'external_facility', 'specialist', 'follow_up'), allowNull: false },
      reason: { type: Sequelize.TEXT },
      destination: { type: Sequelize.STRING(255) },
      status: { type: Sequelize.ENUM('pending', 'accepted', 'completed'), defaultValue: 'pending' },
      follow_up_date: { type: Sequelize.DATEONLY },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // Audit Logs
    await queryInterface.createTable('audit_logs', {
      id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
      user_id: { type: Sequelize.CHAR(36), allowNull: false },
      action: { type: Sequelize.STRING(50), allowNull: false },
      resource: { type: Sequelize.STRING(50), allowNull: false },
      resource_id: { type: Sequelize.CHAR(36) },
      details: { type: Sequelize.JSON },
      ip_address: { type: Sequelize.STRING(45) },
      timestamp: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('audit_logs', ['user_id']);
    await queryInterface.addIndex('audit_logs', ['resource', 'resource_id']);
    await queryInterface.addIndex('audit_logs', ['timestamp']);
  },

  async down(queryInterface) {
    const tables = [
      'audit_logs', 'referrals', 'social_worker_cases', 'mortuary_records',
      'kitchen_inventory', 'stock_transactions', 'pharmacy_inventory',
      'revenue_shifts', 'bill_items', 'bills', 'meal_plans', 'diet_prescriptions',
      'sonar_results', 'sonar_requests', 'lab_results', 'lab_requests',
      'transport_requests', 'admissions', 'beds', 'wards',
      'prescription_items', 'prescriptions', 'consultations', 'vitals',
      'queue_entries', 'visits', 'patients', 'refresh_tokens', 'users',
      'role_permissions', 'permissions', 'roles', 'facilities',
    ];
    for (const table of tables) {
      await queryInterface.dropTable(table);
    }
  },
};
