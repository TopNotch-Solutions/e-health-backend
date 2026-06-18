const express = require('express');
const router = express.Router();
const maternityController = require('../controllers/maternity.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

router.use(authenticate);

router.get('/config', authorize('queue', 'read'), maternityController.getConfig);
router.get('/state-hospitals', authorize('vitals', 'read'), maternityController.getStateHospitals);

router.get(
  '/patients/:patientId/medical-history',
  authorize('patient', 'read'),
  maternityController.getPatientMedicalHistory
);

router.post('/front-office/register', authorize('patient', 'create'), maternityController.registerPatient);
router.post('/front-office/route', authorize('queue', 'push'), maternityController.routeFromFrontOffice);

router.get('/episode/:visitId', authorize('admission', 'read'), maternityController.getEpisode);

router.get('/anc/:visitId/sessions', authorize('vitals', 'read'), maternityController.getAncSessions);
router.post('/anc/complete', authorize('vitals', 'create'), maternityController.completeAncSession);

router.get('/anw/:visitId/records', authorize('admission', 'read'), maternityController.getAnwRecords);
router.post('/anw/sign-off', authorize('admission', 'update'), maternityController.signOffAnwDaily);

router.get('/pnw/:visitId/records', authorize('admission', 'read'), maternityController.getPnwRecords);
router.post('/pnw/sign-off', authorize('admission', 'update'), maternityController.signOffPnwDaily);

router.get('/icu/:visitId/records', authorize('admission', 'read'), maternityController.getIcuRecords);
router.post('/icu/sign-off', authorize('admission', 'update'), maternityController.signOffIcuDaily);

router.get('/nicu/:visitId/records', authorize('vitals', 'read'), maternityController.getNicuRecords);
router.post('/nicu/register-newborn', authorize('patient', 'create'), maternityController.registerNewborn);

module.exports = router;
