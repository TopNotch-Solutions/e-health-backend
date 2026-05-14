const router = require('express').Router();
const adminController = require('../controllers/admin.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

router.use(authenticate);

// Patient/visit analytics
router.get('/patients', authorize('analytics', 'read'), adminController.getAnalytics);

module.exports = router;
