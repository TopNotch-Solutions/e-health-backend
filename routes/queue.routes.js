const router = require('express').Router();
const queueController = require('../controllers/queue.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

// Get queue stats for all departments
router.get('/stats', authorize('queue', 'read'), queueController.stats);

// Get queue for specific department
router.get('/:department', authorize('queue', 'read'), queueController.getQueue);

// Push patient to queue
router.post('/push', authorize('queue', 'push'), auditMiddleware('queue'), queueController.push);

// Start serving a patient
router.put('/:id/start', authorize('queue', 'update'), auditMiddleware('queue'), queueController.start);

// Complete queue entry (optionally push to next dept)
router.put('/:id/complete', authorize('queue', 'update'), auditMiddleware('queue'), queueController.complete);

// Skip a patient
router.put('/:id/skip', authorize('queue', 'update'), auditMiddleware('queue'), queueController.skip);

// Release back to waiting queue
router.put('/:id/release', authorize('queue', 'update'), auditMiddleware('queue'), queueController.release);

module.exports = router;
