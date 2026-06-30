'use strict';

const router = require('express').Router();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const userReportController = require('../controllers/userReport.controller');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { REPORTS_DIR, ensureReportUploadDirs } = require('../utils/reportUploads');

ensureReportUploadDirs();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureReportUploadDirs();
    cb(null, REPORTS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const reportId = req.reportId || uuidv4();
    cb(null, `${reportId}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype?.startsWith('image/')) {
      return cb(new Error('Only image attachments are allowed'));
    }
    return cb(null, true);
  },
});

function assignReportId(req, _res, next) {
  req.reportId = uuidv4();
  next();
}

function handleImageUpload(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      err.status = 413;
      err.message = 'Image must be 5 MB or smaller';
    } else {
      err.status = 400;
    }
    return next(err);
  });
}

router.use(authenticate);

router.post(
  '/',
  authorize('user_report', 'create'),
  assignReportId,
  handleImageUpload,
  userReportController.create
);

router.get('/mine', authorize('user_report', 'read'), userReportController.listMine);
router.get('/admin', authorize('user_report', 'update'), userReportController.listAll);

router.get('/:id/attachment', authorize('user_report', 'read'), userReportController.getAttachment);

router.patch(
  '/:id',
  authorize('user_report', 'update'),
  userReportController.updateStatus
);

module.exports = router;
