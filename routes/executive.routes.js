const router = require('express').Router();
const executiveController = require('../controllers/executive.controller');
const { authenticate } = require('../middleware/auth');
const { allowRoles } = require('../middleware/rbac');

router.use(authenticate);
router.use(allowRoles('executive', 'system_admin'));

// Executive overview (all key counts)
router.get('/overview', executiveController.getOverview);

// Employee statistics (by role, active/inactive, logged in today)
router.get('/employees', executiveController.getEmployeeStats);

// Individual staff performance (patients served, avg service time)
router.get('/staff-performance', executiveController.getStaffPerformance);

// Revenue analytics
router.get('/revenue', executiveController.getRevenueAnalytics);

// Patient registration trends (daily, by category, sex, payment type)
router.get('/registrations', executiveController.getRegistrationTrends);

// Department workload (queue throughput, wait times)
router.get('/departments', executiveController.getDepartmentWorkload);

// Mortality statistics
router.get('/mortality', executiveController.getMortalityStats);

// Admission & discharge analytics
router.get('/admissions', executiveController.getAdmissionStats);

// Unified read-only analytics panel (all modules — charts + KPIs)
router.get('/panel/:key', executiveController.getAnalyticsPanel);

module.exports = router;
