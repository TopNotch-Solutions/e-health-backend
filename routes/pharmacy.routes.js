const router = require('express').Router();
const pharmacyController = require('../controllers/pharmacy.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

// Get pharmacy queue (pending prescriptions)
router.get('/queue', authorize('prescription', 'read'), pharmacyController.getQueue);

// Get single prescription with items
router.get('/prescription/:id', authorize('prescription', 'read'), pharmacyController.getPrescription);

// Dispense medications (checkbox updates)
router.put('/dispense/:id', authorize('prescription', 'update'), auditMiddleware('prescription'), pharmacyController.dispense);

// Generate referral for unavailable medications
router.post('/referral/:id', authorize('referral', 'create'), auditMiddleware('referral'), pharmacyController.generateReferral);

module.exports = router;
