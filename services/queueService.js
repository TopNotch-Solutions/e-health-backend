const { v4: uuidv4 } = require('uuid');
const { QueueEntry, Visit, Patient, User, sequelize } = require('../models');
const { Op } = require('sequelize');

/**
 * Push a patient visit to a department queue.
 * Emergency patients get position 0 (top of queue).
 */
async function pushToQueue({ visit_id, department, priority = 'normal', pushed_by, notes = null }, transaction = null) {
  // Get next position in queue for this department
  let position;
  if (priority === 'emergency') {
    // Emergency goes to top - shift all others down
    await QueueEntry.increment('position', {
      by: 1,
      where: { department, status: 'waiting' },
      transaction,
    });
    position = 1;
  } else {
    const maxPos = await QueueEntry.max('position', {
      where: { department, status: { [Op.in]: ['waiting', 'in_progress'] } },
      transaction,
    });
    position = (maxPos || 0) + 1;
  }

  const entry = await QueueEntry.create({
    id: uuidv4(),
    visit_id,
    department,
    priority,
    status: 'waiting',
    position,
    pushed_by,
    notes,
  }, { transaction });

  // Update visit's current department
  await Visit.update(
    { current_department: department, current_queue_position: position },
    { where: { id: visit_id }, transaction }
  );

  return entry;
}

/**
 * Get current queue for a department with patient info.
 */
async function getQueue(department, facilityId) {
  const entries = await QueueEntry.findAll({
    where: {
      department,
      status: { [Op.in]: ['waiting', 'in_progress'] },
    },
    include: [
      {
        association: 'visit',
        where: { facility_id: facilityId },
        include: [
          { model: Patient, as: 'patient', attributes: ['id', 'first_name', 'last_name', 'patient_number', 'sex', 'category', 'payment_type', 'is_emergency', 'temp_id'] },
        ],
      },
    ],
    order: [
      [sequelize.literal("FIELD(priority, 'emergency', 'urgent', 'normal')"), 'ASC'],
      ['position', 'ASC'],
    ],
  });

  return entries;
}

/**
 * Start serving a patient (move from waiting to in_progress).
 */
async function startEntry(entryId, userId) {
  const entry = await QueueEntry.findByPk(entryId);
  if (!entry) throw new Error('Queue entry not found');
  if (entry.status !== 'waiting') throw new Error('Patient is not in waiting state');

  await entry.update({
    status: 'in_progress',
    assigned_to: userId,
    started_at: new Date(),
  });

  return entry;
}

/**
 * Complete a queue entry and optionally push to next department.
 */
async function completeEntry(entryId, { nextDepartment, nextPriority, notes, pushed_by }, transaction = null) {
  const t = transaction || await sequelize.transaction();
  try {
    const entry = await QueueEntry.findByPk(entryId, { transaction: t });
    if (!entry) throw new Error('Queue entry not found');

    await entry.update({
      status: 'completed',
      completed_at: new Date(),
    }, { transaction: t });

    let nextEntry = null;
    if (nextDepartment) {
      nextEntry = await pushToQueue({
        visit_id: entry.visit_id,
        department: nextDepartment,
        priority: nextPriority || 'normal',
        pushed_by,
        notes,
      }, t);
    }

    if (!transaction) await t.commit();
    return { completedEntry: entry, nextEntry };
  } catch (err) {
    if (!transaction) await t.rollback();
    throw err;
  }
}

/**
 * Skip a patient in queue.
 */
async function skipEntry(entryId, notes) {
  const entry = await QueueEntry.findByPk(entryId);
  if (!entry) throw new Error('Queue entry not found');

  await entry.update({
    status: 'skipped',
    completed_at: new Date(),
    notes: notes || 'Patient skipped',
  });

  return entry;
}

/**
 * Get queue stats for a department.
 */
async function getQueueStats(department, facilityId) {
  const waiting = await QueueEntry.count({
    where: { department, status: 'waiting' },
    include: [{ association: 'visit', where: { facility_id: facilityId }, attributes: [] }],
  });

  const inProgress = await QueueEntry.count({
    where: { department, status: 'in_progress' },
    include: [{ association: 'visit', where: { facility_id: facilityId }, attributes: [] }],
  });

  return { department, waiting, inProgress, total: waiting + inProgress };
}

module.exports = {
  pushToQueue,
  getQueue,
  startEntry,
  completeEntry,
  skipEntry,
  getQueueStats,
};
