const router = require('express').Router();
const multer = require('multer');
const icd10Controller = require('../controllers/icd10.controller');
const { authenticate } = require('../middleware/auth');
const { authorize, allowRoles } = require('../middleware/rbac');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(authenticate);

router.get('/manage', allowRoles('system_admin'), icd10Controller.listForAdmin);
router.post('/import', allowRoles('system_admin'), upload.single('file'), icd10Controller.importXlsx);
router.post('/', allowRoles('system_admin'), icd10Controller.create);
router.patch('/records/:id', allowRoles('system_admin'), icd10Controller.updateStatus);

router.get('/', authorize('consultation', 'read'), icd10Controller.search);
router.get('/:code', authorize('consultation', 'read'), icd10Controller.getByCode);

module.exports = router;
