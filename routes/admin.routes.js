const router = require('express').Router();
const adminController = require('../controllers/admin.controller');
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
router.put('/users/:id', authorize('user', 'update'), auditMiddleware('user'), adminController.updateUser);

// Roles
router.get('/roles', authorize('user', 'read'), adminController.getRoles);

// Audit logs
router.get('/audit-logs', authorize('audit_log', 'read'), adminController.getAuditLogs);

// Social Worker Cases
router.get('/social-worker-cases', authorize('social_worker_case', 'read'), adminController.getSocialWorkerCases);
router.post('/social-worker-cases', authorize('social_worker_case', 'create'), auditMiddleware('social_worker_case'), adminController.createSocialWorkerCase);
router.put('/social-worker-cases/:id', authorize('social_worker_case', 'update'), auditMiddleware('social_worker_case'), adminController.updateSocialWorkerCase);

module.exports = router;
