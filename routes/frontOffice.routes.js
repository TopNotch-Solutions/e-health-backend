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

module.exports = router;
