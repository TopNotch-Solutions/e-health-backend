const { TransportRequest, Visit, Patient, User } = require('../models');
const { Op } = require('sequelize');
const { success, error } = require('../utils/response');
const notificationService = require('../services/notificationService');

// Get transport queue (pending/in_transit)
exports.getQueue = async (req, res) => {
  try {
    const requests = await TransportRequest.findAll({
      where: { status: { [Op.in]: ['pending', 'in_transit'] } },
      include: [
        {
          association: 'visit',
          where: { facility_id: req.user.facility_id },
          include: [{ model: Patient, as: 'patient', attributes: ['id', 'first_name', 'last_name', 'patient_number'] }],
        },
        { association: 'porter', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'requestedBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
      order: [
        [require('sequelize').literal("FIELD(priority, 'emergency', 'urgent', 'normal')"), 'ASC'],
        ['requested_at', 'ASC'],
      ],
    });

    return success(res, requests);
  } catch (err) {
    console.error('Get transport queue error:', err);
    return error(res, 'Failed to fetch transport queue', 500);
  }
};

// Get single transport request
exports.getById = async (req, res) => {
  try {
    const request = await TransportRequest.findByPk(req.params.id, {
      include: [
        { association: 'visit', include: [{ model: Patient, as: 'patient' }] },
        { association: 'porter', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'requestedBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
    });
    if (!request) return error(res, 'Transport request not found', 404);
    return success(res, request);
  } catch (err) {
    return error(res, 'Failed to fetch transport request', 500);
  }
};

// Porter picks up (assign self and start transit)
exports.start = async (req, res) => {
  try {
    const request = await TransportRequest.findByPk(req.params.id);
    if (!request) return error(res, 'Transport request not found', 404);
    if (request.status !== 'pending') return error(res, 'Request is not pending', 400);

    await request.update({
      status: 'in_transit',
      assigned_porter: req.user.id,
      started_at: new Date(),
    });

    const io = require('../socket').getIO();
    io.to('room:porter').emit('transport:updated', {
      id: request.id,
      status: 'in_transit',
      assigned_porter: req.user.id,
    });

    return success(res, request, 'Transport started');
  } catch (err) {
    return error(res, 'Failed to start transport', 500);
  }
};

// Porter completes transport
exports.complete = async (req, res) => {
  try {
    const request = await TransportRequest.findByPk(req.params.id);
    if (!request) return error(res, 'Transport request not found', 404);
    if (request.status !== 'in_transit') return error(res, 'Request is not in transit', 400);

    await request.update({
      status: 'completed',
      completed_at: new Date(),
    });

    const io = require('../socket').getIO();
    io.to('room:porter').emit('transport:completed', { id: request.id });

    // Notify ward that patient has arrived
    notificationService.emitWardUpdate({
      type: 'patient_arrived',
      visit_id: request.visit_id,
      to_location: request.to_location,
    });

    return success(res, request, 'Transport completed - patient delivered');
  } catch (err) {
    return error(res, 'Failed to complete transport', 500);
  }
};

// Get completed transports (history)
exports.getHistory = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const requests = await TransportRequest.findAll({
      where: { status: 'completed' },
      include: [
        {
          association: 'visit',
          where: { facility_id: req.user.facility_id },
          include: [{ model: Patient, as: 'patient', attributes: ['id', 'first_name', 'last_name', 'patient_number'] }],
        },
        { association: 'porter', attributes: ['id', 'first_name', 'last_name'] },
      ],
      order: [['completed_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    return success(res, requests);
  } catch (err) {
    return error(res, 'Failed to fetch history', 500);
  }
};
