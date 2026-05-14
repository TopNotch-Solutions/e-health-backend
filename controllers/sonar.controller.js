const { v4: uuidv4 } = require('uuid');
const { SonarRequest, SonarResult, Visit, Patient } = require('../models');
const { Op } = require('sequelize');
const { success, created, error } = require('../utils/response');
const notificationService = require('../services/notificationService');

// Get sonar queue (pending requests)
exports.getQueue = async (req, res) => {
  try {
    const requests = await SonarRequest.findAll({
      where: { status: { [Op.in]: ['pending', 'in_progress'] } },
      include: [
        {
          association: 'visit',
          where: { facility_id: req.user.facility_id },
          include: [{ model: Patient, as: 'patient', attributes: ['id', 'first_name', 'last_name', 'patient_number'] }],
        },
        { association: 'requestedBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
      order: [['created_at', 'ASC']],
    });

    return success(res, requests);
  } catch (err) {
    console.error('Get sonar queue error:', err);
    return error(res, 'Failed to fetch sonar queue', 500);
  }
};

// Get single sonar request with result
exports.getById = async (req, res) => {
  try {
    const request = await SonarRequest.findByPk(req.params.id, {
      include: [
        { association: 'visit', include: [{ model: Patient, as: 'patient' }] },
        { association: 'requestedBy', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'result', include: [{ association: 'performedBy', attributes: ['id', 'first_name', 'last_name'] }] },
      ],
    });

    if (!request) return error(res, 'Sonar request not found', 404);
    return success(res, request);
  } catch (err) {
    return error(res, 'Failed to fetch sonar request', 500);
  }
};

// Start scan (mark in_progress)
exports.startScan = async (req, res) => {
  try {
    const request = await SonarRequest.findByPk(req.params.id);
    if (!request) return error(res, 'Sonar request not found', 404);
    if (request.status !== 'pending') return error(res, 'Scan already started or completed', 400);

    await request.update({ status: 'in_progress' });
    return success(res, request, 'Scan started');
  } catch (err) {
    return error(res, 'Failed to start scan', 500);
  }
};

// Submit sonar results (with image file paths)
exports.submitResults = async (req, res) => {
  try {
    const { id } = req.params;
    const { findings, report, images } = req.body;

    const request = await SonarRequest.findByPk(id);
    if (!request) return error(res, 'Sonar request not found', 404);
    if (request.status === 'completed') return error(res, 'Results already submitted', 400);

    // Handle uploaded files if using multer
    let imagesPaths = images || null;
    if (req.files && req.files.length > 0) {
      imagesPaths = req.files.map(f => f.path);
    }

    const sonarResult = await SonarResult.create({
      id: uuidv4(),
      sonar_request_id: id,
      performed_by: req.user.id,
      findings: findings || null,
      images: imagesPaths,
      report: report || null,
    });

    await request.update({ status: 'completed' });

    // Notify requesting doctor
    notificationService.emitResultReady(request.requested_by, 'sonar', {
      sonar_request_id: id,
      scan_type: request.scan_type,
      visit_id: request.visit_id,
      message: `Sonar results ready: ${request.scan_type}`,
    });

    return created(res, sonarResult, 'Sonar results submitted - doctor notified');
  } catch (err) {
    console.error('Submit sonar results error:', err);
    return error(res, 'Failed to submit results', 500);
  }
};

// Get results for a visit
exports.getResultsByVisit = async (req, res) => {
  try {
    const requests = await SonarRequest.findAll({
      where: { visit_id: req.params.visitId },
      include: [
        { association: 'result', include: [{ association: 'performedBy', attributes: ['id', 'first_name', 'last_name'] }] },
        { association: 'requestedBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
      order: [['created_at', 'DESC']],
    });

    return success(res, requests);
  } catch (err) {
    return error(res, 'Failed to fetch sonar results', 500);
  }
};
