const router = require('express').Router();
const bookingRoomController = require('../controllers/bookingRoom.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

router.get(
  '/state-hospitals',
  authorize('patient', 'read'),
  bookingRoomController.getStateHospitalFacilities
);

router.get(
  '/handover/:visitId',
  authorize('patient', 'read'),
  bookingRoomController.getHandover
);

router.post(
  '/disposition',
  authorize('patient', 'update'),
  auditMiddleware('patient'),
  bookingRoomController.completeDisposition
);

module.exports = router;
