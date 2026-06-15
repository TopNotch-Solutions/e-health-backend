const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const {
  Consultation, Prescription, PrescriptionItem, Visit, Patient, QueueEntry,
  LabRequest, SonarRequest, Admission, Bed, Ward, TransportRequest,
  PharmacyInventory, Bill, BillItem,
  Referral, sequelize,
} = require('../models');
const { success, created, error } = require('../utils/response');
const { ADMIT_TRANSPORT_CHECKLIST_OPTIONS } = require('../constants/admitTransportChecklist');
const queueService = require('../services/queueService');
const notificationService = require('../services/notificationService');
const { resolveStockStatus, enrichItemsWithStock } = require('../services/pharmacyStockStatus');
const { getIO } = require('../socket');
const { emitDoctorActivity } = require('../services/notificationService');
const dietPrescriptionService = require('../services/dietPrescriptionService');
const billingChargeService = require('../services/billingChargeService');
const { validateDiagnosis, CLINIC_DOCTOR_DEPARTMENT } = require('../config/clinicDoctorRouting');

const CONSULTATION_QUEUE_DEPARTMENTS = ['doctor', CLINIC_DOCTOR_DEPARTMENT];

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

    emitDoctorActivity({ visitId: visit_id, consultationId: consultation.id, doctorId: req.user.id, action: 'consultation' });

    return created(res, consultation, 'Consultation created');
  } catch (err) {
    console.error('Create consultation error:', err);
    return error(res, 'Failed to create consultation', 500);
  }
};

exports.updateConsultation = async (req, res) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id);
    if (!consultation) return error(res, 'Consultation not found', 404);

    const { diagnosis, notes, actions_taken } = req.body;
    await consultation.update({
      ...(diagnosis !== undefined ? { diagnosis } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(actions_taken !== undefined ? { actions_taken } : {}),
    });

    return success(res, consultation, 'Consultation updated');
  } catch (err) {
    console.error('Update consultation error:', err);
    return error(res, 'Failed to update consultation', 500);
  }
};

/**
 * Persists prescription + line items and stock flags (no queue changes).
 */
async function createPrescriptionWithItems({
  visit_id,
  consultation_id,
  items,
  prescribed_by,
  facility_id,
  transaction,
}) {
  const prescription = await Prescription.create(
    {
      id: uuidv4(),
      consultation_id,
      visit_id,
      prescribed_by,
    },
    { transaction }
  );

  const lowStockAlerts = [];
  const prescriptionItems = [];

  for (const item of items) {
    const stockItem = await PharmacyInventory.findOne({
      where: {
        medication_name: item.medication_name,
        facility_id,
      },
      transaction,
    });

    const stockLevel = stockItem ? stockItem.quantity_in_stock : 0;
    const stock = resolveStockStatus({
      found: !!stockItem,
      quantityInStock: stockLevel,
      reorderLevel: stockItem?.reorder_level,
      requiredQty: item.quantity || 1,
    });

    const prescItem = await PrescriptionItem.create(
      {
        id: uuidv4(),
        prescription_id: prescription.id,
        medication_name: item.medication_name,
        dosage: item.dosage || null,
        quantity: item.quantity || 1,
        frequency: item.frequency || null,
        duration: item.duration || null,
        instructions: item.instructions || null,
        stock_at_prescribe: stockLevel,
        is_available: stock.can_dispense,
      },
      { transaction }
    );

    prescriptionItems.push(prescItem);

    if (stock.stock_status === 'out_of_stock') {
      lowStockAlerts.push({
        medication_name: item.medication_name,
        prescribed_qty: item.quantity,
        stock_available: stockLevel,
        stock_status: 'out_of_stock',
      });
    } else if (stock.stock_status === 'low_stock') {
      lowStockAlerts.push({
        medication_name: item.medication_name,
        prescribed_qty: item.quantity,
        stock_available: stockLevel,
        stock_status: 'low_stock',
      });
    }
  }

  const outNames = lowStockAlerts
    .filter((a) => a.stock_status === 'out_of_stock')
    .map((a) => a.medication_name);
  const lowNames = lowStockAlerts
    .filter((a) => a.stock_status === 'low_stock')
    .map((a) => a.medication_name);
  const noteParts = [];
  if (outNames.length) {
    noteParts.push(`Out of stock (prescribed anyway): ${outNames.join(', ')}`);
  }
  if (lowNames.length) {
    noteParts.push(`Low stock: ${lowNames.join(', ')}`);
  }
  const lowStockNote = noteParts.length ? noteParts.join(' · ') : null;

  return { prescription, prescriptionItems, lowStockAlerts, lowStockNote };
}

// Create prescription (with stock alert)
exports.createPrescription = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, consultation_id, items, queue_entry_id } = req.body;
    if (!visit_id || !consultation_id || !items || !items.length) {
      return error(res, 'visit_id, consultation_id, and items are required', 400);
    }

    const visit = await Visit.findByPk(visit_id, {
      include: [{ model: Patient, as: 'patient', attributes: ['is_emergency'] }],
      transaction: t,
    });
    if (!visit) {
      if (!t.finished) await t.rollback();
      return error(res, 'Visit not found', 404);
    }

    const priority = visit.patient?.is_emergency ? 'emergency' : 'normal';

    const consultation = await Consultation.findByPk(consultation_id, { transaction: t });
    if (!consultation) {
      if (!t.finished) await t.rollback();
      return error(res, 'Consultation not found. Complete diagnosis and try again.', 404);
    }
    if (consultation.visit_id !== visit_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'Consultation does not belong to this visit', 400);
    }

    const { prescription, prescriptionItems, lowStockAlerts, lowStockNote } =
      await createPrescriptionWithItems({
        visit_id,
        consultation_id,
        items,
        prescribed_by: req.user.id,
        facility_id: req.user.facility_id,
        transaction: t,
      });

    await billingChargeService.chargeConsultationFee(
      visit_id,
      consultation_id,
      req.user.facility_id,
      t
    );

    // Medication fees are added when the pharmacist dispenses (see pharmacy.controller)

    // Complete consultation queue entry and hand off to pharmacy (single transaction)
    let queueResult = { completedEntry: null, nextEntry: null };
    let doctorEntry = null;
    for (const dept of CONSULTATION_QUEUE_DEPARTMENTS) {
      doctorEntry = await queueService.findActiveEntryForVisit(visit_id, dept, t);
      if (doctorEntry) break;
    }
    if (!doctorEntry && queue_entry_id) {
      doctorEntry = await QueueEntry.findByPk(queue_entry_id, { transaction: t });
    }

    const activeDoctorEntry =
      doctorEntry
      && CONSULTATION_QUEUE_DEPARTMENTS.includes(doctorEntry.department)
      && ['waiting', 'in_progress'].includes(doctorEntry.status)
        ? doctorEntry
        : null;

    try {
      if (activeDoctorEntry) {
        queueResult = await queueService.completeEntry(
          activeDoctorEntry.id,
          {
            nextDepartment: 'pharmacy',
            nextPriority: priority,
            notes: lowStockNote,
            pushed_by: req.user.id,
          },
          t
        );
      } else {
        queueResult.nextEntry = await queueService.pushToQueue(
          {
            visit_id,
            department: 'pharmacy',
            priority,
            pushed_by: req.user.id,
            notes: lowStockNote,
          },
          t
        );
      }
    } catch (queueErr) {
      if (!t.finished) await t.rollback();
      const msg = queueErr.message || 'Failed to update patient queue';
      const status = msg.includes('already in the') ? 409 : 400;
      return error(res, msg, status);
    }

    await t.commit();

    try {
      if (lowStockAlerts.length > 0) {
        notificationService.emitStockAlert({
          prescription_id: prescription.id,
          visit_id,
          alerts: lowStockAlerts,
          doctor: `${req.user.first_name} ${req.user.last_name}`,
        });
      }
      const io = getIO();
      if (queueResult.completedEntry) {
        const completedDept = queueResult.completedEntry.department || 'doctor';
        io.to(`room:${completedDept}`).emit('queue:patient_moved', {
          entryId: queueResult.completedEntry.id,
          status: 'completed',
          department: completedDept,
        });
      }
      if (queueResult.nextEntry) {
        io.to('room:pharmacy').emit('queue:new_patient', { queueEntry: queueResult.nextEntry });
        emitPharmacistPrescriptionNotification(io, {
          pharmacyEntry: queueResult.nextEntry,
          prescription,
        });
      } else if (prescription) {
        emitPharmacistPrescriptionNotification(io, { prescription });
      }
    } catch (emitErr) {
      console.error('Post-prescription notification error:', emitErr.message);
    }

    const itemsPayload = await enrichItemsWithStock(
      prescriptionItems.map((row) => (row.toJSON ? row.toJSON() : row)),
      req.user.facility_id
    );

    emitDoctorActivity({
      visitId: visit_id,
      prescriptionId: prescription.id,
      doctorId: req.user.id,
      action: 'prescription',
    });

    return created(
      res,
      {
        prescription,
        items: itemsPayload,
        queueEntry: queueResult.nextEntry,
        doctorQueueCompleted: Boolean(queueResult.completedEntry),
        lowStockAlerts,
      },
      'Prescription sent to pharmacy — consultation completed'
    );
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Create prescription error:', err);
    const message =
      err.message ||
      err.parent?.sqlMessage ||
      err.original?.sqlMessage ||
      'Failed to create prescription';
    const status = message.includes('already in the') ? 409 : 500;
    return error(res, message, status);
  }
};

// Send patient to laboratory (batch tests + optional emergency).
// Optional `items` + `consultation_id`: also create prescription and queue for pharmacy (same visit).
exports.createLabOrder = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      visit_id,
      queue_entry_id,
      tests,
      clinical_notes,
      is_emergency,
      items: prescriptionItemsBody,
      consultation_id,
    } = req.body;

    if (!visit_id || !tests || !Array.isArray(tests) || tests.length === 0) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id and tests array are required', 400);
    }

    const hasPrescriptionBundle =
      Array.isArray(prescriptionItemsBody) && prescriptionItemsBody.length > 0;
    if (hasPrescriptionBundle && !consultation_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'consultation_id is required when prescription items are sent with a lab order', 400);
    }

    const visit = await Visit.findByPk(visit_id, {
      include: [{ model: Patient, as: 'patient', attributes: ['id', 'is_emergency'] }],
      transaction: t,
    });
    if (!visit) {
      if (!t.finished) await t.rollback();
      return error(res, 'Visit not found', 404);
    }

    if (hasPrescriptionBundle) {
      const consultation = await Consultation.findByPk(consultation_id, { transaction: t });
      if (!consultation) {
        if (!t.finished) await t.rollback();
        return error(res, 'Consultation not found. Complete diagnosis and try again.', 404);
      }
      if (consultation.visit_id !== visit_id) {
        if (!t.finished) await t.rollback();
        return error(res, 'Consultation does not belong to this visit', 400);
      }
    }

    const emergency =
      Boolean(is_emergency) || Boolean(visit.patient?.is_emergency);
    const testLabels = tests.map((x) => x.name || x.id).filter(Boolean);
    const test_type =
      testLabels.length <= 2
        ? testLabels.join(', ')
        : `${testLabels.slice(0, 2).join(', ')} +${testLabels.length - 2} more`;

    const labRequest = await LabRequest.create(
      {
        id: uuidv4(),
        visit_id,
        requested_by: req.user.id,
        test_type: test_type || 'Laboratory panel',
        clinical_notes: clinical_notes || null,
        tests,
        is_emergency: emergency,
        status: 'pending_sample',
      },
      { transaction: t }
    );

    let queueResult = { completedEntry: null, nextEntry: null };

    if (queue_entry_id) {
      const doctorEntry = await QueueEntry.findByPk(queue_entry_id, { transaction: t });
      if (
        doctorEntry &&
        doctorEntry.visit_id === visit_id &&
        doctorEntry.department === 'doctor' &&
        ['waiting', 'in_progress'].includes(doctorEntry.status)
      ) {
        queueResult = await queueService.completeEntry(
          queue_entry_id,
          {
            nextDepartment: 'lab',
            nextPriority: emergency ? 'emergency' : 'normal',
            notes: `Laboratory: ${test_type}`,
            pushed_by: req.user.id,
          },
          t
        );
      } else {
        queueResult.nextEntry = await queueService.pushToQueue(
          {
            visit_id,
            department: 'lab',
            priority: emergency ? 'emergency' : 'normal',
            pushed_by: req.user.id,
            notes: `Laboratory: ${test_type}`,
          },
          t
        );
      }
    } else {
      queueResult.nextEntry = await queueService.pushToQueue(
        {
          visit_id,
          department: 'lab',
          priority: emergency ? 'emergency' : 'normal',
          pushed_by: req.user.id,
          notes: `Laboratory: ${test_type}`,
        },
        t
      );
    }

    if (queueResult.nextEntry) {
      await labRequest.update({ queue_entry_id: queueResult.nextEntry.id }, { transaction: t });
    }

    let prescription = null;
    let prescriptionItems = [];
    let lowStockAlerts = [];
    let pharmacyQueueEntry = null;

    if (hasPrescriptionBundle) {
      const bundle = await createPrescriptionWithItems({
        visit_id,
        consultation_id,
        items: prescriptionItemsBody,
        prescribed_by: req.user.id,
        facility_id: req.user.facility_id,
        transaction: t,
      });
      prescription = bundle.prescription;
      prescriptionItems = bundle.prescriptionItems;
      lowStockAlerts = bundle.lowStockAlerts;

      const pharmacyPriority = visit.patient?.is_emergency ? 'emergency' : 'normal';
      const pharmacyNotes = [bundle.lowStockNote, 'Queued with laboratory order'].filter(Boolean).join(' · ');

      pharmacyQueueEntry = await queueService.pushToQueue(
        {
          visit_id,
          department: 'pharmacy',
          priority: pharmacyPriority,
          pushed_by: req.user.id,
          notes: pharmacyNotes || null,
        },
        t
      );
    }

    await t.commit();

    try {
      const io = getIO();
      if (queueResult.completedEntry) {
        io.to('room:doctor').emit('queue:patient_moved', {
          entryId: queueResult.completedEntry.id,
          status: 'completed',
          department: 'doctor',
        });
        const doctorEntries = await queueService.getQueue('doctor', req.user.facility_id);
        io.to('room:doctor').emit('queue:refresh', { department: 'doctor', entries: doctorEntries });
      }
      if (queueResult.nextEntry) {
        io.to('room:lab_technician').emit('queue:new_patient', {
          queueEntry: queueResult.nextEntry,
          labRequest,
        });
        const labQueue = await LabRequest.findAll({
          where: { status: { [Op.in]: ['pending_sample', 'sample_collected', 'processing'] } },
          include: [{ association: 'visit', where: { facility_id: req.user.facility_id }, attributes: ['id'] }],
        });
        io.to('room:lab_technician').emit('queue:refresh', { department: 'lab', entries: labQueue });
      }
      if (lowStockAlerts.length > 0) {
        notificationService.emitStockAlert({
          prescription_id: prescription.id,
          visit_id,
          alerts: lowStockAlerts,
          doctor: `${req.user.first_name} ${req.user.last_name}`,
        });
      }
      if (pharmacyQueueEntry) {
        io.to('room:pharmacy').emit('queue:new_patient', { queueEntry: pharmacyQueueEntry });
        io.to('room:pharmacist').emit('queue:new_patient', { queueEntry: pharmacyQueueEntry });
      }
    } catch (emitErr) {
      console.error('Lab order socket emit error:', emitErr.message);
    }

    const message = hasPrescriptionBundle
      ? 'Patient sent to laboratory and prescription queued for pharmacy'
      : 'Patient sent to laboratory';

    emitDoctorActivity({
      visitId: visit_id,
      labRequestId: labRequest.id,
      doctorId: req.user.id,
      action: 'lab_order',
    });

    return created(
      res,
      {
        labRequest,
        queueEntry: queueResult.nextEntry,
        doctorQueueCompleted: Boolean(queueResult.completedEntry),
        prescription,
        prescriptionItems,
        pharmacyQueueEntry,
        lowStockAlerts,
      },
      message
    );
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Create lab order error:', err);
    const message = err.message || 'Failed to send to laboratory';
    const status = message.includes('already in the') ? 409 : 500;
    return error(res, message, status);
  }
};

exports.createLabRequest = exports.createLabOrder;

// Clinical referral to ultrasound (sonar) — patient joins sonar queue; doctor queue completes.
exports.createSonarRequest = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      visit_id,
      queue_entry_id,
      scan_type,
      scan_id,
      symptoms,
      clinical_notes,
      diagnostic_questions,
      prep_instructions,
      is_emergency,
    } = req.body;

    if (!visit_id || !scan_type) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id and scan_type are required', 400);
    }

    const visit = await Visit.findByPk(visit_id, {
      include: [{ model: Patient, as: 'patient', attributes: ['id', 'is_emergency'] }],
      transaction: t,
    });
    if (!visit) {
      if (!t.finished) await t.rollback();
      return error(res, 'Visit not found', 404);
    }

    const emergency = Boolean(is_emergency) || Boolean(visit.patient?.is_emergency);

    const sonarRequest = await SonarRequest.create(
      {
        id: uuidv4(),
        visit_id,
        requested_by: req.user.id,
        scan_type,
        symptoms: symptoms?.trim() || null,
        clinical_notes: clinical_notes?.trim() || null,
        diagnostic_questions: diagnostic_questions?.trim() || null,
        prep_instructions: prep_instructions?.trim() || null,
        is_emergency: emergency,
        status: 'pending',
      },
      { transaction: t }
    );

    let queueResult = { completedEntry: null, nextEntry: null };

    if (queue_entry_id) {
      const doctorEntry = await QueueEntry.findByPk(queue_entry_id, { transaction: t });
      if (
        doctorEntry &&
        doctorEntry.visit_id === visit_id &&
        doctorEntry.department === 'doctor' &&
        ['waiting', 'in_progress'].includes(doctorEntry.status)
      ) {
        queueResult = await queueService.completeEntry(
          queue_entry_id,
          {
            nextDepartment: 'sonar',
            nextPriority: emergency ? 'emergency' : 'normal',
            notes: `Ultrasound: ${scan_type}`,
            pushed_by: req.user.id,
          },
          t
        );
      } else {
        queueResult.nextEntry = await queueService.pushToQueue(
          {
            visit_id,
            department: 'sonar',
            priority: emergency ? 'emergency' : 'normal',
            pushed_by: req.user.id,
            notes: `Ultrasound: ${scan_type}`,
          },
          t
        );
      }
    } else {
      queueResult.nextEntry = await queueService.pushToQueue(
        {
          visit_id,
          department: 'sonar',
          priority: emergency ? 'emergency' : 'normal',
          pushed_by: req.user.id,
          notes: `Ultrasound: ${scan_type}`,
        },
        t
      );
    }

    if (queueResult.nextEntry?.id) {
      await sonarRequest.update({ queue_entry_id: queueResult.nextEntry.id }, { transaction: t });
    }

    await t.commit();

    try {
      const io = getIO();
      if (queueResult.completedEntry) {
        io.to('room:doctor').emit('queue:patient_moved', {
          entryId: queueResult.completedEntry.id,
          status: 'completed',
          department: 'doctor',
        });
        const doctorEntries = await queueService.getQueue('doctor', req.user.facility_id);
        io.to('room:doctor').emit('queue:refresh', { department: 'doctor', entries: doctorEntries });
      }
      if (queueResult.nextEntry) {
        io.to('room:radiologist').emit('queue:new_patient', {
          queueEntry: queueResult.nextEntry,
          sonarRequest,
        });
        io.to('room:radiologist').emit('queue:refresh', { department: 'sonar' });
      }
      emitDoctorActivity({
        visitId: visit_id,
        sonarRequestId: sonarRequest.id,
        doctorId: req.user.id,
        action: 'sonar_referral',
      });
    } catch (emitErr) {
      console.error('Sonar referral socket emit error:', emitErr.message);
    }

    return created(
      res,
      {
        sonarRequest,
        queueEntry: queueResult.nextEntry,
        doctorQueueCompleted: Boolean(queueResult.completedEntry),
      },
      'Patient referred to ultrasound — removed from your queue'
    );
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Create sonar request error:', err);
    const message = err.message || 'Failed to create sonar request';
    const status = message.includes('already in the') ? 409 : 500;
    return error(res, message, status);
  }
};

// Admit patient to ward
exports.admitPatient = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      visit_id,
      bed_id,
      equipment_required,
      equipment_notes,
      ward_id,
      critical_notes,
      equipment_checklist,
    } = req.body;
    if (!visit_id || !bed_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id and bed_id are required', 400);
    }

    const visit = await Visit.findByPk(visit_id, {
      include: [{ model: Patient, as: 'patient', attributes: ['id', 'is_emergency'] }],
      transaction: t,
    });
    if (!visit) {
      if (!t.finished) await t.rollback();
      return error(res, 'Visit not found', 404);
    }

    const transportPriority =
      visit.patient?.is_emergency || visit.visit_type === 'emergency' ? 'emergency' : 'normal';

    // Check bed availability
    const bed = await Bed.findByPk(bed_id, { include: [{ model: Ward, as: 'ward' }], transaction: t });
    if (!bed) {
      if (!t.finished) await t.rollback();
      return error(res, 'Bed not found', 404);
    }
    if (bed.status !== 'available') {
      if (!t.finished) await t.rollback();
      return error(res, 'Bed is not available', 400);
    }

    // Create admission
    const admission = await Admission.create({
      id: uuidv4(),
      visit_id,
      bed_id,
      admitted_by: req.user.id,
      status: 'pending_arrival',
      admitted_at: null,
    }, { transaction: t });

    // Reserve bed until ward staff confirms physical arrival
    await bed.update({ status: 'reserved' }, { transaction: t });

    const allowedIds = new Set(ADMIT_TRANSPORT_CHECKLIST_OPTIONS.map((o) => o.id));
    let checklistStored = null;
    if (Array.isArray(equipment_checklist) && equipment_checklist.length > 0) {
      const picked = equipment_checklist
        .filter((row) => row && row.checked && allowedIds.has(row.id))
        .map((row) => {
          const opt = ADMIT_TRANSPORT_CHECKLIST_OPTIONS.find((o) => o.id === row.id);
          return opt ? { id: opt.id, label: opt.label } : null;
        })
        .filter(Boolean);
      checklistStored = picked.length ? picked : null;
    }

    // Create transport request
    const transportReq = await TransportRequest.create({
      id: uuidv4(),
      visit_id,
      from_location: 'Doctor Consultation Room',
      to_location: [
        bed.ward.name,
        bed.room_number ? `Room ${bed.room_number}` : null,
        `Bed ${bed.bed_number}`,
      ]
        .filter(Boolean)
        .join(' — '),
      equipment_required: equipment_required || 'wheelchair',
      equipment_notes: equipment_notes || null,
      critical_notes: critical_notes && String(critical_notes).trim() ? String(critical_notes).trim() : null,
      equipment_checklist: checklistStored,
      priority: transportPriority,
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
    try {
      const io = getIO();
      io.to('room:porter').emit('transport:queue_refresh', { reason: 'new_request' });
    } catch (e) {
      /* ignore */
    }
    notificationService.emitWardStaffAdmission({
      admission_id: admission.id,
      visit_id,
      bed_id,
      ward_id: bed.ward_id,
      ward_name: bed.ward.name,
      room_number: bed.room_number,
      bed_number: bed.bed_number,
    });
    notificationService.emitWardUpdate({
      type: 'admission',
      admission,
      bed_id,
      ward_id: bed.ward_id,
    });

    let diet = null;
    if (req.body.diet_type) {
      try {
        const result = await dietPrescriptionService.prescribeForAdmission({
          admissionId: admission.id,
          prescribedBy: req.user.id,
          diet_type: req.body.diet_type,
          description: req.body.diet_description || req.body.description || null,
          restrictions: req.body.diet_restrictions || req.body.restrictions || null,
          special_instructions:
            req.body.diet_special_instructions || req.body.special_instructions || null,
          start_date: req.body.diet_start_date || dietPrescriptionService.todayDateString(),
          end_date: req.body.diet_end_date || null,
        });
        dietPrescriptionService.emitKitchenOrder(result.kitchenOrder);
        diet = {
          dietPrescription: result.dietPrescription,
          mealPlans: result.mealPlans,
        };
      } catch (dietErr) {
        console.error('Diet prescription on admit error:', dietErr);
      }
    }

    return created(
      res,
      { admission, transportRequest: transportReq, diet },
      diet ? 'Patient admitted — diet sent to kitchen' : 'Patient admitted'
    );
  } catch (err) {
    if (!t.finished) await t.rollback();
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

    if (visit.patient.payment_type === 'private') {
      await billingChargeService.finalizeBillForDischarge(id, req.user.facility_id, t);
      const bill = await Bill.findOne({ where: { visit_id: id }, transaction: t });
      const totalDue = bill ? billingChargeService.money(bill.total_amount) : 0;

      if (bill && bill.status !== 'paid' && bill.status !== 'waived' && totalDue > 0) {
        const queueEntry = await queueService.pushToQueue({
          visit_id: id,
          department: 'billing',
          priority: 'normal',
          pushed_by: req.user.id,
          notes: 'Private patient — settlement required before discharge',
        }, t);

        await visit.update({ current_department: 'billing' }, { transaction: t });
        await t.commit();

        notificationService.emitBillingCharge({
          facility_id: req.user.facility_id,
          visit_id: id,
          patient: visit.patient,
          queueEntry,
          bill_id: bill.id,
          total_amount: totalDue,
        });
        return success(
          res,
          { queueEntry, bill, total_amount: totalDue },
          'Patient sent to billing — payment required (cash + EFT)'
        );
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
    if (!t.finished) await t.rollback();
    console.error('Discharge error:', err);
    return error(res, 'Failed to discharge patient', 500);
  }
};

// Prescribe diet for admitted patient (ward must have assigned bed)
exports.prescribeDiet = async (req, res) => {
  try {
    const {
      admission_id,
      diet_type,
      description,
      restrictions,
      special_instructions,
      start_date,
      end_date,
    } = req.body;
    if (!admission_id || !diet_type) {
      return error(res, 'admission_id and diet_type are required', 400);
    }

    const result = await dietPrescriptionService.prescribeForAdmission({
      admissionId: admission_id,
      prescribedBy: req.user.id,
      diet_type,
      description,
      restrictions,
      special_instructions,
      start_date: start_date || dietPrescriptionService.todayDateString(),
      end_date,
    });

    dietPrescriptionService.emitKitchenOrder(result.kitchenOrder);

    return created(
      res,
      {
        dietPrescription: result.dietPrescription,
        mealPlans: result.mealPlans,
        kitchenOrder: result.kitchenOrder,
      },
      'Diet prescribed — kitchen notified with ward and room'
    );
  } catch (err) {
    console.error('Prescribe diet error:', err);
    const status = err.message === 'Admission not found' ? 404 : 500;
    return error(res, err.message || 'Failed to prescribe diet', status);
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

async function upsertClinicConsultation({
  visit_id,
  doctor_id,
  diagnosis,
  notes,
  actions_taken,
  transaction,
}) {
  let consultation = await Consultation.findOne({
    where: { visit_id },
    order: [['created_at', 'DESC']],
    transaction,
  });

  const payload = {
    diagnosis: diagnosis.trim(),
    notes: notes || null,
    actions_taken: actions_taken || null,
  };

  if (consultation) {
    await consultation.update(payload, { transaction });
    return consultation;
  }

  consultation = await Consultation.create(
    {
      id: uuidv4(),
      visit_id,
      doctor_id,
      ...payload,
    },
    { transaction }
  );
  return consultation;
}

async function resolveClinicDoctorQueueEntry({ visit_id, queue_entry_id, transaction }) {
  let doctorEntry = await queueService.findActiveEntryForVisit(
    visit_id,
    CLINIC_DOCTOR_DEPARTMENT,
    transaction
  );
  if (!doctorEntry && queue_entry_id) {
    doctorEntry = await QueueEntry.findByPk(queue_entry_id, { transaction });
  }
  if (
    doctorEntry
    && doctorEntry.department === CLINIC_DOCTOR_DEPARTMENT
    && ['waiting', 'in_progress'].includes(doctorEntry.status)
  ) {
    return doctorEntry;
  }
  return null;
}

function emitClinicDoctorQueueEvents({ io, queueResult, nextDepartment, pharmacyEntry, prescription }) {
  if (!io) return;
  if (queueResult.completedEntry) {
    io.to(`room:${CLINIC_DOCTOR_DEPARTMENT}`).emit('queue:patient_moved', {
      entryId: queueResult.completedEntry.id,
      status: 'completed',
      department: CLINIC_DOCTOR_DEPARTMENT,
    });
  }
  if (queueResult.nextEntry && nextDepartment) {
    io.to(`room:${nextDepartment}`).emit('queue:new_patient', { queueEntry: queueResult.nextEntry });
  }
  if (pharmacyEntry || prescription) {
    emitPharmacistPrescriptionNotification(io, { pharmacyEntry, prescription });
  }
}

function emitPharmacistPrescriptionNotification(io, { pharmacyEntry, prescription }) {
  if (!io) return;
  const payload = {
    queueEntry: pharmacyEntry || null,
    prescriptionId: prescription?.id || null,
    department: 'pharmacy',
  };
  io.to('room:pharmacist').emit('queue:new_patient', payload);
  io.to('room:pharmacist').emit('pharmacy:new_prescription', payload);
  io.to('room:pharmacy').emit('queue:new_patient', payload);
  io.to('room:pharmacy_supervisor').emit('pharmacy:new_prescription', payload);
}

async function applyClinicPrescriptionIfItems({
  visit_id,
  consultation_id,
  items,
  user,
  transaction,
}) {
  if (!items || !items.length) {
    return { prescription: null, pharmacyEntry: null, lowStockAlerts: [] };
  }

  const visit = await Visit.findByPk(visit_id, {
    include: [{ model: Patient, as: 'patient', attributes: ['is_emergency'] }],
    transaction,
  });
  const priority = visit?.patient?.is_emergency ? 'emergency' : 'normal';

  const { prescription, lowStockAlerts, lowStockNote } = await createPrescriptionWithItems({
    visit_id,
    consultation_id,
    items,
    prescribed_by: user.id,
    facility_id: user.facility_id,
    transaction,
  });

  await billingChargeService.chargeConsultationFee(
    visit_id,
    consultation_id,
    user.facility_id,
    transaction
  );

  const pharmacyEntry = await queueService.pushToQueue(
    {
      visit_id,
      department: 'pharmacy',
      priority,
      pushed_by: user.id,
      notes: lowStockNote,
    },
    transaction
  );

  return { prescription, pharmacyEntry, lowStockAlerts };
}

// Clinic doctor: schedule follow-up and complete consultation
exports.clinicScheduleFollowUp = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, queue_entry_id, diagnosis, follow_up_date, notes, items } = req.body;

    if (!visit_id || !queue_entry_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }

    const diagnosisError = validateDiagnosis(diagnosis);
    if (diagnosisError) {
      if (!t.finished) await t.rollback();
      return error(res, diagnosisError, 400);
    }
    if (!follow_up_date) {
      if (!t.finished) await t.rollback();
      return error(res, 'follow_up_date is required', 400);
    }

    const visit = await Visit.findByPk(visit_id, { transaction: t });
    if (!visit) {
      if (!t.finished) await t.rollback();
      return error(res, 'Visit not found', 404);
    }

    const consultation = await upsertClinicConsultation({
      visit_id,
      doctor_id: req.user.id,
      diagnosis,
      notes,
      actions_taken: JSON.stringify({
        clinic_disposition: 'follow_up',
        follow_up_date,
        prescribed: Boolean(items?.length),
      }),
      transaction: t,
    });

    const prescriptionResult = await applyClinicPrescriptionIfItems({
      visit_id,
      consultation_id: consultation.id,
      items,
      user: req.user,
      transaction: t,
    });

    await Referral.create(
      {
        id: uuidv4(),
        visit_id,
        referred_by: req.user.id,
        referral_type: 'follow_up',
        reason: diagnosis.trim(),
        follow_up_date,
        status: 'pending',
      },
      { transaction: t }
    );

    const doctorEntry = await resolveClinicDoctorQueueEntry({ visit_id, queue_entry_id, transaction: t });
    let queueResult = { completedEntry: null, nextEntry: null };
    if (doctorEntry) {
      queueResult = await queueService.completeEntry(
        doctorEntry.id,
        { pushed_by: req.user.id, notes: `Follow-up scheduled for ${follow_up_date}` },
        t
      );
    }

    await t.commit();

    try {
      const io = getIO();
      emitClinicDoctorQueueEvents({
        io,
        queueResult,
        nextDepartment: null,
        pharmacyEntry: prescriptionResult.pharmacyEntry,
        prescription: prescriptionResult.prescription,
      });
      emitDoctorActivity({
        visitId: visit_id,
        consultationId: consultation.id,
        doctorId: req.user.id,
        action: prescriptionResult.prescription ? 'clinic_follow_up_with_rx' : 'clinic_follow_up',
      });
    } catch (emitErr) {
      console.error('Clinic follow-up socket emit error:', emitErr.message);
    }

    return created(
      res,
      {
        consultation,
        follow_up_date,
        prescription: prescriptionResult.prescription,
        queueCompleted: Boolean(queueResult.completedEntry),
        lowStockAlerts: prescriptionResult.lowStockAlerts,
      },
      prescriptionResult.prescription
        ? 'Prescription sent to pharmacy, follow-up scheduled, consultation completed'
        : 'Follow-up scheduled and consultation completed'
    );
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Clinic follow-up error:', err);
    return error(res, err.message || 'Failed to schedule follow-up', 500);
  }
};

// Clinic doctor: transfer patient to emergency unit queue
exports.clinicTransferEmergencyUnit = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, queue_entry_id, diagnosis, notes } = req.body;

    if (!visit_id || !queue_entry_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }

    const diagnosisError = validateDiagnosis(diagnosis);
    if (diagnosisError) {
      if (!t.finished) await t.rollback();
      return error(res, diagnosisError, 400);
    }

    const visit = await Visit.findByPk(visit_id, { transaction: t });
    if (!visit) {
      if (!t.finished) await t.rollback();
      return error(res, 'Visit not found', 404);
    }

    const consultation = await upsertClinicConsultation({
      visit_id,
      doctor_id: req.user.id,
      diagnosis,
      notes,
      actions_taken: JSON.stringify({ clinic_disposition: 'emergency_unit' }),
      transaction: t,
    });

    const doctorEntry = await resolveClinicDoctorQueueEntry({ visit_id, queue_entry_id, transaction: t });
    let queueResult = { completedEntry: null, nextEntry: null };

    if (doctorEntry) {
      queueResult = await queueService.completeEntry(
        doctorEntry.id,
        {
          nextDepartment: 'emergency_unit',
          nextPriority: 'emergency',
          pushed_by: req.user.id,
          notes: notes || 'Transferred from clinic doctor to Emergency Unit',
        },
        t
      );
    } else {
      queueResult.nextEntry = await queueService.pushToQueue(
        {
          visit_id,
          department: 'emergency_unit',
          priority: 'emergency',
          pushed_by: req.user.id,
          notes: notes || 'Transferred from clinic doctor to Emergency Unit',
        },
        t
      );
    }

    await t.commit();

    try {
      const io = getIO();
      emitClinicDoctorQueueEvents({
        io,
        queueResult,
        nextDepartment: 'emergency_unit',
        pharmacyEntry: null,
        prescription: null,
      });
      await queueService.getQueue('emergency_unit', req.user.facility_id).then((entries) => {
        io.to('room:emergency_unit').emit('queue:refresh', { department: 'emergency_unit', entries });
      });
      emitDoctorActivity({
        visitId: visit_id,
        consultationId: consultation.id,
        doctorId: req.user.id,
        action: 'clinic_emergency_unit',
      });
    } catch (emitErr) {
      console.error('Clinic emergency unit socket error:', emitErr.message);
    }

    return created(res, {
      consultation,
      queueEntry: queueResult.nextEntry,
    }, 'Patient transferred to Emergency Unit');
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Clinic emergency unit error:', err);
    return error(res, err.message || 'Failed to transfer to emergency unit', 500);
  }
};

// Clinic doctor: transfer patient to booking room queue
exports.clinicTransferBookingRoom = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, queue_entry_id, diagnosis, notes, items } = req.body;

    if (!visit_id || !queue_entry_id) {
      if (!t.finished) await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }

    const diagnosisError = validateDiagnosis(diagnosis);
    if (diagnosisError) {
      if (!t.finished) await t.rollback();
      return error(res, diagnosisError, 400);
    }

    const visit = await Visit.findByPk(visit_id, { transaction: t });
    if (!visit) {
      if (!t.finished) await t.rollback();
      return error(res, 'Visit not found', 404);
    }

    const consultation = await upsertClinicConsultation({
      visit_id,
      doctor_id: req.user.id,
      diagnosis,
      notes,
      actions_taken: JSON.stringify({
        clinic_disposition: 'booking_room',
        prescribed: Boolean(items?.length),
      }),
      transaction: t,
    });

    const prescriptionResult = await applyClinicPrescriptionIfItems({
      visit_id,
      consultation_id: consultation.id,
      items,
      user: req.user,
      transaction: t,
    });

    const doctorEntry = await resolveClinicDoctorQueueEntry({ visit_id, queue_entry_id, transaction: t });
    let queueResult = { completedEntry: null, nextEntry: null };

    if (doctorEntry) {
      queueResult = await queueService.completeEntry(
        doctorEntry.id,
        {
          nextDepartment: 'booking_room',
          pushed_by: req.user.id,
          notes: notes || 'Transferred from clinic doctor',
        },
        t
      );
    } else {
      queueResult.nextEntry = await queueService.pushToQueue(
        {
          visit_id,
          department: 'booking_room',
          pushed_by: req.user.id,
          notes: notes || 'Transferred from clinic doctor',
        },
        t
      );
    }

    await t.commit();

    try {
      const io = getIO();
      emitClinicDoctorQueueEvents({
        io,
        queueResult,
        nextDepartment: 'booking_room',
        pharmacyEntry: prescriptionResult.pharmacyEntry,
        prescription: prescriptionResult.prescription,
      });
      emitDoctorActivity({
        visitId: visit_id,
        consultationId: consultation.id,
        doctorId: req.user.id,
        action: prescriptionResult.prescription ? 'clinic_booking_room_with_rx' : 'clinic_booking_room',
      });
    } catch (emitErr) {
      console.error('Clinic booking room socket emit error:', emitErr.message);
    }

    return created(
      res,
      {
        consultation,
        queueEntry: queueResult.nextEntry,
        prescription: prescriptionResult.prescription,
        queueCompleted: Boolean(queueResult.completedEntry),
        lowStockAlerts: prescriptionResult.lowStockAlerts,
      },
      prescriptionResult.prescription
        ? 'Prescription sent to pharmacy and patient transferred to Booking Room'
        : 'Patient transferred to Booking Room'
    );
  } catch (err) {
    if (!t.finished) await t.rollback();
    console.error('Clinic booking room transfer error:', err);
    const message = err.message || 'Failed to transfer to booking room';
    const status = message.includes('already in the') ? 409 : 500;
    return error(res, message, status);
  }
};
