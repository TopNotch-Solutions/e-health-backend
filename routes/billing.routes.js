const router = require('express').Router();
const billingController = require('../controllers/billing.controller');
const billingFeesController = require('../controllers/billingFees.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

router.get('/fees', authorize('billing', 'read'), billingFeesController.getFees);
router.put('/fees/:feeKey', authorize('billing', 'update'), billingFeesController.updateFee);

// Get billing queue (private patients)
router.get('/queue', authorize('billing', 'read'), billingController.getQueue);

// Get bill for a visit
router.get('/visit/:visitId', authorize('billing', 'read'), billingController.getBillByVisit);

// Add charge to bill
router.post('/charge', authorize('billing', 'create'), auditMiddleware('billing'), billingController.addCharge);

// Record payment (cash + EFT must equal total)
router.post('/payment', authorize('billing', 'update'), auditMiddleware('billing'), billingController.recordPayment);

// Waive bill
router.put('/:id/waive', authorize('billing', 'update'), auditMiddleware('billing'), billingController.waiveBill);

// Finalize bill (set to pending_payment)
router.put('/:id/finalize', authorize('billing', 'update'), auditMiddleware('billing'), billingController.finalizeBill);

module.exports = router;
