const router = require('express').Router();
const labController = require('../controllers/lab.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

// Hospital test catalog (ordering & results UI)
router.get('/tests', authorize('lab_request', 'read'), labController.getTestCatalog);

// Get lab queue
router.get('/queue', authorize('lab_request', 'read'), labController.getQueue);

// Get single lab request
router.get('/request/:id', authorize('lab_request', 'read'), labController.getById);

// Get results by visit (for doctor)
router.get('/visit/:visitId', authorize('lab_result', 'read'), labController.getResultsByVisit);

// Nurse marks sample collected
router.put('/requests/:id/sample-collected', authorize('lab_request', 'update'), auditMiddleware('lab_request'), labController.sampleCollected);

// Lab tech starts processing
router.put('/requests/:id/processing', authorize('lab_request', 'update'), auditMiddleware('lab_request'), labController.startProcessing);

// Lab tech submits results
router.put('/requests/:id/results', authorize('lab_result', 'create'), auditMiddleware('lab_result'), labController.submitResults);

module.exports = router;
