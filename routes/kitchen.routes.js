const router = require('express').Router();
const kitchenController = require('../controllers/kitchen.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

// Kitchen dashboard stats
router.get('/dashboard', authorize('meal_plan', 'read'), kitchenController.getDashboard);

// Get today's meal plans (grouped by meal type)
router.get('/meal-plans', authorize('meal_plan', 'read'), kitchenController.getMealPlans);

// Generate daily meal plans (for next day)
router.post('/meal-plans/generate', authorize('meal_plan', 'create'), auditMiddleware('meal_plan'), kitchenController.generateDailyPlans);

// Mark meal as prepared
router.put('/meals/:id/prepared', authorize('meal_plan', 'update'), auditMiddleware('meal_plan'), kitchenController.markPrepared);

// Mark meal as dispensed
router.put('/meals/:id/dispensed', authorize('meal_plan', 'update'), auditMiddleware('meal_plan'), kitchenController.markDispensed);

module.exports = router;
