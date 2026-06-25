const router = require('express').Router();
const controller = require('../controllers/clinicHospitalTransfer.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

router.get('/hospital-departments', authorize('referral', 'read'), controller.getHospitalDepartments);
router.get('/visit/:visitId', authorize('referral', 'read'), controller.getTransferByVisit);
router.post('/initiate', authorize('transport', 'create'), auditMiddleware('transport'), controller.initiateTransport);
router.post('/confirm-departure', authorize('transport', 'update'), auditMiddleware('transport'), controller.confirmDeparture);
router.post('/confirm-receipt', authorize('referral', 'update'), auditMiddleware('referral'), controller.confirmReceipt);

module.exports = router;
