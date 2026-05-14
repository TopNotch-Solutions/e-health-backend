const router = require('express').Router();
const wardController = require('../controllers/ward.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

// Get all wards with bed stats
router.get('/', authorize('ward', 'read'), wardController.getAll);

// Get available beds (for doctor admitting)
router.get('/beds/available', authorize('bed', 'read'), wardController.getAvailableBeds);

// Get ward supervisor dashboard
router.get('/:id/dashboard', authorize('ward', 'read'), wardController.getDashboard);

// Get all current admissions
router.get('/admissions', authorize('admission', 'read'), wardController.getAdmissions);

// Create ward
router.post('/', authorize('ward', 'create'), auditMiddleware('ward'), wardController.createWard);

// Update ward
router.put('/:id', authorize('ward', 'update'), auditMiddleware('ward'), wardController.updateWard);

// Add bed
router.post('/beds', authorize('bed', 'create'), auditMiddleware('bed'), wardController.addBed);

// Update bed status/condition
router.put('/beds/:id', authorize('bed', 'update'), auditMiddleware('bed'), wardController.updateBed);

// Update admission (ward staff)
router.put('/admissions/:id', authorize('admission', 'update'), auditMiddleware('admission'), wardController.updateAdmission);

module.exports = router;
