const { v4: uuidv4 } = require('uuid');
const {
  Visit,
  Vital,
  ScreeningAssessment,
  HivTestResult,
  PrepEpisode,
  QueueEntry,
  Referral,
  sequelize,
} = require('../models');
const { success, created, error } = require('../utils/response');
const queueService = require('../services/queueService');
const { getIO } = require('../socket');
const { emitNurseActivity } = require('../services/notificationService');
const {
  PREP_DEPARTMENT,
  DEFAULT_INJECTION,
  emptySessionData,
} = require('../config/prepSuite');

async function emitQueueRefresh(io, department, facilityId) {
  const entries = await queueService.getQueue(department, facilityId);
  io.to(`room:${department}`).emit('queue:refresh', { department, entries });
}

function serializeEpisode(episode) {
  const data = episode.session_data || {};
  return {
    id: episode.id,
    patient_id: episode.patient_id,
    visit_id: episode.visit_id,
    status: episode.status,
    injection_administered: episode.injection_administered,
    injection_administered_at: episode.injection_administered_at,
    enrolled_at: episode.enrolled_at,
    completed_at: episode.completed_at,
    session_data: data,
    can_finalize: episode.injection_administered && episode.status === 'active',
  };
}

function serializeHivTestForHandover(hivTest) {
  if (!hivTest) return null;
  const plain = hivTest.toJSON ? hivTest.toJSON() : hivTest;
  const tester = plain.testedBy || plain.tested_by_user || null;
  const submittedByName = tester
    ? [tester.first_name, tester.last_name].filter(Boolean).join(' ').trim() || null
    : null;

  return {
    ...plain,
    submittedByName,
    testedBy: tester,
  };
}

async function findActiveEpisodeForVisit(visitId, transaction = null) {
  return PrepEpisode.findOne({
    where: { visit_id: visitId, status: 'active' },
    order: [['enrolled_at', 'DESC']],
    transaction,
  });
}

async function ensurePrepEpisode(visitId, userId, transaction) {
  let episode = await findActiveEpisodeForVisit(visitId, transaction);
  if (episode) return episode;

  const visit = await Visit.findByPk(visitId, { transaction });
  if (!visit) return null;

  const hivTest = await HivTestResult.findOne({ where: { visit_id: visitId }, transaction });

  episode = await PrepEpisode.create({
    id: uuidv4(),
    patient_id: visit.patient_id,
    visit_id: visitId,
    hiv_test_result_id: hivTest?.id || null,
    enrolled_by: userId,
    status: 'active',
    injection_administered: false,
    session_data: emptySessionData(),
    enrolled_at: new Date(),
  }, { transaction });

  return episode;
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
    const hivTest = await HivTestResult.findOne({
      where: { visit_id: visitId },
      include: [{ association: 'testedBy', attributes: ['id', 'first_name', 'last_name'] }],
    });
    const referrals = await Referral.findAll({
      where: { visit_id: visitId },
      include: [{ association: 'referredBy', attributes: ['id', 'first_name', 'last_name'] }],
      order: [['created_at', 'DESC']],
    });
    const episode = await findActiveEpisodeForVisit(visitId);

    return success(res, {
      vitals: vital || null,
      screeningAssessment: screeningAssessment || null,
      hivTest: serializeHivTestForHandover(hivTest),
      referrals,
      episode: episode ? serializeEpisode(episode) : null,
    });
  } catch (err) {
    console.error('PrEP suite handover error:', err);
    return error(res, 'Failed to fetch patient handover', 500);
  }
};

exports.recordInjection = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      visit_id,
      queue_entry_id,
      medication,
      injection_site,
      lot_number,
      notes,
      counseling_notes,
    } = req.body;

    if (!visit_id || !queue_entry_id) {
      await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }

    const queueEntry = await QueueEntry.findByPk(queue_entry_id, { transaction: t });
    if (!queueEntry || queueEntry.visit_id !== visit_id) {
      await t.rollback();
      return error(res, 'Invalid queue entry for this visit', 400);
    }
    if (queueEntry.department !== PREP_DEPARTMENT) {
      await t.rollback();
      return error(res, 'Queue entry is not for the PrEP suite', 400);
    }
    if (queueEntry.status !== 'in_progress') {
      await t.rollback();
      return error(res, 'Patient must be started before recording injection', 400);
    }
    if (queueEntry.assigned_to !== req.user.id) {
      await t.rollback();
      return error(res, 'You can only process patients assigned to you', 403);
    }

    let episode = await findActiveEpisodeForVisit(visit_id, t);
    if (!episode) {
      episode = await ensurePrepEpisode(visit_id, req.user.id, t);
    }
    if (!episode) {
      await t.rollback();
      return error(res, 'Visit not found', 404);
    }
    if (episode.injection_administered) {
      await t.rollback();
      return error(res, 'PrEP injection already recorded for this visit', 409);
    }

    const now = new Date();
    const sessionData = {
      ...(episode.session_data || emptySessionData()),
      injection: {
        medication: medication?.trim() || DEFAULT_INJECTION.medication,
        injection_site: injection_site?.trim() || DEFAULT_INJECTION.injection_site,
        lot_number: lot_number?.trim() || null,
        notes: notes?.trim() || null,
        administered_at: now.toISOString(),
      },
      counseling_notes: counseling_notes?.trim() || null,
    };

    await episode.update({
      injection_administered: true,
      injection_administered_at: now,
      administered_by: req.user.id,
      session_data: sessionData,
    }, { transaction: t });

    await t.commit();

    emitNurseActivity({
      visitId: visit_id,
      recordedBy: req.user.id,
      action: 'prep_injection_administered',
    });

    return created(res, { episode: serializeEpisode(episode) }, 'PrEP injection recorded');
  } catch (err) {
    await t.rollback();
    console.error('PrEP injection record error:', err);
    return error(res, err.message || 'Failed to record injection', 500);
  }
};

exports.completePrepSession = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, queue_entry_id } = req.body;

    if (!visit_id || !queue_entry_id) {
      await t.rollback();
      return error(res, 'visit_id and queue_entry_id are required', 400);
    }

    const episode = await findActiveEpisodeForVisit(visit_id, t);
    if (!episode) {
      await t.rollback();
      return error(res, 'No active PrEP session for this visit', 404);
    }
    if (!episode.injection_administered) {
      await t.rollback();
      return error(res, 'Record and confirm PrEP injection before finalizing the session', 400);
    }

    const queueEntry = await QueueEntry.findByPk(queue_entry_id, { transaction: t });
    if (!queueEntry || queueEntry.visit_id !== visit_id || queueEntry.department !== PREP_DEPARTMENT) {
      await t.rollback();
      return error(res, 'Invalid PrEP suite queue entry', 400);
    }
    if (queueEntry.assigned_to !== req.user.id) {
      await t.rollback();
      return error(res, 'You can only finalize patients assigned to you', 403);
    }

    const visit = await Visit.findByPk(visit_id, { transaction: t });
    const completedAt = new Date();

    await episode.update({
      status: 'completed',
      completed_at: completedAt,
    }, { transaction: t });

    await visit.update({
      status: 'completed',
      completed_at: completedAt,
      current_department: null,
      current_queue_position: null,
    }, { transaction: t });

    await queueService.completeEntry(queue_entry_id, {
      nextDepartment: null,
      pushed_by: req.user.id,
      notes: 'PrEP injection administered — consultation finalized',
    }, t);

    await t.commit();

    const io = getIO();
    try {
      await emitQueueRefresh(io, PREP_DEPARTMENT, req.user.facility_id);
      io.to(`room:${PREP_DEPARTMENT}`).emit('queue:patient_moved', {
        entryId: queue_entry_id,
        status: 'completed',
        department: PREP_DEPARTMENT,
      });
    } catch (emitErr) {
      console.error('PrEP complete socket error:', emitErr.message);
    }

    emitNurseActivity({
      visitId: visit_id,
      recordedBy: req.user.id,
      action: 'prep_session_finalized',
    });

    return success(res, { episode: serializeEpisode(episode) }, 'PrEP session finalized and saved to patient record');
  } catch (err) {
    await t.rollback();
    console.error('PrEP complete session error:', err);
    return error(res, err.message || 'Failed to finalize session', 500);
  }
};

exports.getPatientPrepHistory = async (req, res) => {
  try {
    const episodes = await PrepEpisode.findAll({
      where: { patient_id: req.params.patientId },
      order: [['enrolled_at', 'DESC']],
      include: [
        { association: 'hivTestResult', required: false },
        { association: 'enrolledBy', attributes: ['id', 'first_name', 'last_name'] },
        { association: 'administeredBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
    });
    return success(res, episodes.map(serializeEpisode));
  } catch (err) {
    return error(res, 'Failed to fetch PrEP history', 500);
  }
};
