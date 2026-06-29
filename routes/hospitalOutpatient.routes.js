const router = require('express').Router();
const controller = require('../controllers/hospitalOutpatient.controller');
const transferController = require('../controllers/clinicHospitalTransfer.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

router.use(authenticate);

router.get('/queue', authorize('queue', 'read'), controller.getQueue);
router.get('/inbound', authorize('referral', 'read'), controller.getInboundTransfers);
router.get('/queue/:queueEntryId/transfer', authorize('queue', 'read'), controller.getTransferForQueueEntry);
router.get('/queue/:queueEntryId/workspace', authorize('queue', 'read'), controller.getWorkspace);
router.post('/session/start', authorize('queue', 'update'), controller.startSession);
router.post('/vitals', authorize('vitals', 'create'), controller.saveVitals);
router.post('/admit', authorize('admission', 'create'), controller.admitToWard);
router.post('/discharge', authorize('consultation', 'create'), controller.dischargePatient);
router.post('/confirm-receipt', authorize('referral', 'update'), transferController.confirmReceipt);

module.exports = router;
