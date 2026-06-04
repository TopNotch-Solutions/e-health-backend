const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const {
  Visit,
  Patient,
  Vital,
  ScreeningAssessment,
  DermatologyAssessment,
  SocialWorkerAssessment,
  Consultation,
  EmergencyIntervention,
  QueueEntry,
  Referral,
  MortuaryRecord,
  Facility,
  sequelize,
} = require('../models');
const { success, created, error } = require('../utils/response');
const queueService = require('../services/queueService');
const { getIO } = require('../socket');
const {
  BOOKING_ROOM_DEPARTMENT,
  isValidDisposition,
  dispositionLabel,
  isDermatologistBookingPathway,
  dispositionsForPathway,
  validateStateHospital,
  validateMortuary,
} = require('../config/bookingRoomRouting');

async function emitQueueRefresh(io, department, facilityId) {
  const entries = await queueService.getQueue(department, facilityId);
  io.to(`room:${department}`).emit('queue:refresh', { department, entries });
}

/** State hospital and health center facilities available for external transfer. */
exports.getStateHospitalFacilities = async (req, res) => {
  try {
    const where = {
      type: { [Op.in]: ['hospital', 'health_center'] },
    };
    if (req.user.facility_id) {
      where.id = { [Op.ne]: req.user.facility_id };
    }

    const facilities = await Facility.findAll({
      where,
      attributes: ['id', 'name', 'type', 'province', 'district', 'address'],
      order: [['name', 'ASC']],
    });

    const rows = facilities.map((f) => {
      const plain = f.toJSON();
      const location = [plain.district, plain.province].filter(Boolean).join(', ');
      return {
        ...plain,
        location: location || plain.province || null,
        label: location ? `${plain.name} — ${location}` : plain.name,
      };
    });

    return success(res, rows);
  } catch (err) {
    console.error('getStateHospitalFacilities error:', err);
    return error(res, 'Failed to fetch state hospital facilities', 500);
  }
};

exports.getHandover = async (req, res) => {
  try {
    const { visitId } = req.params;
    const visit = await Visit.findByPk(visitId, {
      include: [{ association: 'patient' }],
    });
    if (!visit) return error(res, 'Visit not found', 404);

    const [
      vital,
      screeningAssessment,
      consultation,
      interventions,
      dermatologyAssessment,
      socialWorkerAssessment,
      bookingEntry,
    ] = await Promise.all([
        Vital.findOne({ where: { visit_id: visitId } }),
        ScreeningAssessment.findOne({ where: { visit_id: visitId } }),
        Consultation.findOne({ where: { visit_id: visitId }, order: [['created_at', 'DESC']] }),
        EmergencyIntervention.findAll({
          where: { visit_id: visitId },
          order: [['created_at', 'DESC']],
          limit: 5,
        }),
        DermatologyAssessment.findOne({
          where: { visit_id: visitId },
          include: [{ association: 'assessedBy', attributes: ['id', 'first_name', 'last_name'] }],
        }),
        SocialWorkerAssessment.findOne({
          where: { visit_id: visitId, assessment_saved: true },
          include: [{ association: 'assessedBy', attributes: ['id', 'first_name', 'last_name'] }],
        }),
        QueueEntry.findOne({
          where: {
            visit_id: visitId,
            department: BOOKING_ROOM_DEPARTMENT,
            status: { [Op.in]: ['waiting', 'in_progress'] },
          },
          order: [['created_at', 'DESC']],
        }),
      ]);

    const pathwayRestricted = isDermatologistBookingPathway(bookingEntry?.notes);

    return success(res, {
      visit,
      patient: visit.patient,
      vitals: vital || null,
      screeningAssessment: screeningAssessment || null,
      consultation: consultation || null,
      dermatologyAssessment: dermatologyAssessment || null,
      socialWorkerAssessment: socialWorkerAssessment || null,
      interventions,
      pathwayRestricted,
      allowedDispositions: dispositionsForPathway(pathwayRestricted),
    });
  } catch (err) {
    return error(res, 'Failed to fetch handover', 500);
  }
};

exports.completeDisposition = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      visit_id,
      queue_entry_id,
      disposition,
      destination_facility_id,
      reason,
      notes,
      cause_of_death,
      date_of_death,
    } = req.body;

    if (!visit_id || !queue_entry_id || !disposition) {
      await t.rollback();
      return error(res, 'visit_id, queue_entry_id, and disposition are required', 400);
    }
    if (!isValidDisposition(disposition)) {
      await t.rollback();
      return error(res, 'Invalid disposition', 400);
    }

    const visit = await Visit.findByPk(visit_id, {
      include: [{ association: 'patient' }],
      transaction: t,
    });
    if (!visit) {
      await t.rollback();
      return error(res, 'Visit not found', 404);
    }

    const queueEntry = await QueueEntry.findByPk(queue_entry_id, { transaction: t });
    if (!queueEntry || queueEntry.visit_id !== visit_id || queueEntry.department !== BOOKING_ROOM_DEPARTMENT) {
      await t.rollback();
      return error(res, 'Invalid booking room queue entry', 400);
    }
    if (queueEntry.status !== 'in_progress') {
      await t.rollback();
      return error(res, 'Patient must be started before disposition', 400);
    }
    if (queueEntry.assigned_to !== req.user.id) {
      await t.rollback();
      return error(res, 'You can only process patients assigned to you', 403);
    }

    const pathwayRestricted = isDermatologistBookingPathway(queueEntry.notes);
    if (pathwayRestricted && disposition !== 'state_hospital') {
      await t.rollback();
      return error(res, 'Patients from the Dermatologist pathway may only be transferred to a state hospital', 400);
    }

    let mortuaryRecord = null;

    if (disposition === 'state_hospital') {
      const validationError = validateStateHospital({ destination_facility_id, reason });
      if (validationError) {
        await t.rollback();
        return error(res, validationError, 400);
      }

      const targetFacility = await Facility.findByPk(destination_facility_id, { transaction: t });
      if (
        !targetFacility
        || !['hospital', 'health_center'].includes(targetFacility.type)
      ) {
        await t.rollback();
        return error(res, 'Select a valid state hospital from the list', 400);
      }

      await Referral.create({
        id: uuidv4(),
        visit_id,
        referred_by: req.user.id,
        referral_type: 'external_facility',
        reason: reason.trim(),
        destination: targetFacility.name,
        status: 'pending',
      }, { transaction: t });

      await visit.update({
        status: 'completed',
        completed_at: new Date(),
        current_department: null,
        current_queue_position: null,
      }, { transaction: t });
    } else if (disposition === 'mortuary') {
      const validationError = validateMortuary({ cause_of_death, date_of_death });
      if (validationError) {
        await t.rollback();
        return error(res, validationError, 400);
      }

      mortuaryRecord = await MortuaryRecord.create({
        id: uuidv4(),
        patient_id: visit.patient_id,
        visit_id,
        cause_of_death: cause_of_death?.trim() || null,
        date_of_death,
        declared_by: req.user.id,
        notes: notes?.trim() || null,
      }, { transaction: t });

      await visit.update({
        status: 'deceased',
        completed_at: new Date(),
        current_department: null,
        current_queue_position: null,
      }, { transaction: t });
    }

    await queueService.completeEntry(queue_entry_id, {
      nextDepartment: null,
      pushed_by: req.user.id,
      notes: `Booking room — ${dispositionLabel(disposition)}`,
    }, t);

    await t.commit();

    const io = getIO();
    try {
      await emitQueueRefresh(io, BOOKING_ROOM_DEPARTMENT, req.user.facility_id);
      io.to(`room:booking_room`).emit('queue:patient_moved', {
        entryId: queue_entry_id,
        status: 'completed',
        department: BOOKING_ROOM_DEPARTMENT,
      });
    } catch (emitErr) {
      console.error('Booking room socket error:', emitErr.message);
    }

    return created(res, {
      disposition,
      mortuaryRecord,
      visitCompleted: true,
    }, disposition === 'mortuary'
      ? 'Patient processed to Mortuary'
      : 'Patient referred to state hospital');
  } catch (err) {
    await t.rollback();
    console.error('Booking room disposition error:', err);
    return error(res, err.message || 'Failed to complete disposition', 500);
  }
};
