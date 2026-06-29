const { success, error } = require('../utils/response');
const { departmentForRole } = require('../config/hospitalOutpatientConfig');
const queueService = require('../services/queueService');
const hospitalOutpatientService = require('../services/hospitalOutpatientService');
const { serializeTransferWithTimeline } = require('../services/clinicHospitalTransferService');
const { QueueEntry, Visit, Patient, ClinicHospitalTransfer } = require('../models');
const { Op } = require('sequelize');

exports.getQueue = async (req, res) => {
  try {
    const department = departmentForRole(req.user?.role?.name);
    if (!department) return error(res, 'Your role is not linked to a hospital outpatient department', 403);

    const entries = await queueService.getQueue(department, req.user.facility_id);
    return success(res, entries);
  } catch (err) {
    return error(res, err.message || 'Failed to load queue', 500);
  }
};

exports.getInboundTransfers = async (req, res) => {
  try {
    const department = departmentForRole(req.user?.role?.name);
    if (!department) return error(res, 'Your role is not linked to a hospital outpatient department', 403);

    const transfers = await ClinicHospitalTransfer.findAll({
      where: {
        hospital_facility_id: req.user.facility_id,
        destination_department: department,
        transfer_status: {
          [Op.in]: ['arrived_hospital', 'internal_in_transit', 'delivered_to_department'],
        },
      },
      include: [
        {
          association: 'visit',
          include: [{ model: Patient, as: 'patient' }],
        },
        { association: 'hospitalVisit', include: [{ model: Patient, as: 'patient' }] },
        { association: 'externalTransport' },
        { association: 'internalTransport' },
      ],
      order: [['updated_at', 'DESC']],
      limit: 50,
    });

    return success(res, transfers);
  } catch (err) {
    return error(res, 'Failed to load inbound transfers', 500);
  }
};

exports.getTransferForQueueEntry = async (req, res) => {
  try {
    const entry = await QueueEntry.findByPk(req.params.queueEntryId, {
      include: [{ association: 'visit', include: [{ association: 'patient' }] }],
    });
    if (!entry) return error(res, 'Queue entry not found', 404);

    const transfer = await ClinicHospitalTransfer.findOne({
      where: { hospital_visit_id: entry.visit_id },
      order: [['created_at', 'DESC']],
      include: [
        { association: 'clinicFacility', attributes: ['id', 'name'] },
        { association: 'hospitalFacility', attributes: ['id', 'name'] },
        { association: 'externalTransport' },
        { association: 'internalTransport' },
        { association: 'plannedBy', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'initiatedBy', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'externalPickedUpBy', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'departureConfirmedBy', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'internalPickedUpBy', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'receivedBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
    });

    return success(res, {
      entry,
      transfer: serializeTransferWithTimeline(transfer),
    });
  } catch (err) {
    return error(res, 'Failed to load transfer details', 500);
  }
};

exports.getWorkspace = async (req, res) => {
  try {
    const { entry } = await hospitalOutpatientService.loadQueueEntryForUser(
      req.params.queueEntryId,
      req.user
    );
    const workspace = await hospitalOutpatientService.buildWorkspace(entry, req.user);
    return success(res, workspace);
  } catch (err) {
    return error(res, err.message || 'Failed to load workspace', err.statusCode || 500);
  }
};

exports.startSession = async (req, res) => {
  try {
    const workspace = await hospitalOutpatientService.startSession({
      queueEntryId: req.body.queue_entry_id || req.params.queueEntryId,
      user: req.user,
    });
    return success(res, workspace);
  } catch (err) {
    return error(res, err.message || 'Failed to start session', err.statusCode || 500);
  }
};

exports.saveVitals = async (req, res) => {
  try {
    const result = await hospitalOutpatientService.saveVitals({
      visitId: req.body.visit_id,
      queueEntryId: req.body.queue_entry_id,
      temperature: req.body.temperature,
      pulse_rate: req.body.pulse_rate,
      oxygen_saturation: req.body.oxygen_saturation,
      blood_pressure_systolic: req.body.blood_pressure_systolic,
      blood_pressure_diastolic: req.body.blood_pressure_diastolic,
      respiratory_rate: req.body.respiratory_rate,
      gcs_score: req.body.gcs_score,
      pain_score: req.body.pain_score,
      weight: req.body.weight,
      blood_glucose: req.body.blood_glucose,
      pupillary_check: req.body.pupillary_check,
      is_critical: req.body.is_critical,
      notes: req.body.notes,
      user: req.user,
    });
    return success(res, result, 'Vitals saved');
  } catch (err) {
    return error(res, err.message || 'Failed to save vitals', err.statusCode || 500);
  }
};

exports.admitToWard = async (req, res) => {
  try {
    const result = await hospitalOutpatientService.admitToWard({
      visitId: req.body.visit_id,
      queueEntryId: req.body.queue_entry_id,
      bedId: req.body.bed_id,
      wardType: req.body.ward_type,
      criticalNotes: req.body.critical_notes,
      user: req.user,
    });
    return success(res, result, 'Patient admitted to ward');
  } catch (err) {
    return error(res, err.message || 'Failed to admit patient', err.statusCode || 500);
  }
};

exports.dischargePatient = async (req, res) => {
  try {
    const result = await hospitalOutpatientService.dischargePatient({
      visitId: req.body.visit_id,
      queueEntryId: req.body.queue_entry_id,
      dischargeReason: req.body.discharge_reason,
      notes: req.body.notes,
      user: req.user,
    });
    return success(res, result, 'Consultation completed and patient discharged');
  } catch (err) {
    return error(res, err.message || 'Failed to discharge patient', err.statusCode || 500);
  }
};
