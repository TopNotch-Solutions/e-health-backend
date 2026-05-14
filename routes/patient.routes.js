const router = require('express').Router();
const patientController = require('../controllers/patient.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

// Register new patient
router.post('/', authorize('patient', 'create'), auditMiddleware('patient'), patientController.register);

// Emergency one-click registration
router.post('/emergency', authorize('patient', 'create'), auditMiddleware('patient'), patientController.emergencyRegister);

// Search / list patients
router.get('/', authorize('patient', 'read'), patientController.getAll);

// Get single patient
router.get('/:id', authorize('patient', 'read'), patientController.getById);

// Get patient visit history
router.get('/:id/history', authorize('patient', 'read'), patientController.getHistory);

// Update patient
router.put('/:id', authorize('patient', 'update'), auditMiddleware('patient'), patientController.update);

// Create new visit for returning patient
router.post('/:id/visits', authorize('patient', 'create'), auditMiddleware('patient'), patientController.createVisit);

module.exports = router;
