const router = require('express').Router();
const wardController = require('../controllers/ward.controller');
const icuWardController = require('../controllers/icuWard.controller');
const surgicalComplexWardController = require('../controllers/surgicalComplexWard.controller');
const specializedInpatientWardController = require('../controllers/specializedInpatientWard.controller');
const adultOutpatientWardController = require('../controllers/adultOutpatientWard.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

// Get all wards with bed stats
router.get('/', authorize('ward', 'read'), wardController.getAll);

// Get available beds (for doctor admitting)
router.get('/beds/available', authorize('bed', 'read'), wardController.getAvailableBeds);

// Ward staff arrival queue (must be before /:id routes)
router.get('/staff-queue', authorize('admission', 'read'), wardController.getStaffQueue);

// ICU ward — patients currently admitted (must be before /:id routes)
router.get('/icu/admitted', authorize('admission', 'read'), icuWardController.listAdmitted);

router.get(
  '/admissions/:admissionId/icu-records',
  authorize('admission', 'read'),
  icuWardController.listDailyRecords
);
router.post(
  '/admissions/:admissionId/icu-records',
  authorize('admission', 'update'),
  auditMiddleware('admission'),
  icuWardController.saveDailyRecord
);
router.post(
  '/admissions/:admissionId/transfer/general',
  authorize('admission', 'update'),
  auditMiddleware('admission'),
  icuWardController.transferToGeneralWard
);
router.post(
  '/admissions/:admissionId/transfer/mortuary',
  authorize('admission', 'update'),
  auditMiddleware('admission'),
  icuWardController.transferToMortuary
);

// Surgical complex ward — daily care and transfers
router.get(
  '/surgical-complex/admitted',
  authorize('admission', 'read'),
  surgicalComplexWardController.listAdmitted
);
router.get(
  '/admissions/:admissionId/surgical-complex-records',
  authorize('admission', 'read'),
  surgicalComplexWardController.listDailyRecords
);
router.post(
  '/admissions/:admissionId/surgical-complex-records',
  authorize('admission', 'update'),
  auditMiddleware('admission'),
  surgicalComplexWardController.saveDailyRecord
);
router.post(
  '/admissions/:admissionId/surgical-complex/transfer',
  authorize('admission', 'update'),
  auditMiddleware('admission'),
  surgicalComplexWardController.transferToWard
);
router.post(
  '/admissions/:admissionId/surgical-complex/transfer/mortuary',
  authorize('admission', 'update'),
  auditMiddleware('admission'),
  surgicalComplexWardController.transferToMortuary
);

// Specialized inpatient ward — daily care, transfers, and discharge
router.get(
  '/specialized-inpatient/admitted',
  authorize('admission', 'read'),
  specializedInpatientWardController.listAdmitted
);
router.get(
  '/admissions/:admissionId/specialized-inpatient-records',
  authorize('admission', 'read'),
  specializedInpatientWardController.listDailyRecords
);
router.post(
  '/admissions/:admissionId/specialized-inpatient-records',
  authorize('admission', 'update'),
  auditMiddleware('admission'),
  specializedInpatientWardController.saveDailyRecord
);
router.post(
  '/admissions/:admissionId/specialized-inpatient/transfer',
  authorize('admission', 'update'),
  auditMiddleware('admission'),
  specializedInpatientWardController.transferToWard
);
router.post(
  '/admissions/:admissionId/specialized-inpatient/discharge',
  authorize('admission', 'update'),
  auditMiddleware('admission'),
  specializedInpatientWardController.dischargePatient
);
router.post(
  '/admissions/:admissionId/specialized-inpatient/transfer/mortuary',
  authorize('admission', 'update'),
  auditMiddleware('admission'),
  specializedInpatientWardController.transferToMortuary
);

// Adult outpatient ward — daily care, transfers, and discharge
router.get(
  '/adult-outpatient/admitted',
  authorize('admission', 'read'),
  adultOutpatientWardController.listAdmitted
);
router.get(
  '/admissions/:admissionId/adult-outpatient-records',
  authorize('admission', 'read'),
  adultOutpatientWardController.listDailyRecords
);
router.post(
  '/admissions/:admissionId/adult-outpatient-records',
  authorize('admission', 'update'),
  auditMiddleware('admission'),
  adultOutpatientWardController.saveDailyRecord
);
router.post(
  '/admissions/:admissionId/adult-outpatient/transfer',
  authorize('admission', 'update'),
  auditMiddleware('admission'),
  adultOutpatientWardController.transferToWard
);
router.post(
  '/admissions/:admissionId/adult-outpatient/discharge',
  authorize('admission', 'update'),
  auditMiddleware('admission'),
  adultOutpatientWardController.dischargePatient
);
router.post(
  '/admissions/:admissionId/adult-outpatient/transfer/mortuary',
  authorize('admission', 'update'),
  auditMiddleware('admission'),
  adultOutpatientWardController.transferToMortuary
);

// Ward supervisor analytics (must be before /:id routes)
router.get('/supervisor-metrics', authorize('ward', 'read'), wardController.getSupervisorMetrics);

// Get all current admissions
router.get('/admissions', authorize('admission', 'read'), wardController.getAdmissions);

router.get('/admissions/:id', authorize('admission', 'read'), wardController.getAdmissionById);

router.put(
  '/admissions/:id/confirm-arrival',
  authorize('admission', 'update'),
  auditMiddleware('admission'),
  wardController.confirmArrival
);

// Get ward supervisor dashboard
router.get('/:id/dashboard', authorize('ward', 'read'), wardController.getDashboard);

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
