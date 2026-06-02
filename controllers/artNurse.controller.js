const { v4: uuidv4 } = require('uuid');
const {
  Visit,
  Vital,
  ScreeningAssessment,
  HivTestResult,
  ArtEpisode,
  QueueEntry,
  sequelize,
} = require('../models');
const { success, error } = require('../utils/response');
const queueService = require('../services/queueService');
const { getIO } = require('../socket');
const {
  ART_NURSE_DEPARTMENT,
  PATHWAY_STATES,
  stateLabel,
  nextState,
  pathwayFlags,
  advanceReadiness,
  COUNSELING_MILESTONE_KEY,
} = require('../config/artPathway');

function serializeEpisode(episode) {
  const data = episode.pathway_data || {};
  const flags = pathwayFlags(episode.enrolled_at, episode.state_entered_at);
  const advance = advanceReadiness(episode.pathway_state, data);

  return {
    id: episode.id,
    patient_id: episode.patient_id,
    visit_id: episode.visit_id,
    pathway_state: episode.pathway_state,
    pathway_state_label: stateLabel(episode.pathway_state),
    state_entered_at: episode.state_entered_at,
    enrolled_at: episode.enrolled_at,
    status: episode.status,
    pathway_data: data,
    flags,
    can_advance: advance.ready,
    advance_block_reason: advance.ready ? null : advance.reason,
    next_pathway_state: advance.ready ? nextState(episode.pathway_state) : null,
    states: PATHWAY_STATES,
  };
}

async function findActiveEpisodeForVisit(visitId, transaction = null) {
  return ArtEpisode.findOne({
    where: { visit_id: visitId, status: 'active' },
    order: [['enrolled_at', 'DESC']],
    transaction,
  });
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
    const episode = await findActiveEpisodeForVisit(visitId);

    return success(res, {
      vitals: vital || null,
      screeningAssessment: screeningAssessment || null,
      hivTest: hivTest || null,
      episode: episode ? serializeEpisode(episode) : null,
    });
  } catch (err) {
    console.error('ART handover error:', err);
    return error(res, 'Failed to fetch ART handover', 500);
  }
};

exports.getEpisode = async (req, res) => {
  try {
    const episode = await findActiveEpisodeForVisit(req.params.visitId);
    if (!episode) return error(res, 'No active ART episode for this visit', 404);
    return success(res, serializeEpisode(episode));
  } catch (err) {
    return error(res, 'Failed to fetch ART episode', 500);
  }
};

exports.updatePathway = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { visit_id, queue_entry_id, section, data, advance } = req.body;

    if (!visit_id) {
      await t.rollback();
      return error(res, 'visit_id is required', 400);
    }

    const episode = await findActiveEpisodeForVisit(visit_id, t);
    if (!episode) {
      await t.rollback();
      return error(res, 'No active ART episode for this visit', 404);
    }

    if (queue_entry_id) {
      const queueEntry = await QueueEntry.findByPk(queue_entry_id, { transaction: t });
      if (!queueEntry || queueEntry.visit_id !== visit_id) {
        await t.rollback();
        return error(res, 'Invalid queue entry', 400);
      }
      if (queueEntry.department !== ART_NURSE_DEPARTMENT) {
        await t.rollback();
        return error(res, 'Queue entry is not for ART', 400);
      }
      if (queueEntry.status === 'in_progress' && queueEntry.assigned_to !== req.user.id) {
        await t.rollback();
        return error(res, 'You can only update patients assigned to you', 403);
      }
    }

    const pathwayData = { ...(episode.pathway_data || {}) };
    const now = new Date().toISOString();

    if (section === 'counseling' && episode.pathway_state === 'day_1') {
      if (!data?.completed) {
        await t.rollback();
        return error(res, 'Counseling milestone must be marked completed', 400);
      }
      pathwayData[COUNSELING_MILESTONE_KEY] = true;
      pathwayData.counseling_completed_at = now;
      pathwayData.counseling_notes = data.notes?.trim() || null;
    } else if (section === 'baseline_bloodwork' && episode.pathway_state === 'week_1') {
      pathwayData.baseline_bloodwork = {
        cd4_count: data.cd4_count ?? null,
        viral_load: data.viral_load?.trim() || null,
        kidney_liver_panel: data.kidney_liver_panel?.trim() || null,
        ordered_at: data.ordered_at || now,
        notes: data.notes?.trim() || null,
      };
    } else if (section === 'initial_prescription' && episode.pathway_state === 'week_1') {
      pathwayData.initial_prescription = {
        medication: data.medication?.trim() || 'TLD (Tenofovir/Lamivudine/Dolutegravir)',
        supply_days: Number(data.supply_days) || 30,
        dosage: data.dosage?.trim() || '1 tablet daily',
        prescribed_at: now,
        notes: data.notes?.trim() || null,
      };
    } else if (section === 'month_1_followup' && episode.pathway_state === 'month_1') {
      pathwayData.month_1_followup = {
        adherence_rate: data.adherence_rate ?? null,
        timing_hurdles: data.timing_hurdles?.trim() || null,
        side_effects: data.side_effects?.trim() || null,
        documented_at: now,
        notes: data.notes?.trim() || null,
      };
    } else if (section === 'suppression_check' && episode.pathway_state === 'month_3_6') {
      pathwayData.suppression_check = {
        followup_viral_load: data.followup_viral_load?.trim() || null,
        followup_date: data.followup_date || now,
        ordered_at: data.ordered_at || now,
        viral_suppression_confirmed: !!data.viral_suppression_confirmed,
        notes: data.notes?.trim() || null,
      };
    } else if (section === 'maintenance' && episode.pathway_state === 'maintenance') {
      pathwayData.maintenance = {
        monitoring_interval_months: Number(data.monitoring_interval_months) || 6,
        multi_month_dispense_months: Number(data.multi_month_dispense_months) || 3,
        last_review_at: now,
        notes: data.notes?.trim() || null,
      };
    } else {
      await t.rollback();
      return error(res, 'Invalid section for current pathway state', 400);
    }

    let newState = episode.pathway_state;
    let stateEnteredAt = episode.state_entered_at;

    if (advance) {
      const readiness = advanceReadiness(episode.pathway_state, pathwayData);
      if (!readiness.ready) {
        await t.rollback();
        return error(res, readiness.reason, 400);
      }
      const next = nextState(episode.pathway_state);
      if (!next) {
        await t.rollback();
        return error(res, 'Already at final pathway state', 400);
      }
      newState = next;
      stateEnteredAt = new Date();
    }

    await episode.update({
      pathway_data: pathwayData,
      pathway_state: newState,
      state_entered_at: stateEnteredAt,
    }, { transaction: t });

    await t.commit();
    return success(res, serializeEpisode(episode), advance ? 'Pathway advanced' : 'Pathway updated');
  } catch (err) {
    await t.rollback();
    console.error('ART pathway update error:', err);
    return error(res, err.message || 'Failed to update pathway', 500);
  }
};

exports.completeArtSession = async (req, res) => {
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
      return error(res, 'No active ART episode', 404);
    }

    if (episode.pathway_state !== 'maintenance') {
      await t.rollback();
      return error(res, 'Complete the treatment pathway before ending the ART queue session', 400);
    }

    const queueEntry = await QueueEntry.findByPk(queue_entry_id, { transaction: t });
    if (!queueEntry || queueEntry.visit_id !== visit_id || queueEntry.department !== ART_NURSE_DEPARTMENT) {
      await t.rollback();
      return error(res, 'Invalid ART queue entry', 400);
    }
    if (queueEntry.assigned_to !== req.user.id) {
      await t.rollback();
      return error(res, 'You can only complete patients assigned to you', 403);
    }

    const visit = await Visit.findByPk(visit_id, { transaction: t });
    await visit.update({
      status: 'completed',
      completed_at: new Date(),
      current_department: null,
      current_queue_position: null,
    }, { transaction: t });

    await queueService.completeEntry(queue_entry_id, {
      nextDepartment: null,
      pushed_by: req.user.id,
      notes: 'ART intake session complete — maintenance ongoing',
    }, t);

    await t.commit();

    const io = getIO();
    try {
      const entries = await queueService.getQueue(ART_NURSE_DEPARTMENT, req.user.facility_id);
      io.to(`room:${ART_NURSE_DEPARTMENT}`).emit('queue:refresh', { department: ART_NURSE_DEPARTMENT, entries });
    } catch (emitErr) {
      console.error('ART complete socket error:', emitErr.message);
    }

    return success(res, { episode: serializeEpisode(episode) }, 'ART session completed');
  } catch (err) {
    await t.rollback();
    console.error('ART complete session error:', err);
    return error(res, err.message || 'Failed to complete session', 500);
  }
};

exports.getPatientArtHistory = async (req, res) => {
  try {
    const episodes = await ArtEpisode.findAll({
      where: { patient_id: req.params.patientId },
      order: [['enrolled_at', 'DESC']],
      include: [
        { association: 'hivTestResult', required: false },
        { association: 'enrolledBy', attributes: ['id', 'first_name', 'last_name'] },
      ],
    });
    return success(res, episodes.map(serializeEpisode));
  } catch (err) {
    return error(res, 'Failed to fetch ART history', 500);
  }
};
