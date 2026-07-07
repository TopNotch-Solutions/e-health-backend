const router = require('express').Router();
const pharmacyController = require('../controllers/pharmacy.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { ROLE_PERMISSIONS } = require('../config/roles');
const { auditMiddleware } = require('../middleware/audit');

function authorizePrescriptionManage(req, res, next) {
  const actions = ROLE_PERMISSIONS[req.user.role.name]?.prescription || [];
  if (actions.includes('create') || actions.includes('update')) return next();
  return res.status(403).json({
    success: false,
    message: 'Access denied: cannot manage prescriptions',
  });
}

router.use(authenticate);

// Get pharmacy queue (pending prescriptions)
router.get('/queue', authorize('prescription', 'read'), pharmacyController.getQueue);

// Get single prescription with items
router.get('/prescription/:id', authorize('prescription', 'read'), pharmacyController.getPrescription);

// Dispense medications (checkbox updates)
router.put('/dispense/:id', authorize('prescription', 'update'), auditMiddleware('prescription'), pharmacyController.dispense);

router.put(
  '/release-out-of-stock/:id',
  authorize('prescription', 'update'),
  auditMiddleware('prescription'),
  pharmacyController.releaseOutOfStock
);

// Stop recurring medication schedule (prescribers and pharmacists)
router.put(
  '/items/:itemId/stop-schedule',
  authorizePrescriptionManage,
  auditMiddleware('prescription'),
  pharmacyController.stopRecurringSchedule
);

// Generate referral for unavailable medications
router.post('/referral/:id', authorize('referral', 'create'), auditMiddleware('referral'), pharmacyController.generateReferral);

module.exports = router;
