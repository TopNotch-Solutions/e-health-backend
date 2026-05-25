const router = require('express').Router();
const revenueController = require('../controllers/revenue.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

router.get('/dashboard', authorize('revenue', 'read'), revenueController.getDashboard);
router.get('/transactions', authorize('revenue', 'read'), revenueController.getTransactions);
router.get('/shifts', authorize('revenue', 'read'), revenueController.getShifts);
router.get('/shifts/mine', authorize('billing', 'read'), revenueController.getMyShift);
router.get('/shifts/:id', authorize('revenue', 'read'), revenueController.getShift);
router.put(
  '/shifts/:id/reconcile',
  authorize('revenue', 'update'),
  auditMiddleware('revenue'),
  revenueController.reconcileShift
);

module.exports = router;
