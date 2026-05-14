const router = require('express').Router();
const mortuaryController = require('../controllers/mortuary.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

// Get all mortuary records
router.get('/', authorize('mortuary', 'read'), mortuaryController.getAll);

// Get single record
router.get('/:id', authorize('mortuary', 'read'), mortuaryController.getById);

// Register deceased
router.post('/', authorize('mortuary', 'create'), auditMiddleware('mortuary'), mortuaryController.register);

// Release body
router.put('/:id/release', authorize('mortuary', 'update'), auditMiddleware('mortuary'), mortuaryController.release);

module.exports = router;
