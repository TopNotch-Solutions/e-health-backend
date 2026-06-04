const router = require('express').Router();
const familyPlanningSuiteController = require('../controllers/familyPlanningSuite.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

router.get(
  '/handover/:visitId',
  authorize('vitals', 'read'),
  familyPlanningSuiteController.getHandover
);

router.post(
  '/save-record',
  authorize('vitals', 'create'),
  auditMiddleware('vitals'),
  familyPlanningSuiteController.saveRecord
);

router.post(
  '/complete-session',
  authorize('vitals', 'update'),
  auditMiddleware('vitals'),
  familyPlanningSuiteController.completeSession
);

router.post(
  '/route-pharmacy',
  authorize('prescription', 'create'),
  auditMiddleware('prescription'),
  familyPlanningSuiteController.routeToPharmacy
);

module.exports = router;
