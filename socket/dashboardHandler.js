const { Visit, QueueEntry, Patient, Admission, Bed } = require('../models');
const { Op } = require('sequelize');

/**
 * Socket.io handler for admin dashboard stats.
 * Broadcasts live stats every 5 seconds to admin room.
 */
function startDashboardBroadcast(io) {
  setInterval(async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [
        totalPatientsToday,
        activeVisits,
        emergencyCount,
        queueWaiting,
        admittedCount,
      ] = await Promise.all([
        Visit.count({ where: { created_at: { [Op.gte]: today } } }),
        Visit.count({ where: { status: 'in_progress' } }),
        Visit.count({ where: { visit_type: 'emergency', created_at: { [Op.gte]: today } } }),
        QueueEntry.count({ where: { status: 'waiting' } }),
        Admission.count({ where: { status: 'admitted' } }),
      ]);

      const stats = {
        totalPatientsToday,
        activeVisits,
        emergencyCount,
        queueWaiting,
        admittedCount,
        timestamp: new Date().toISOString(),
      };

      io.to('room:admin_dashboard').emit('dashboard:live_stats', stats);
    } catch (err) {
      // Silent fail - dashboard stats are non-critical
    }
  }, 5000);
}

module.exports = { startDashboardBroadcast };
