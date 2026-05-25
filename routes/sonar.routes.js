const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const sonarController = require('../controllers/sonar.controller');
const clinicalSupervisorController = require('../controllers/clinicalSupervisor.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

// Multer config for sonar image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads/sonar')),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB max

router.use(authenticate);

router.get(
  '/supervisor-metrics',
  authorize('analytics', 'read'),
  clinicalSupervisorController.getRadiologistSupervisorMetrics
);

router.get('/scans', authorize('sonar_request', 'read'), sonarController.getScanCatalog);

router.get('/queue', authorize('sonar_request', 'read'), sonarController.getQueue);

// Get single sonar request
router.get('/request/:id', authorize('sonar_request', 'read'), sonarController.getById);

// Get results by visit
router.get('/visit/:visitId', authorize('sonar_result', 'read'), sonarController.getResultsByVisit);

router.put('/requests/:id/start', authorize('sonar_request', 'update'), auditMiddleware('sonar_request'), sonarController.startScan);

router.put('/requests/:id/imaging', authorize('sonar_request', 'update'), auditMiddleware('sonar_request'), sonarController.saveImaging);

router.put(
  '/requests/:id/results',
  authorize('sonar_result', 'create'),
  auditMiddleware('sonar_result'),
  sonarController.submitResultsAndReturn
);

module.exports = router;
