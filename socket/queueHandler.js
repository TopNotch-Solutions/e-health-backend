const queueService = require('../services/queueService');

/**
 * Socket.io handler for queue-related events.
 */
function registerQueueHandlers(io, socket) {
  // Client requests queue refresh for a department
  socket.on('queue:request_refresh', async (department) => {
    try {
      const entries = await queueService.getQueue(department, socket.facilityId);
      socket.emit('queue:refresh', { department, entries });
    } catch (err) {
      socket.emit('error', { message: 'Failed to refresh queue' });
    }
  });

  // Client requests stats
  socket.on('queue:request_stats', async () => {
    try {
      const departments = ['nurse', 'doctor', 'pharmacy', 'lab', 'sonar', 'billing', 'transport'];
      const stats = await Promise.all(
        departments.map((dept) => queueService.getQueueStats(dept, socket.facilityId))
      );
      socket.emit('queue:stats', stats);
    } catch (err) {
      socket.emit('error', { message: 'Failed to get stats' });
    }
  });
}

module.exports = { registerQueueHandlers };
