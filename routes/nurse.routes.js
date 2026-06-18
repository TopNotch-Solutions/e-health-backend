const router = require('express').Router();
const nurseController = require('../controllers/nurse.controller');
const clinicalSupervisorController = require('../controllers/clinicalSupervisor.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

router.get(
  '/supervisor-metrics',
  authorize('analytics', 'read'),
  clinicalSupervisorController.getNurseSupervisorMetrics
);

// Record vitals
router.post('/', authorize('vitals', 'create'), auditMiddleware('vitals'), nurseController.create);

// Record vitals and push to doctor queue
router.post('/push-to-doctor', authorize('vitals', 'create'), auditMiddleware('vitals'), nurseController.createAndPush);

router.post(
  '/parameter-nurse/push',
  authorize('vitals', 'create'),
  auditMiddleware('vitals'),
  nurseController.parameterNursePush
);

router.post(
  '/screening-nurse/push',
  authorize('vitals', 'create'),
  auditMiddleware('vitals'),
  nurseController.screeningNursePush
);

router.post(
  '/parameter-nurse/discharge',
  authorize('vitals', 'create'),
  auditMiddleware('vitals'),
  nurseController.parameterNurseDischarge
);

router.post(
  '/screening-nurse/discharge',
  authorize('vitals', 'create'),
  auditMiddleware('vitals'),
  nurseController.screeningNurseDischarge
);

router.get(
  '/handover/:visitId',
  authorize('vitals', 'read'),
  nurseController.getHandoverVitals
);

router.get(
  '/clinical-timeline/:visitId',
  authorize('vitals', 'read'),
  nurseController.getClinicalTimeline
);

// Get vitals by visit
router.get('/visit/:visitId', authorize('vitals', 'read'), nurseController.getByVisit);

// Update vitals
router.put('/:id', authorize('vitals', 'update'), auditMiddleware('vitals'), nurseController.update);

module.exports = router;
