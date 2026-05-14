const router = require('express').Router();
const revenueController = require('../controllers/revenue.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

// Revenue dashboard stats
router.get('/dashboard', authorize('revenue', 'read'), revenueController.getDashboard);

// Get all shifts
router.get('/shifts', authorize('revenue', 'read'), revenueController.getShifts);

// Get my current open shift (billing clerk)
router.get('/shifts/mine', authorize('billing', 'read'), revenueController.getMyShift);

// Open a shift (billing clerk)
router.post('/shifts/open', authorize('billing', 'create'), auditMiddleware('revenue'), revenueController.openShift);

// Close shift (billing clerk submits collected amount)
router.put('/shifts/:id/close', authorize('billing', 'update'), auditMiddleware('revenue'), revenueController.closeShift);

// Reconcile shift (revenue officer)
router.put('/shifts/:id/reconcile', authorize('revenue', 'update'), auditMiddleware('revenue'), revenueController.reconcileShift);

module.exports = router;
