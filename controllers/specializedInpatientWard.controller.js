const specializedInpatientWardService = require('../services/specializedInpatientWardService');
const wardController = require('./ward.controller');
const { success, error } = require('../utils/response');

function handleServiceError(res, err, fallback) {
  const status = err.statusCode || 500;
  if (err.validationErrors) {
    return res.status(status).json({
      success: false,
      message: err.message || fallback,
      validation_errors: err.validationErrors,
    });
  }
  return error(res, err.message || fallback, status);
}

exports.listAdmitted = async (req, res) => {
  try {
    const admissions = await specializedInpatientWardService.listAdmittedPatients(req.user.facility_id);
    const payload = admissions.map((row) => wardController.formatAdmissionForStaff(row));
    return success(res, payload);
  } catch (err) {
    return handleServiceError(res, err, 'Failed to load specialized inpatient patients');
  }
};

exports.listDailyRecords = async (req, res) => {
  try {
    const records = await specializedInpatientWardService.listDailyRecords(
      req.params.admissionId,
      req.user.facility_id
    );
    return success(res, { records });
  } catch (err) {
    return handleServiceError(res, err, 'Failed to load daily records');
  }
};

exports.saveDailyRecord = async (req, res) => {
  try {
    const record = await specializedInpatientWardService.saveDailyRecord({
      admissionId: req.params.admissionId,
      facilityId: req.user.facility_id,
      userId: req.user.id,
      body: req.body,
    });
    return success(res, { record }, 'Specialized inpatient daily record saved');
  } catch (err) {
    return handleServiceError(res, err, 'Failed to save daily record');
  }
};

function pickTransportFromBody(body = {}) {
  return {
    equipment_required: body.equipment_required,
    equipment_notes: body.equipment_notes,
    critical_notes: body.critical_notes,
    equipment_checklist: body.equipment_checklist,
  };
}

exports.transferToWard = async (req, res) => {
  try {
    const result = await specializedInpatientWardService.transferToWard({
      admissionId: req.params.admissionId,
      facilityId: req.user.facility_id,
      userId: req.user.id,
      targetWardType: req.body.target_ward_type,
      bedId: req.body.bed_id,
      transport: pickTransportFromBody(req.body),
    });
    return success(res, result, 'Ward transfer requested — internal porter notified');
  } catch (err) {
    return handleServiceError(res, err, 'Failed to request ward transfer');
  }
};

exports.dischargePatient = async (req, res) => {
  try {
    const result = await specializedInpatientWardService.dischargePatient({
      admissionId: req.params.admissionId,
      facilityId: req.user.facility_id,
      userId: req.user.id,
      discharge_notes: req.body.discharge_notes,
    });
    return success(res, result, 'Patient discharged');
  } catch (err) {
    return handleServiceError(res, err, 'Failed to discharge patient');
  }
};

exports.transferToMortuary = async (req, res) => {
  try {
    const result = await specializedInpatientWardService.transferToMortuary({
      admissionId: req.params.admissionId,
      facilityId: req.user.facility_id,
      userId: req.user.id,
      cause_of_death: req.body.cause_of_death,
      date_of_death: req.body.date_of_death,
      notes: req.body.notes,
      transport: pickTransportFromBody(req.body),
    });
    return success(res, result, 'Mortuary transfer requested — internal porter notified');
  } catch (err) {
    return handleServiceError(res, err, 'Failed to request mortuary transfer');
  }
};
