const router = require('express').Router();
const adminController = require('../controllers/admin.controller');
const adminPatientRecordsController = require('../controllers/adminPatientRecords.controller');
const { authenticate } = require('../middleware/auth');
const { authorize, allowRoles } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

// Admin dashboard
router.get('/dashboard', allowRoles('system_admin'), adminController.getDashboard);

// Facility management (national)
router.get('/facilities', authorize('facility', 'read'), adminController.getFacilities);
router.post('/facilities', authorize('facility', 'create'), auditMiddleware('facility'), adminController.createFacility);

// User management
router.get('/users', authorize('user', 'read'), adminController.getUsers);
router.post('/users', authorize('user', 'create'), auditMiddleware('user'), adminController.createUser);
router.post('/system-admins', allowRoles('system_admin'), auditMiddleware('user'), adminController.createSystemAdmin);
router.put('/users/:id', authorize('user', 'update'), auditMiddleware('user'), adminController.updateUser);
router.post('/users/:id/transfer', authorize('user', 'update'), auditMiddleware('user'), adminController.transferEmployee);
router.get('/users/:id/facility-history', authorize('user', 'read'), adminController.getEmployeeFacilityHistory);

// Roles
router.get('/roles', authorize('user', 'read'), adminController.getRoles);

// Audit logs
router.get('/audit-logs', authorize('audit_log', 'read'), adminController.getAuditLogs);

// Patient records (system admin — facility-scoped history + XLSX export)
router.get(
  '/patients/search',
  allowRoles('system_admin'),
  adminPatientRecordsController.searchPatients
);
router.get(
  '/patients/:id/medical-history',
  allowRoles('system_admin'),
  adminPatientRecordsController.getMedicalHistory
);
router.get(
  '/patients/:id/medical-history/export',
  allowRoles('system_admin'),
  adminPatientRecordsController.exportMedicalHistory
);

// Social Worker Cases
router.get('/social-worker-cases', authorize('social_worker_case', 'read'), adminController.getSocialWorkerCases);
router.post('/social-worker-cases', authorize('social_worker_case', 'create'), auditMiddleware('social_worker_case'), adminController.createSocialWorkerCase);
router.put('/social-worker-cases/:id', authorize('social_worker_case', 'update'), auditMiddleware('social_worker_case'), adminController.updateSocialWorkerCase);

module.exports = router;
