const { success, error } = require('../utils/response');
const { departmentForRole } = require('../config/hospitalOutpatientConfig');
const queueService = require('../services/queueService');
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
