const router = require('express').Router();
const controller = require('../controllers/hospitalOutpatient.controller');
const transferController = require('../controllers/clinicHospitalTransfer.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

router.use(authenticate);

router.get('/queue', authorize('queue', 'read'), controller.getQueue);
router.get('/inbound', authorize('referral', 'read'), controller.getInboundTransfers);
router.get('/queue/:queueEntryId/transfer', authorize('queue', 'read'), controller.getTransferForQueueEntry);
router.post('/confirm-receipt', authorize('referral', 'update'), transferController.confirmReceipt);

module.exports = router;
