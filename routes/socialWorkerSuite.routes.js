const router = require('express').Router();
const socialWorkerSuiteController = require('../controllers/socialWorkerSuite.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

router.get(
  '/handover/:visitId',
  authorize('vitals', 'read'),
  socialWorkerSuiteController.getHandover
);

router.post(
  '/save-assessment',
  authorize('vitals', 'create'),
  auditMiddleware('vitals'),
  socialWorkerSuiteController.saveAssessment
);

router.post(
  '/complete-session',
  authorize('vitals', 'update'),
  auditMiddleware('vitals'),
  socialWorkerSuiteController.completeSession
);

router.post(
  '/escalate-booking-room',
  authorize('vitals', 'update'),
  auditMiddleware('vitals'),
  socialWorkerSuiteController.escalateToBookingRoom
);

module.exports = router;
