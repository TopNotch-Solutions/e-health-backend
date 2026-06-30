'use strict';

const fs = require('fs');
const userReportService = require('../services/userReportService');
const { paginated } = require('../utils/response');
const {
  deleteReportImageIfExists,
  mimeTypeForPath,
  reportsRelativePath,
  resolveReportImagePath,
} = require('../utils/reportUploads');

async function create(req, res, next) {
  let uploadedPath = null;
  try {
    let imagePath = null;
    if (req.file) {
      uploadedPath = req.file.path;
      if (!fs.existsSync(uploadedPath)) {
        const err = new Error('Failed to save image on the server');
        err.status = 500;
        throw err;
      }
      imagePath = reportsRelativePath(req.file.filename);
    }

    const report = await userReportService.createReport(
      req.user.id,
      {
        issue_type: req.body.issue_type,
        description: req.body.description,
      },
      imagePath,
      req.reportId
    );
    uploadedPath = null;
    res.status(201).json({ success: true, data: report });
  } catch (err) {
    if (uploadedPath && fs.existsSync(uploadedPath)) {
      try {
        fs.unlinkSync(uploadedPath);
      } catch {
        // ignore cleanup errors
      }
    }
    next(err);
  }
}

async function listMine(req, res, next) {
  try {
    const result = await userReportService.listMyReports(req.user.id, {
      page: req.query.page,
      limit: req.query.limit,
    });
    return paginated(
      res,
      result.rows,
      result.pagination.total,
      result.pagination.page,
      result.pagination.limit
    );
  } catch (err) {
    next(err);
  }
}

async function listAll(req, res, next) {
  try {
    const result = await userReportService.listAllReports({
      status: req.query.status || undefined,
      page: req.query.page,
      limit: req.query.limit,
      viewerId: req.user.id,
    });
    return paginated(
      res,
      result.rows,
      result.pagination.total,
      result.pagination.page,
      result.pagination.limit
    );
  } catch (err) {
    next(err);
  }
}

async function updateStatus(req, res, next) {
  try {
    const data = await userReportService.updateReportStatus(req.user.id, req.params.id, {
      status: req.body.status,
      admin_response: req.body.admin_response,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function getAttachment(req, res, next) {
  try {
    const report = await userReportService.getReportById(req.params.id);
    if (!report?.image_path) {
      return res.status(404).json({ success: false, message: 'Attachment not found' });
    }
    if (!userReportService.canAccessAttachment(req.user, report)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const filePath = resolveReportImagePath(report.image_path);
    if (!filePath) {
      return res.status(404).json({ success: false, message: 'Attachment file missing on server' });
    }
    res.type(mimeTypeForPath(filePath));
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  create,
  listMine,
  listAll,
  updateStatus,
  getAttachment,
  deleteReportImageIfExists,
};
