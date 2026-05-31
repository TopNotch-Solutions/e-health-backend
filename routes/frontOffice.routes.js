const router = require('express').Router();
const frontOfficeController = require('../controllers/frontOffice.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

router.use(authenticate);

router.get(
  '/supervisor-metrics',
  authorize('analytics', 'read'),
  frontOfficeController.getSupervisorMetrics
);

router.get(
  '/routing-options',
  authorize('patient', 'read'),
  frontOfficeController.getRoutingOptions
);

router.get(
  '/my-registrations',
  authorize('patient', 'read'),
  frontOfficeController.getMyRegistrations
);

module.exports = router;
