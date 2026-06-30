const icuWardService = require('../services/icuWardService');
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
    const admissions = await icuWardService.listAdmittedPatients(req.user.facility_id);
    const payload = admissions.map((row) => wardController.formatAdmissionForStaff(row));
    return success(res, payload);
  } catch (err) {
    return handleServiceError(res, err, 'Failed to load ICU patients');
  }
};

exports.listDailyRecords = async (req, res) => {
  try {
    const records = await icuWardService.listDailyRecords(
      req.params.admissionId,
      req.user.facility_id
    );
    return success(res, { records });
  } catch (err) {
    return handleServiceError(res, err, 'Failed to load ICU daily records');
  }
};

exports.saveDailyRecord = async (req, res) => {
  try {
    const record = await icuWardService.saveDailyRecord({
      admissionId: req.params.admissionId,
      facilityId: req.user.facility_id,
      userId: req.user.id,
      body: req.body,
    });
    return success(res, { record }, 'ICU daily record saved');
  } catch (err) {
    return handleServiceError(res, err, 'Failed to save ICU daily record');
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

exports.transferToGeneralWard = async (req, res) => {
  try {
    const result = await icuWardService.transferToGeneralWard({
      admissionId: req.params.admissionId,
      facilityId: req.user.facility_id,
      userId: req.user.id,
      bedId: req.body.bed_id,
      transport: pickTransportFromBody(req.body),
    });
    return success(res, result, 'General ward transfer requested — internal porter notified');
  } catch (err) {
    return handleServiceError(res, err, 'Failed to request ward transfer');
  }
};

exports.transferToMortuary = async (req, res) => {
  try {
    const result = await icuWardService.transferToMortuary({
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
