const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const sonarController = require('../controllers/sonar.controller');
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

// Get sonar queue
router.get('/queue', authorize('sonar_request', 'read'), sonarController.getQueue);

// Get single sonar request
router.get('/request/:id', authorize('sonar_request', 'read'), sonarController.getById);

// Get results by visit
router.get('/visit/:visitId', authorize('sonar_result', 'read'), sonarController.getResultsByVisit);

// Start scan
router.put('/requests/:id/start', authorize('sonar_request', 'update'), auditMiddleware('sonar_request'), sonarController.startScan);

// Submit results with optional image upload
router.put('/requests/:id/results', authorize('sonar_result', 'create'), upload.array('images', 5), auditMiddleware('sonar_result'), sonarController.submitResults);

module.exports = router;
