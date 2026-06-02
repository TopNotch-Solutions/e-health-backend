const router = require('express').Router();
const hivTesterController = require('../controllers/hivTester.controller');
const artNurseController = require('../controllers/artNurse.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');

router.use(authenticate);

router.get(
  '/hiv-tester/handover/:visitId',
  authorize('vitals', 'read'),
  hivTesterController.getHandover
);

router.post(
  '/hiv-tester/submit',
  authorize('vitals', 'create'),
  auditMiddleware('vitals'),
  hivTesterController.submitTestResult
);

router.get(
  '/art-nurse/handover/:visitId',
  authorize('vitals', 'read'),
  artNurseController.getHandover
);

router.get(
  '/art-nurse/episode/:visitId',
  authorize('vitals', 'read'),
  artNurseController.getEpisode
);

router.put(
  '/art-nurse/pathway',
  authorize('vitals', 'update'),
  auditMiddleware('vitals'),
  artNurseController.updatePathway
);

router.post(
  '/art-nurse/complete-session',
  authorize('vitals', 'update'),
  auditMiddleware('vitals'),
  artNurseController.completeArtSession
);

router.get(
  '/patients/:patientId/art-history',
  authorize('vitals', 'read'),
  artNurseController.getPatientArtHistory
);

module.exports = router;
