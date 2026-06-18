const router = require('express').Router();
const doctorController = require('../controllers/doctor.controller');
const clinicalSupervisorController = require('../controllers/clinicalSupervisor.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

router.get(
  '/supervisor-metrics',
  authorize('analytics', 'read'),
  clinicalSupervisorController.getDoctorSupervisorMetrics
);

// Consultations
router.post('/', authorize('consultation', 'create'), auditMiddleware('consultation'), doctorController.createConsultation);
router.get('/visit/:visitId', authorize('consultation', 'read'), doctorController.getByVisit);
router.put('/:id', authorize('consultation', 'update'), auditMiddleware('consultation'), doctorController.updateConsultation);
router.get('/:id', authorize('consultation', 'read'), doctorController.getById);

// Prescriptions
router.post('/prescriptions', authorize('prescription', 'create'), auditMiddleware('prescription'), doctorController.createPrescription);

// Lab requests
router.post('/lab-requests', authorize('lab_request', 'create'), auditMiddleware('lab_request'), doctorController.createLabRequest);

// Sonar requests
router.post('/sonar-requests', authorize('sonar_request', 'create'), auditMiddleware('sonar_request'), doctorController.createSonarRequest);

// Admissions
router.post('/admissions', authorize('admission', 'create'), auditMiddleware('admission'), doctorController.admitPatient);

// Discharge
router.put('/visits/:id/discharge', authorize('consultation', 'update'), auditMiddleware('consultation'), doctorController.dischargePatient);

// Diet prescriptions
router.post('/diet-prescriptions', authorize('diet', 'create'), auditMiddleware('diet'), doctorController.prescribeDiet);

// Clinic doctor dispositions
router.post(
  '/clinic/follow-up',
  authorize('consultation', 'create'),
  auditMiddleware('consultation'),
  doctorController.clinicScheduleFollowUp
);
router.post(
  '/clinic/booking-room',
  authorize('consultation', 'create'),
  auditMiddleware('consultation'),
  doctorController.clinicTransferBookingRoom
);
router.post(
  '/clinic/emergency-unit',
  authorize('consultation', 'create'),
  auditMiddleware('consultation'),
  doctorController.clinicTransferEmergencyUnit
);
router.post(
  '/clinic/discharge',
  authorize('consultation', 'update'),
  auditMiddleware('consultation'),
  doctorController.clinicDischargePatient
);

module.exports = router;
