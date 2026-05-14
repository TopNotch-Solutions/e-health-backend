const router = require('express').Router();
const doctorController = require('../controllers/doctor.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

// Consultations
router.post('/', authorize('consultation', 'create'), auditMiddleware('consultation'), doctorController.createConsultation);
router.get('/visit/:visitId', authorize('consultation', 'read'), doctorController.getByVisit);
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

module.exports = router;
