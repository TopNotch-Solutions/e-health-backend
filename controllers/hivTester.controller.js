const { v4: uuidv4 } = require('uuid');
const {
  Visit,
  Patient,
  QueueEntry,
  Vital,
  ScreeningAssessment,
  HivTestResult,
  ArtEpisode,
  sequelize,
} = require('../models');
const { success, created, error } = require('../utils/response');
const queueService = require('../services/queueService');
const { getIO } = require('../socket');
const { emitNurseActivity } = require('../services/notificationService');
const {
  HIV_TESTER_DEPARTMENT,
  ART_NURSE_DEPARTMENT,
  emptyPathwayData,
} = require('../config/artPathway');

async function emitQueueRefresh(io, department, facilityId) {
  const entries = await queueService.getQueue(department, facilityId);
  io.to(`room:${department}`).emit('queue:refresh', { department, entries });
}

exports.getHandover = async (req, res) => {
  try {
    const { visitId } = req.params;
    const vital = await Vital.findOne({
      where: { visit_id: visitId },
      include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
    });
    const screeningAssessment = await ScreeningAssessment.findOne({
      where: { visit_id: visitId },
      include: [{ association: 'recordedBy', attributes: ['id', 'first_name', 'last_name'] }],
    });
    const existingTest = await HivTestResult.findOne({
      where: { visit_id: visitId },
      include: [{ association: 'testedBy', attributes: ['id', 'first_name', 'last_name'] }],
    });

    return success(res, {
      vitals: vital || null,
      screeningAssessment: screeningAssessment || null,
      existingTest: existingTest || null,
    });
  } catch (err) {
    console.error('HIV tester handover error:', err);
    return error(res, 'Failed to fetch patient handover', 500);
  }
};

exports.submitTestResult = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      visit_id,
      queue_entry_id,
      result,
      test_method,
      kit_batch,
      notes,
    } = req.body;

    if (!visit_id || !queue_entry_id) {
      await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }
    if (!result || !['negative', 'positive'].includes(result)) {
      await t.rollback();
      return error(res, 'result must be negative or positive', 400);
    }

    const visit = await Visit.findByPk(visit_id, {
      include: [{
        association: 'patient',
        attributes: ['id', 'first_name', 'last_name', 'patient_number', 'is_emergency', 'temp_id'],
      }],
      transaction: t,
    });
    if (!visit) {
      await t.rollback();
      return error(res, 'Visit not found', 404);
    }

    const queueEntry = await QueueEntry.findByPk(queue_entry_id, { transaction: t });
    if (!queueEntry || queueEntry.visit_id !== visit_id) {
      await t.rollback();
      return error(res, 'Invalid queue entry for this visit', 400);
    }
    if (queueEntry.department !== HIV_TESTER_DEPARTMENT) {
      await t.rollback();
      return error(res, 'Queue entry is not for the HIV testing room', 400);
    }
    if (queueEntry.status !== 'in_progress') {
      await t.rollback();
      return error(res, 'Patient must be started before submitting test result', 400);
    }
    if (queueEntry.assigned_to !== req.user.id) {
      await t.rollback();
      return error(res, 'You can only process patients assigned to you', 403);
    }

    const priorTest = await HivTestResult.findOne({ where: { visit_id }, transaction: t });
    if (priorTest) {
      await t.rollback();
      return error(res, 'HIV test result already recorded for this visit', 409);
    }

    const testRecord = await HivTestResult.create({
      id: uuidv4(),
      visit_id,
      patient_id: visit.patient_id,
      result,
      tested_by: req.user.id,
      test_method: test_method?.trim() || null,
      kit_batch: kit_batch?.trim() || null,
      notes: notes?.trim() || null,
    }, { transaction: t });

    let artEpisode = null;
    let nextDepartment = null;

    if (result === 'positive') {
      nextDepartment = ART_NURSE_DEPARTMENT;
      artEpisode = await ArtEpisode.create({
        id: uuidv4(),
        patient_id: visit.patient_id,
        visit_id,
        hiv_test_result_id: testRecord.id,
        enrolled_by: req.user.id,
        pathway_state: 'day_1',
        state_entered_at: new Date(),
        enrolled_at: new Date(),
        status: 'active',
        pathway_data: emptyPathwayData(),
      }, { transaction: t });
    } else {
      await visit.update({
        status: 'completed',
        completed_at: new Date(),
        current_department: null,
        current_queue_position: null,
      }, { transaction: t });
    }

    const queueResult = await queueService.completeEntry(queue_entry_id, {
      nextDepartment,
      nextPriority:
        visit.visit_type === 'emergency' || visit.patient?.is_emergency
          ? 'emergency'
          : 'normal',
      notes: result === 'positive'
        ? 'HIV positive — escalated to ART'
        : 'HIV negative — testing session complete',
      pushed_by: req.user.id,
    }, t);

    await t.commit();

    const io = getIO();
    try {
      await emitQueueRefresh(io, HIV_TESTER_DEPARTMENT, req.user.facility_id);
      io.to(`room:${HIV_TESTER_DEPARTMENT}`).emit('queue:patient_moved', {
        entryId: queue_entry_id,
        status: 'completed',
        department: HIV_TESTER_DEPARTMENT,
      });

      if (queueResult.nextEntry && nextDepartment) {
        io.to(`room:${nextDepartment}`).emit('queue:new_patient', {
          queueEntry: queueResult.nextEntry,
          patient: visit.patient,
          visit: { id: visit.id, visit_number: visit.visit_number, visit_type: visit.visit_type },
        });
        await emitQueueRefresh(io, nextDepartment, req.user.facility_id);
      }
    } catch (emitErr) {
      console.error('HIV test submit socket emit error:', emitErr.message);
    }

    emitNurseActivity({
      visitId: visit_id,
      recordedBy: req.user.id,
      action: result === 'positive' ? 'hiv_test_positive' : 'hiv_test_negative',
    });

    return created(res, {
      testRecord,
      artEpisode,
      visitCompleted: result === 'negative',
      nextEntry: queueResult.nextEntry,
    }, result === 'positive'
      ? 'Positive result recorded — patient escalated to ART'
      : 'Negative result recorded — session ended and saved to history');
  } catch (err) {
    await t.rollback();
    console.error('HIV test submit error:', err);
    return error(res, err.message || 'Failed to submit test result', 500);
  }
};
