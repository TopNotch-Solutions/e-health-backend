const { v4: uuidv4 } = require('uuid');
const {
  Consultation, Prescription, PrescriptionItem, Visit, Patient,
  LabRequest, SonarRequest, Admission, Bed, Ward, TransportRequest,
  DietPrescription, MealPlan, PharmacyInventory, Bill, BillItem,
  Referral, sequelize,
} = require('../models');
const { success, created, error } = require('../utils/response');
const queueService = require('../services/queueService');
const notificationService = require('../services/notificationService');
const { getIO } = require('../socket');

// Create consultation
exports.createConsultation = async (req, res) => {
  try {
    const { visit_id, diagnosis, notes, actions_taken } = req.body;
    if (!visit_id) return error(res, 'visit_id is required', 400);

    const visit = await Visit.findByPk(visit_id);
    if (!visit) return error(res, 'Visit not found', 404);

    const consultation = await Consultation.create({
      id: uuidv4(),
      visit_id,
      doctor_id: req.user.id,
      diagnosis: diagnosis || null,
      notes: notes || null,
      actions_taken: actions_taken || null,
    });

    return created(res, consultation, 'Consultation created');
  } catch (err) {
    console.error('Create consultation error:', err);
    return error(res, 'Failed to create consultation', 500);
  }
};

// Create prescription (with stock alert)
exports.createPrescription = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, consultation_id, items } = req.body;
    if (!visit_id || !consultation_id || !items || !items.length) {
      return error(res, 'visit_id, consultation_id, and items are required', 400);
    }

    const prescription = await Prescription.create({
      id: uuidv4(),
      consultation_id,
      visit_id,
      prescribed_by: req.user.id,
    }, { transaction: t });

    // Create prescription items and check stock
    const lowStockAlerts = [];
    const prescriptionItems = [];

    for (const item of items) {
      // Check stock level
      const stockItem = await PharmacyInventory.findOne({
        where: {
          medication_name: item.medication_name,
          facility_id: req.user.facility_id,
        },
        transaction: t,
      });

      const stockLevel = stockItem ? stockItem.quantity_in_stock : 0;
      const isLowStock = stockLevel < (item.quantity || 1);

      const prescItem = await PrescriptionItem.create({
        id: uuidv4(),
        prescription_id: prescription.id,
        medication_name: item.medication_name,
        dosage: item.dosage || null,
        quantity: item.quantity || 1,
        frequency: item.frequency || null,
        duration: item.duration || null,
        instructions: item.instructions || null,
        stock_at_prescribe: stockLevel,
        is_available: !isLowStock,
      }, { transaction: t });

      prescriptionItems.push(prescItem);

      if (isLowStock) {
        lowStockAlerts.push({
          medication_name: item.medication_name,
          prescribed_qty: item.quantity,
          stock_available: stockLevel,
        });
      }
    }

    // Push to pharmacy queue
    const queueEntry = await queueService.pushToQueue({
      visit_id,
      department: 'pharmacy',
      priority: 'normal',
      pushed_by: req.user.id,
      notes: lowStockAlerts.length > 0 ? `Low stock alert: ${lowStockAlerts.map(a => a.medication_name).join(', ')}` : null,
    }, t);

    await t.commit();

    // Emit stock alerts if any
    if (lowStockAlerts.length > 0) {
      notificationService.emitStockAlert({
        prescription_id: prescription.id,
        visit_id,
        alerts: lowStockAlerts,
        doctor: `${req.user.first_name} ${req.user.last_name}`,
      });
    }

    // Notify pharmacy
    const io = getIO();
    io.to('room:pharmacist').emit('queue:new_patient', { queueEntry });

    return created(res, { prescription, items: prescriptionItems, queueEntry, lowStockAlerts }, 'Prescription created');
  } catch (err) {
    await t.rollback();
    console.error('Create prescription error:', err);
    return error(res, 'Failed to create prescription', 500);
  }
};

// Request lab work
exports.createLabRequest = async (req, res) => {
  try {
    const { visit_id, test_type, clinical_notes } = req.body;
    if (!visit_id || !test_type) return error(res, 'visit_id and test_type are required', 400);

    const labRequest = await LabRequest.create({
      id: uuidv4(),
      visit_id,
      requested_by: req.user.id,
      test_type,
      clinical_notes: clinical_notes || null,
      status: 'pending_sample',
    });

    // Push to lab queue
    const queueEntry = await queueService.pushToQueue({
      visit_id,
      department: 'lab',
      priority: 'normal',
      pushed_by: req.user.id,
      notes: `Lab request: ${test_type}`,
    });

    const io = getIO();
    io.to('room:lab_technician').emit('queue:new_patient', { queueEntry, labRequest });
    io.to('room:nurse').emit('queue:new_patient', { queueEntry, labRequest, message: 'Blood sample needed' });

    return created(res, { labRequest, queueEntry }, 'Lab request created');
  } catch (err) {
    console.error('Create lab request error:', err);
    return error(res, 'Failed to create lab request', 500);
  }
};

// Request sonar
exports.createSonarRequest = async (req, res) => {
  try {
    const { visit_id, scan_type, clinical_notes } = req.body;
    if (!visit_id || !scan_type) return error(res, 'visit_id and scan_type are required', 400);

    const sonarRequest = await SonarRequest.create({
      id: uuidv4(),
      visit_id,
      requested_by: req.user.id,
      scan_type,
      clinical_notes: clinical_notes || null,
    });

    const queueEntry = await queueService.pushToQueue({
      visit_id,
      department: 'sonar',
      priority: 'normal',
      pushed_by: req.user.id,
      notes: `Sonar request: ${scan_type}`,
    });

    const io = getIO();
    io.to('room:radiologist').emit('queue:new_patient', { queueEntry, sonarRequest });

    return created(res, { sonarRequest, queueEntry }, 'Sonar request created');
  } catch (err) {
    console.error('Create sonar request error:', err);
    return error(res, 'Failed to create sonar request', 500);
  }
};

// Admit patient to ward
exports.admitPatient = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, bed_id, equipment_required, equipment_notes, ward_id } = req.body;
    if (!visit_id || !bed_id) return error(res, 'visit_id and bed_id are required', 400);

    // Check bed availability
    const bed = await Bed.findByPk(bed_id, { include: [{ model: Ward, as: 'ward' }], transaction: t });
    if (!bed) return error(res, 'Bed not found', 404);
    if (bed.status !== 'available') return error(res, 'Bed is not available', 400);

    // Create admission
    const admission = await Admission.create({
      id: uuidv4(),
      visit_id,
      bed_id,
      admitted_by: req.user.id,
      status: 'admitted',
    }, { transaction: t });

    // Mark bed as occupied
    await bed.update({ status: 'occupied' }, { transaction: t });

    // Create transport request
    const transportReq = await TransportRequest.create({
      id: uuidv4(),
      visit_id,
      from_location: 'Doctor Consultation Room',
      to_location: `${bed.ward.name} - Bed ${bed.bed_number}`,
      equipment_required: equipment_required || 'wheelchair',
      equipment_notes: equipment_notes || null,
      priority: 'normal',
      requested_by: req.user.id,
    }, { transaction: t });

    // Update visit status
    await Visit.update(
      { current_department: 'ward' },
      { where: { id: visit_id }, transaction: t }
    );

    await t.commit();

    // Notify transport and ward
    notificationService.emitTransportRequest({
      transportRequest: transportReq,
      admission,
      bed: { id: bed.id, bed_number: bed.bed_number, ward_name: bed.ward.name },
    });
    notificationService.emitWardUpdate({
      type: 'admission',
      admission,
      bed_id,
      ward_id: bed.ward_id,
    });

    return created(res, { admission, transportRequest: transportReq }, 'Patient admitted');
  } catch (err) {
    await t.rollback();
    console.error('Admit patient error:', err);
    return error(res, 'Failed to admit patient', 500);
  }
};

// Discharge patient
exports.dischargePatient = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params; // visit_id
    const { discharge_notes } = req.body;

    const visit = await Visit.findByPk(id, {
      include: [
        { association: 'patient' },
        { association: 'admission', include: [{ model: Bed, as: 'bed' }] },
      ],
      transaction: t,
    });

    if (!visit) return error(res, 'Visit not found', 404);

    // Check billing constraint for private patients
    if (visit.patient.payment_type === 'private') {
      const bill = await Bill.findOne({ where: { visit_id: id }, transaction: t });
      if (bill && bill.status !== 'paid' && bill.status !== 'waived') {
        // Push to billing queue instead
        const queueEntry = await queueService.pushToQueue({
          visit_id: id,
          department: 'billing',
          priority: 'normal',
          pushed_by: req.user.id,
          notes: 'Private patient discharge - pending billing',
        }, t);

        await t.commit();

        notificationService.emitBillingCharge({ visit_id: id, patient: visit.patient, queueEntry });
        return success(res, { queueEntry, message: 'Private patient sent to billing before discharge' });
      }
    }

    // Discharge from admission if admitted
    if (visit.admission) {
      await visit.admission.update({
        discharged_at: new Date(),
        discharged_by: req.user.id,
        discharge_notes: discharge_notes || null,
        status: 'discharged',
      }, { transaction: t });

      // Free up bed
      if (visit.admission.bed) {
        await visit.admission.bed.update({ status: 'available' }, { transaction: t });
        notificationService.emitWardUpdate({
          type: 'discharge',
          bed_id: visit.admission.bed_id,
          ward_id: visit.admission.bed.ward_id,
        });
      }
    }

    // Update visit status
    await visit.update({
      status: 'discharged',
      completed_at: new Date(),
      current_department: null,
    }, { transaction: t });

    await t.commit();
    return success(res, { visit_id: id, status: 'discharged' }, 'Patient discharged');
  } catch (err) {
    await t.rollback();
    console.error('Discharge error:', err);
    return error(res, 'Failed to discharge patient', 500);
  }
};

// Prescribe diet for admitted patient
exports.prescribeDiet = async (req, res) => {
  try {
    const { admission_id, diet_type, description, restrictions, special_instructions, start_date, end_date } = req.body;
    if (!admission_id || !diet_type || !start_date) {
      return error(res, 'admission_id, diet_type, and start_date are required', 400);
    }

    const admission = await Admission.findByPk(admission_id);
    if (!admission) return error(res, 'Admission not found', 404);

    const dietPrescription = await DietPrescription.create({
      id: uuidv4(),
      admission_id,
      prescribed_by: req.user.id,
      diet_type,
      description: description || null,
      restrictions: restrictions || null,
      special_instructions: special_instructions || null,
      start_date,
      end_date: end_date || null,
    });

    // Auto-generate meal plans for today
    const meals = ['breakfast', 'lunch', 'dinner'];
    const mealPlans = [];
    for (const meal of meals) {
      const mp = await MealPlan.create({
        id: uuidv4(),
        diet_prescription_id: dietPrescription.id,
        meal_type: meal,
        meal_date: start_date,
      });
      mealPlans.push(mp);
    }

    // Notify kitchen
    notificationService.emitKitchenOrder({
      dietPrescription,
      mealPlans,
      admission_id,
    });

    return created(res, { dietPrescription, mealPlans }, 'Diet prescribed and kitchen notified');
  } catch (err) {
    console.error('Prescribe diet error:', err);
    return error(res, 'Failed to prescribe diet', 500);
  }
};

// Get consultation by visit
exports.getByVisit = async (req, res) => {
  try {
    const consultations = await Consultation.findAll({
      where: { visit_id: req.params.visitId },
      include: [
        { association: 'doctor', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'prescriptions', include: [{ association: 'items' }] },
      ],
      order: [['created_at', 'DESC']],
    });
    return success(res, consultations);
  } catch (err) {
    return error(res, 'Failed to fetch consultations', 500);
  }
};

// Get single consultation
exports.getById = async (req, res) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id, {
      include: [
        { association: 'doctor', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'prescriptions', include: [{ association: 'items' }] },
      ],
    });
    if (!consultation) return error(res, 'Consultation not found', 404);
    return success(res, consultation);
  } catch (err) {
    return error(res, 'Failed to fetch consultation', 500);
  }
};
