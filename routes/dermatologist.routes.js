const router = require('express').Router();
const dermatologistController = require('../controllers/dermatologist.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

router.get(
  '/handover/:visitId',
  authorize('consultation', 'read'),
  dermatologistController.getHandover
);

router.post(
  '/save-observations',
  authorize('consultation', 'create'),
  auditMiddleware('consultation'),
  dermatologistController.saveObservations
);

router.post(
  '/complete-session',
  authorize('consultation', 'update'),
  auditMiddleware('consultation'),
  dermatologistController.completeSession
);

router.post(
  '/route-to-pharmacy',
  authorize('prescription', 'create'),
  auditMiddleware('prescription'),
  dermatologistController.routeToPharmacy
);

router.post(
  '/route-to-booking',
  authorize('consultation', 'update'),
  auditMiddleware('consultation'),
  dermatologistController.routeToBookingRoom
);

module.exports = router;
