const router = require('express').Router();
const emergencyUnitController = require('../controllers/emergencyUnit.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

router.get(
  '/nurse/handover/:visitId',
  authorize('vitals', 'read'),
  emergencyUnitController.getNurseHandover
);

router.post(
  '/nurse/submit',
  authorize('vitals', 'create'),
  auditMiddleware('vitals'),
  emergencyUnitController.nurseSubmitAndRoute
);

router.get(
  '/doctor/handover/:visitId',
  authorize('consultation', 'read'),
  emergencyUnitController.getDoctorHandover
);

router.post(
  '/doctor/booking-room',
  authorize('consultation', 'create'),
  auditMiddleware('consultation'),
  emergencyUnitController.doctorTransferBookingRoom
);

router.post(
  '/doctor/pharmacy',
  authorize('consultation', 'create'),
  auditMiddleware('consultation'),
  emergencyUnitController.doctorPrescribePharmacy
);

router.post(
  '/doctor/discharge',
  authorize('consultation', 'update'),
  auditMiddleware('consultation'),
  emergencyUnitController.doctorDischargePatient
);

module.exports = router;
