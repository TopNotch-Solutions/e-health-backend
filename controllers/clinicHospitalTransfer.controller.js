const { success, created, error } = require('../utils/response');
const {
  routingOptionsForPatient,
  departmentLabel,
  HOSPITAL_OUTPATIENT_DEPARTMENTS,
} = require('../config/hospitalOutpatientConfig');
const {
  getTransferForVisit,
  initiateTransportFromBooking,
  confirmClinicDeparture,
  confirmDepartmentReceipt,
  serializeTransferWithTimeline,
} = require('../services/clinicHospitalTransferService');
const { Visit, Patient, ClinicHospitalTransfer } = require('../models');
const { emitTransportSocketRefresh } = require('../config/porterRoles');
const { getIO } = require('../socket');

exports.getHospitalDepartments = async (req, res) => {
  try {
    const { visit_id, source_role } = req.query;
    let patient = null;
    if (visit_id) {
      const visit = await Visit.findByPk(visit_id, { include: [{ association: 'patient' }] });
      patient = visit?.patient;
    }
    const options = routingOptionsForPatient({
      dateOfBirth: patient?.date_of_birth,
      sourceRole: source_role || 'master_doctor',
    });
    return success(res, options);
  } catch (err) {
    return error(res, 'Failed to load hospital departments', 500);
  }
};

exports.getTransferByVisit = async (req, res) => {
  try {
    const transfer = await getTransferForVisit(req.params.visitId);
    return success(res, transfer);
  } catch (err) {
    return error(res, 'Failed to fetch transfer plan', 500);
  }
};

exports.initiateTransport = async (req, res) => {
  const t = await require('../models').sequelize.transaction();
  try {
    const { visit_id, transfer_id, hospital_facility_id, reason } = req.body;
    if (!visit_id || !hospital_facility_id) {
      await t.rollback();
      return error(res, 'visit_id and hospital_facility_id are required', 400);
    }

    let transfer = transfer_id
      ? await ClinicHospitalTransfer.findByPk(transfer_id, { transaction: t })
      : await ClinicHospitalTransfer.findOne({
        where: { visit_id },
        order: [['created_at', 'DESC']],
        transaction: t,
      });

    if (!transfer) {
      await t.rollback();
      return error(res, 'No hospital transfer plan found for this patient. The referring clinician must attach a destination first.', 400);
    }

    const result = await initiateTransportFromBooking({
      transferId: transfer.id,
      hospitalFacilityId: hospital_facility_id,
      initiatedBy: req.user.id,
      transferReason: reason,
      transaction: t,
    });

    await t.commit();

    try {
      const io = getIO();
      emitTransportSocketRefresh(io, 'external', 'transport:new_request', {
        transportRequest: result.externalTransport,
      });
      emitTransportSocketRefresh(io, 'external', 'transport:queue_refresh', { reason: 'booking_initiated' });
      io.to('room:booking_room').emit('transfer:updated', { visitId: visit_id, transfer: result.transfer });
    } catch (e) {
      /* ignore */
    }

    return created(res, result, 'Transport initiated — external porters and receiving department notified');
  } catch (err) {
    if (!t.finished) await t.rollback();
    return error(res, err.message || 'Failed to initiate transport', err.statusCode || 500);
  }
};

exports.confirmDeparture = async (req, res) => {
  try {
    const { transfer_id } = req.body;
    if (!transfer_id) return error(res, 'transfer_id is required', 400);

    const transfer = await confirmClinicDeparture({
      transferId: transfer_id,
      confirmedBy: req.user.id,
    });

    try {
      const io = getIO();
      io.to('room:booking_room').emit('transfer:updated', {
        transferId: transfer.id,
        transfer: serializeTransferWithTimeline(transfer),
      });
      io.to('room:internal_porter').emit('transfer:departed_clinic', { transferId: transfer.id });
      io.to('room:porter').emit('transfer:departed_clinic', { transferId: transfer.id });
    } catch (e) {
      /* ignore */
    }

    return success(res, serializeTransferWithTimeline(transfer), 'Patient departure confirmed from clinic');
  } catch (err) {
    return error(res, err.message || 'Failed to confirm departure', err.statusCode || 500);
  }
};

exports.confirmReceipt = async (req, res) => {
  try {
    const { transfer_id } = req.body;
    if (!transfer_id) return error(res, 'transfer_id is required', 400);

    const reloaded = await confirmDepartmentReceipt({
      transferId: transfer_id,
      receivedBy: req.user.id,
    });

    return success(
      res,
      serializeTransferWithTimeline(reloaded),
      `Patient received in ${departmentLabel(reloaded.destination_department)}`
    );
  } catch (err) {
    return error(res, err.message || 'Failed to confirm receipt', err.statusCode || 500);
  }
};
