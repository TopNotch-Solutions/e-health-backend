const router = require('express').Router();
const papSmearSuiteController = require('../controllers/papSmearSuite.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

router.get(
  '/handover/:visitId',
  authorize('vitals', 'read'),
  papSmearSuiteController.getHandover
);

router.post(
  '/save-screening',
  authorize('vitals', 'create'),
  auditMiddleware('vitals'),
  papSmearSuiteController.saveScreening
);

router.post(
  '/complete-session',
  authorize('vitals', 'update'),
  auditMiddleware('vitals'),
  papSmearSuiteController.completeSession
);

router.post(
  '/escalate-master-doctor',
  authorize('vitals', 'update'),
  auditMiddleware('vitals'),
  papSmearSuiteController.escalateToMasterDoctor
);

module.exports = router;
