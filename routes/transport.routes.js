const router = require('express').Router();
const transportController = require('../controllers/transport.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

// Get transport queue (Kanban: pending + in_transit)
router.get('/queue', authorize('transport', 'read'), transportController.getQueue);

// Get completed history
router.get('/history', authorize('transport', 'read'), transportController.getHistory);

// Get single transport request
router.get('/:id', authorize('transport', 'read'), transportController.getById);

// Porter picks up (start transit)
router.put('/:id/start', authorize('transport', 'update'), auditMiddleware('transport'), transportController.start);

// Porter completes transport
router.put('/:id/complete', authorize('transport', 'update'), auditMiddleware('transport'), transportController.complete);

module.exports = router;
