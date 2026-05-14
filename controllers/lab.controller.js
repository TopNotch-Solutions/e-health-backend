const { v4: uuidv4 } = require('uuid');
const { LabRequest, LabResult, Visit, Patient, User } = require('../models');
const { Op } = require('sequelize');
const { success, created, error } = require('../utils/response');
const notificationService = require('../services/notificationService');

// Get lab queue (pending requests)
exports.getQueue = async (req, res) => {
  try {
    const requests = await LabRequest.findAll({
      where: { status: { [Op.in]: ['pending_sample', 'sample_collected', 'processing'] } },
      include: [
        {
          association: 'visit',
          where: { facility_id: req.user.facility_id },
          include: [{ model: Patient, as: 'patient', attributes: ['id', 'first_name', 'last_name', 'patient_number'] }],
        },
        { association: 'requestedBy', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'nurse', attributes: ['id', 'first_name', 'last_name'] },
      ],
      order: [['created_at', 'ASC']],
    });

    return success(res, requests);
  } catch (err) {
    console.error('Get lab queue error:', err);
    return error(res, 'Failed to fetch lab queue', 500);
  }
};

// Get single lab request with result
exports.getById = async (req, res) => {
  try {
    const request = await LabRequest.findByPk(req.params.id, {
      include: [
        { association: 'visit', include: [{ model: Patient, as: 'patient' }] },
        { association: 'requestedBy', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'nurse', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'result', include: [{ association: 'processedBy', attributes: ['id', 'first_name', 'last_name'] }] },
      ],
    });

    if (!request) return error(res, 'Lab request not found', 404);
    return success(res, request);
  } catch (err) {
    return error(res, 'Failed to fetch lab request', 500);
  }
};

// Nurse marks sample collected
exports.sampleCollected = async (req, res) => {
  try {
    const { id } = req.params;
    const { blood_details } = req.body;

    const request = await LabRequest.findByPk(id);
    if (!request) return error(res, 'Lab request not found', 404);
    if (request.status !== 'pending_sample') {
      return error(res, 'Sample already collected or processed', 400);
    }

    await request.update({
      status: 'sample_collected',
      blood_details: blood_details || null,
      nurse_id: req.user.id,
    });

    return success(res, request, 'Sample collected - submitted to lab');
  } catch (err) {
    return error(res, 'Failed to update sample status', 500);
  }
};

// Lab tech marks as processing
exports.startProcessing = async (req, res) => {
  try {
    const request = await LabRequest.findByPk(req.params.id);
    if (!request) return error(res, 'Lab request not found', 404);
    if (request.status !== 'sample_collected') {
      return error(res, 'Sample not yet collected', 400);
    }

    await request.update({ status: 'processing' });
    return success(res, request, 'Processing started');
  } catch (err) {
    return error(res, 'Failed to start processing', 500);
  }
};

// Lab tech submits results
exports.submitResults = async (req, res) => {
  try {
    const { id } = req.params;
    const { results, result_data, attachments } = req.body;

    if (!results) return error(res, 'results field is required', 400);

    const request = await LabRequest.findByPk(id);
    if (!request) return error(res, 'Lab request not found', 404);
    if (request.status === 'completed') {
      return error(res, 'Results already submitted', 400);
    }

    // Create result record
    const labResult = await LabResult.create({
      id: uuidv4(),
      lab_request_id: id,
      processed_by: req.user.id,
      results,
      result_data: result_data || null,
      attachments: attachments || null,
    });

    // Update request status
    await request.update({ status: 'completed' });

    // Notify requesting doctor via WebSocket
    notificationService.emitResultReady(request.requested_by, 'lab', {
      lab_request_id: id,
      test_type: request.test_type,
      visit_id: request.visit_id,
      message: `Lab results ready: ${request.test_type}`,
    });

    return created(res, labResult, 'Lab results submitted - doctor notified');
  } catch (err) {
    console.error('Submit results error:', err);
    return error(res, 'Failed to submit results', 500);
  }
};

// Get results for a visit (doctor view)
exports.getResultsByVisit = async (req, res) => {
  try {
    const requests = await LabRequest.findAll({
      where: { visit_id: req.params.visitId },
      include: [
        { association: 'result', include: [{ association: 'processedBy', attributes: ['id', 'first_name', 'last_name'] }] },
        { association: 'requestedBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
      order: [['created_at', 'DESC']],
    });

    return success(res, requests);
  } catch (err) {
    return error(res, 'Failed to fetch lab results', 500);
  }
};
