const { v4: uuidv4 } = require('uuid');
const { TransportRequest, Visit, Patient, Facility } = require('../models');
const { Op } = require('sequelize');
const { success, created, error } = require('../utils/response');
const notificationService = require('../services/notificationService');
const {
  onExternalTransportStarted,
  onExternalTransportCompleted,
  onInternalTransportStarted,
  onInternalTransportCompleted,
} = require('../services/clinicHospitalTransferService');
const { getIO } = require('../socket');
const { isHospitalFacility } = require('../config/clinicRoles');
const {
  transportScopeForRole,
  assertRoleMatchesTransportScope,
  emitTransportSocketRefresh,
} = require('../config/porterRoles');

function priorityRank(p) {
  if (p === 'emergency') return 0;
  if (p === 'urgent') return 1;
  return 2;
}

function scopeForRequestUser(req) {
  const scope = transportScopeForRole(req.user?.role?.name);
  if (scope) return scope;
  if (req.query?.scope === 'external' || req.query?.scope === 'internal') {
    return req.query.scope;
  }
  return 'internal';
}

async function assertTransportInFacility(transportId, facilityId) {
  return TransportRequest.findOne({
    where: { id: transportId, facility_id: facilityId },
  });
}

function mapTransportRow(req) {
  return req;
}

// Get transport queue (pending/in_transit) for the caller's porter type
exports.getQueue = async (req, res) => {
  try {
    const scope = scopeForRequestUser(req);
    const facility = await Facility.findByPk(req.user.facility_id);
    if (!facility) return error(res, 'Facility context required', 400);

    const where = {
      status: { [Op.in]: ['pending', 'in_transit'] },
      transport_scope: scope,
      facility_id: req.user.facility_id,
    };

    const requests = await TransportRequest.findAll({
      where,
      include: [
        {
          association: 'visit',
          required: false,
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

    return success(res, requests.map(mapTransportRow));
  } catch (err) {
    console.error('Get transport queue error:', err);
    return error(res, 'Failed to fetch transport queue', 500);
  }
};

exports.createExternal = async (req, res) => {
  try {
    const facility = await Facility.findByPk(req.user.facility_id);
    if (!facility || !isHospitalFacility(facility)) {
      return error(res, 'External ambulance pickups are only configured for state hospitals', 400);
    }

    const {
      origin_facility_name,
      origin_address,
      external_patient_name,
      external_patient_phone,
      to_location,
      priority,
      equipment_required,
      equipment_notes,
      critical_notes,
      visit_id,
    } = req.body || {};

    if (!origin_facility_name?.trim()) {
      return error(res, 'origin_facility_name is required (referring clinic or hospital)', 400);
    }
    if (!to_location?.trim()) {
      return error(res, 'to_location is required (hospital destination)', 400);
    }
    if (!visit_id && !external_patient_name?.trim()) {
      return error(res, 'external_patient_name is required when no visit is linked', 400);
    }

    let visit = null;
    if (visit_id) {
      visit = await Visit.findByPk(visit_id, {
        include: [{ model: Patient, as: 'patient' }],
      });
      if (!visit || visit.facility_id !== req.user.facility_id) {
        return error(res, 'Visit not found at this hospital', 404);
      }
    }

    const request = await TransportRequest.create({
      id: uuidv4(),
      visit_id: visit?.id || null,
      facility_id: req.user.facility_id,
      transport_scope: 'external',
      origin_facility_name: origin_facility_name.trim(),
      origin_address: origin_address?.trim() || null,
      external_patient_name: external_patient_name?.trim() || null,
      external_patient_phone: external_patient_phone?.trim() || null,
      from_location: [
        origin_facility_name.trim(),
        origin_address?.trim() || null,
      ].filter(Boolean).join(' — '),
      to_location: to_location.trim(),
      equipment_required: equipment_required || 'stretcher',
      equipment_notes: equipment_notes?.trim() || null,
      critical_notes: critical_notes?.trim() || null,
      priority: priority || 'normal',
      requested_by: req.user.id,
    });

    const refreshed = await TransportRequest.findByPk(request.id, {
      include: [
        { association: 'visit', required: false, include: [{ model: Patient, as: 'patient' }] },
        { association: 'requestedBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
    });

    try {
      const io = getIO();
      emitTransportSocketRefresh(io, 'external', 'transport:new_request', { transportRequest: refreshed });
      emitTransportSocketRefresh(io, 'external', 'transport:queue_refresh', { reason: 'new_external_request' });
    } catch (e) {
      /* ignore */
    }

    return created(res, refreshed, 'External ambulance pickup requested');
  } catch (err) {
    console.error('Create external transport error:', err);
    return error(res, err.message || 'Failed to create external transport request', 500);
  }
};

exports.getById = async (req, res) => {
  try {
    const request = await assertTransportInFacility(req.params.id, req.user.facility_id);
    if (!request) return error(res, 'Transport request not found', 404);

    const full = await TransportRequest.findByPk(req.params.id, {
      include: [
        { association: 'visit', required: false, include: [{ model: Patient, as: 'patient' }] },
        { association: 'porter', attributes: ['id', 'first_name', 'last_name'], required: false },
        { association: 'requestedBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
    });

    return success(res, full);
  } catch (err) {
    return error(res, 'Failed to fetch transport request', 500);
  }
};

exports.start = async (req, res) => {
  try {
    const scoped = await assertTransportInFacility(req.params.id, req.user.facility_id);
    if (!scoped) return error(res, 'Transport request not found', 404);

    const request = await TransportRequest.findByPk(req.params.id);
    if (!request) return error(res, 'Transport request not found', 404);
    if (request.status !== 'pending') return error(res, 'Request is not pending', 400);

    assertRoleMatchesTransportScope(req.user?.role?.name, request.transport_scope);

    await request.update({
      status: 'in_transit',
      assigned_porter: req.user.id,
      started_at: new Date(),
    });

    const refreshed = await TransportRequest.findByPk(req.params.id, {
      include: [
        { association: 'visit', required: false, include: [{ model: Patient, as: 'patient' }] },
        { association: 'porter', attributes: ['id', 'first_name', 'last_name'], required: false },
        { association: 'requestedBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
    });

    try {
      const io = getIO();
      emitTransportSocketRefresh(io, request.transport_scope, 'transport:updated', {
        id: request.id,
        status: 'in_transit',
        assigned_porter: req.user.id,
      });
      emitTransportSocketRefresh(io, request.transport_scope, 'transport:queue_refresh', { reason: 'picked_up' });
      if (request.clinic_hospital_transfer_id && request.transport_scope === 'external') {
        await onExternalTransportStarted(request.clinic_hospital_transfer_id, req.user.id);
      }
      if (request.clinic_hospital_transfer_id && request.transport_scope === 'internal') {
        await onInternalTransportStarted(request.clinic_hospital_transfer_id, req.user.id);
      }
    } catch (e) {
      /* ignore */
    }

    return success(res, refreshed, 'Marked as picked up — transport in progress');
  } catch (err) {
    return error(res, err.message || 'Failed to start transport', err.statusCode || 500);
  }
};

exports.complete = async (req, res) => {
  try {
    const scoped = await assertTransportInFacility(req.params.id, req.user.facility_id);
    if (!scoped) return error(res, 'Transport request not found', 404);

    const request = await TransportRequest.findByPk(req.params.id);
    if (!request) return error(res, 'Transport request not found', 404);
    if (request.status !== 'in_transit') {
      return error(res, 'Patient must be picked up before marking delivered', 400);
    }

    assertRoleMatchesTransportScope(req.user?.role?.name, request.transport_scope);

    await request.update({
      status: 'completed',
      completed_at: new Date(),
    });

    const refreshed = await TransportRequest.findByPk(req.params.id, {
      include: [
        { association: 'visit', required: false, include: [{ model: Patient, as: 'patient' }] },
        { association: 'porter', attributes: ['id', 'first_name', 'last_name'], required: false },
      ],
    });

    try {
      const io = getIO();
      emitTransportSocketRefresh(io, request.transport_scope, 'transport:completed', { id: request.id });
      emitTransportSocketRefresh(io, request.transport_scope, 'transport:queue_refresh', { reason: 'delivered' });
      if (request.clinic_hospital_transfer_id && request.transport_scope === 'external') {
        await onExternalTransportCompleted(request.clinic_hospital_transfer_id);
      }
      if (request.clinic_hospital_transfer_id && request.transport_scope === 'internal') {
        await onInternalTransportCompleted(request.clinic_hospital_transfer_id);
      }
    } catch (e) {
      /* ignore */
    }

    if (request.visit_id) {
      notificationService.emitWardUpdate({
        type: 'patient_arrived',
        visit_id: request.visit_id,
        to_location: request.to_location,
      });
    }

    return success(res, refreshed, 'Marked as delivered');
  } catch (err) {
    return error(res, err.message || 'Failed to complete transport', err.statusCode || 500);
  }
};

exports.getHistory = async (req, res) => {
  try {
    const scope = scopeForRequestUser(req);
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const requests = await TransportRequest.findAll({
      where: {
        status: 'completed',
        transport_scope: scope,
        facility_id: req.user.facility_id,
      },
      include: [
        {
          association: 'visit',
          required: false,
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
