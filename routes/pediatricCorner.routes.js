const router = require('express').Router();
const pediatricCornerController = require('../controllers/pediatricCorner.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

router.get(
  '/handover/:visitId',
  authorize('vitals', 'read'),
  pediatricCornerController.getHandover
);

router.post(
  '/route-master-doctor',
  authorize('vitals', 'update'),
  auditMiddleware('vitals'),
  pediatricCornerController.routeToMasterDoctor
);

module.exports = router;
