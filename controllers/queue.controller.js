const queueService = require('../services/queueService');
const { ALL_QUEUE_DEPARTMENTS } = require('../config/clinicQueueDepartments');
const { success, error } = require('../utils/response');
const { getIO } = require('../socket');

// Get queue for a department
exports.getQueue = async (req, res) => {
  try {
    const { department } = req.params;
    const entries = await queueService.getQueue(department, req.user.facility_id);
    return success(res, entries);
  } catch (err) {
    console.error('Get queue error:', err);
    return error(res, 'Failed to fetch queue', 500);
  }
};

// Push patient to a department queue
exports.push = async (req, res) => {
  try {
    const { visit_id, department, priority, notes } = req.body;

    if (!visit_id || !department) {
      return error(res, 'visit_id and department are required', 400);
    }

    const entry = await queueService.pushToQueue({
      visit_id,
      department,
      priority: priority || 'normal',
      pushed_by: req.user.id,
      notes,
    });

    const io = getIO();
    io.to(`room:${department}`).emit('queue:new_patient', { queueEntry: entry });

    return success(res, entry, 'Patient pushed to queue');
  } catch (err) {
    console.error('Push queue error:', err);
    const status = err.statusCode || (err.message?.includes('already in the') ? 409 : 500);
    return error(res, err.message || 'Failed to push to queue', status);
  }
};

// Start serving a patient
exports.start = async (req, res) => {
  try {
    const entry = await queueService.startEntry(req.params.id, req.user.id);

    const io = getIO();
    io.to(`room:${entry.department}`).emit('queue:patient_moved', {
      entryId: entry.id,
      status: 'in_progress',
      assignedTo: req.user.id,
    });

    return success(res, entry, 'Started serving patient');
  } catch (err) {
    const status = err.statusCode || 400;
    return error(res, err.message || 'Failed to start', status);
  }
};

// Complete a queue entry
exports.complete = async (req, res) => {
  try {
    const { nextDepartment, nextPriority, notes } = req.body;

    const result = await queueService.completeEntry(req.params.id, {
      nextDepartment,
      nextPriority,
      notes,
      pushed_by: req.user.id,
    });

    const io = getIO();
    io.to(`room:${result.completedEntry.department}`).emit('queue:patient_moved', {
      entryId: result.completedEntry.id,
      status: 'completed',
      department: result.completedEntry.department,
    });

    if (result.nextEntry) {
      io.to(`room:${nextDepartment}`).emit('queue:new_patient', {
        queueEntry: result.nextEntry,
      });
    }

    return success(res, result, 'Queue entry completed');
  } catch (err) {
    return error(res, err.message || 'Failed to complete', 400);
  }
};

// Skip a patient
exports.skip = async (req, res) => {
  try {
    const { notes } = req.body;
    const entry = await queueService.skipEntry(req.params.id, notes);

    const io = getIO();
    io.to(`room:${entry.department}`).emit('queue:patient_moved', {
      entryId: entry.id,
      status: 'skipped',
    });

    return success(res, entry, 'Patient skipped');
  } catch (err) {
    return error(res, err.message || 'Failed to skip', 400);
  }
};

// Release patient back to waiting queue (cancel active session)
exports.release = async (req, res) => {
  try {
    const entry = await queueService.releaseEntry(req.params.id, req.user.id);

    const io = getIO();
    const entries = await queueService.getQueue(entry.department, req.user.facility_id);
    io.to(`room:${entry.department}`).emit('queue:refresh', {
      department: entry.department,
      entries,
    });
    io.to(`room:${entry.department}`).emit('queue:patient_moved', {
      entryId: entry.id,
      status: 'waiting',
      department: entry.department,
    });

    return success(res, entry, 'Patient returned to queue');
  } catch (err) {
    return error(res, err.message || 'Failed to release patient', 400);
  }
};

// Get queue stats for all departments
exports.stats = async (req, res) => {
  try {
    const departments = ALL_QUEUE_DEPARTMENTS;
    const stats = await Promise.all(
      departments.map((dept) => queueService.getQueueStats(dept, req.user.facility_id))
    );
    return success(res, stats);
  } catch (err) {
    return error(res, 'Failed to get queue stats', 500);
  }
};
