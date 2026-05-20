const { TransportRequest, Visit, Patient } = require('../models');
const { Op } = require('sequelize');
const { success, error } = require('../utils/response');
const notificationService = require('../services/notificationService');
const { getIO } = require('../socket');

function priorityRank(p) {
  if (p === 'emergency') return 0;
  if (p === 'urgent') return 1;
  return 2;
}

async function assertTransportInFacility(transportId, facilityId) {
  const request = await TransportRequest.findByPk(transportId, {
    include: [
      {
        association: 'visit',
        where: { facility_id: facilityId },
        attributes: ['id', 'facility_id'],
        required: true,
      },
    ],
  });
  return request;
}

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
        { association: 'porter', attributes: ['id', 'first_name', 'last_name'], required: false },
        { association: 'requestedBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
      order: [['requested_at', 'ASC']],
    });

    requests.sort((a, b) => {
      const pr = priorityRank(a.priority) - priorityRank(b.priority);
      if (pr !== 0) return pr;
      return new Date(a.requested_at).getTime() - new Date(b.requested_at).getTime();
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
    const request = await assertTransportInFacility(req.params.id, req.user.facility_id);
    if (!request) return error(res, 'Transport request not found', 404);

    const full = await TransportRequest.findByPk(req.params.id, {
      include: [
        { association: 'visit', include: [{ model: Patient, as: 'patient' }] },
        { association: 'porter', attributes: ['id', 'first_name', 'last_name'], required: false },
        { association: 'requestedBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
    });

    return success(res, full);
  } catch (err) {
    return error(res, 'Failed to fetch transport request', 500);
  }
};

// Porter marks picked up (assign self and start transit)
exports.start = async (req, res) => {
  try {
    const scoped = await assertTransportInFacility(req.params.id, req.user.facility_id);
    if (!scoped) return error(res, 'Transport request not found', 404);

    const request = await TransportRequest.findByPk(req.params.id);
    if (!request) return error(res, 'Transport request not found', 404);
    if (request.status !== 'pending') return error(res, 'Request is not pending', 400);

    await request.update({
      status: 'in_transit',
      assigned_porter: req.user.id,
      started_at: new Date(),
    });

    const refreshed = await TransportRequest.findByPk(req.params.id, {
      include: [
        { association: 'visit', include: [{ model: Patient, as: 'patient' }] },
        { association: 'porter', attributes: ['id', 'first_name', 'last_name'], required: false },
        { association: 'requestedBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
    });

    const io = getIO();
    io.to('room:porter').emit('transport:updated', {
      id: request.id,
      status: 'in_transit',
      assigned_porter: req.user.id,
    });
    io.to('room:porter').emit('transport:queue_refresh', { reason: 'picked_up' });

    return success(res, refreshed, 'Marked as picked up — transport in progress');
  } catch (err) {
    return error(res, 'Failed to start transport', 500);
  }
};

// Porter marks delivered
exports.complete = async (req, res) => {
  try {
    const scoped = await assertTransportInFacility(req.params.id, req.user.facility_id);
    if (!scoped) return error(res, 'Transport request not found', 404);

    const request = await TransportRequest.findByPk(req.params.id);
    if (!request) return error(res, 'Transport request not found', 404);
    if (request.status !== 'in_transit') return error(res, 'Patient must be picked up before marking delivered', 400);

    await request.update({
      status: 'completed',
      completed_at: new Date(),
    });

    const refreshed = await TransportRequest.findByPk(req.params.id, {
      include: [
        { association: 'visit', include: [{ model: Patient, as: 'patient' }] },
        { association: 'porter', attributes: ['id', 'first_name', 'last_name'], required: false },
      ],
    });

    const io = getIO();
    io.to('room:porter').emit('transport:completed', { id: request.id });
    io.to('room:porter').emit('transport:queue_refresh', { reason: 'delivered' });

    notificationService.emitWardUpdate({
      type: 'patient_arrived',
      visit_id: request.visit_id,
      to_location: request.to_location,
    });

    return success(res, refreshed, 'Marked as delivered');
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
        { association: 'porter', attributes: ['id', 'first_name', 'last_name'], required: false },
      ],
      order: [['completed_at', 'DESC']],
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    return success(res, requests);
  } catch (err) {
    return error(res, 'Failed to fetch history', 500);
  }
};
