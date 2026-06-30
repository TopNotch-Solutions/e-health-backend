'use strict';

const { v4: uuidv4 } = require('uuid');
const { UserReport, User, Role, Facility } = require('../models');
const { resolveReportImagePath } = require('../utils/reportUploads');

const ISSUE_TYPES = ['enquiry', 'issue', 'improvement'];
const STATUSES = ['pending', 'in_progress', 'completed'];
const DESCRIPTION_MAX = 360;
const DEFAULT_PAGE_SIZE = 20;

function parsePagination({ page, limit } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || DEFAULT_PAGE_SIZE));
  return {
    page: safePage,
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
  };
}

function buildPagination(total, page, limit) {
  const totalPages = Math.ceil(total / limit) || 1;
  return { total, page, limit, totalPages };
}

const reporterInclude = [
  {
    model: User,
    as: 'reporter',
    attributes: ['id', 'first_name', 'last_name', 'email'],
    include: [
      { model: Role, as: 'role', attributes: ['name', 'display_name'] },
      { model: Facility, as: 'facility', attributes: ['id', 'name'] },
    ],
  },
  {
    model: User,
    as: 'responder',
    attributes: ['id', 'first_name', 'last_name'],
    required: false,
  },
];

function serializeReport(row, { forAdmin = false, viewerId = null } = {}) {
  const plain = row.get ? row.get({ plain: true }) : row;
  const payload = {
    id: plain.id,
    issue_type: plain.issue_type,
    description: plain.description,
    status: plain.status,
    has_image: Boolean(plain.image_path),
    image_url: plain.image_path ? `/api/v1/reports/${plain.id}/attachment` : null,
    admin_response: plain.admin_response || null,
    responded_at: plain.responded_at || null,
    created_at: plain.created_at,
    updated_at: plain.updated_at,
  };

  if (forAdmin && plain.reporter) {
    payload.reporter = {
      id: plain.reporter.id,
      name: [plain.reporter.first_name, plain.reporter.last_name].filter(Boolean).join(' ').trim(),
      email: plain.reporter.email,
      role: plain.reporter.role?.display_name || plain.reporter.role?.name || null,
      facility: plain.reporter.facility?.name || null,
    };
    if (viewerId) {
      payload.is_own_report = plain.reported_by === viewerId;
      payload.can_action = plain.reported_by !== viewerId;
    }
  }

  if (plain.responder) {
    payload.responder = {
      id: plain.responder.id,
      name: [plain.responder.first_name, plain.responder.last_name].filter(Boolean).join(' ').trim(),
    };
  }

  return payload;
}

function validateCreatePayload({ issue_type, description }) {
  if (!ISSUE_TYPES.includes(issue_type)) {
    const err = new Error('Issue type must be enquiry, issue, or improvement');
    err.status = 400;
    throw err;
  }
  const text = String(description || '').trim();
  if (!text) {
    const err = new Error('Description is required');
    err.status = 400;
    throw err;
  }
  if (text.length > DESCRIPTION_MAX) {
    const err = new Error(`Description must be at most ${DESCRIPTION_MAX} characters`);
    err.status = 400;
    throw err;
  }
  return { issue_type, description: text };
}

async function createReport(userId, payload, imagePath = null, reportId = null) {
  const data = validateCreatePayload(payload);
  const report = await UserReport.create({
    id: reportId || uuidv4(),
    reported_by: userId,
    issue_type: data.issue_type,
    description: data.description,
    image_path: imagePath,
    status: 'pending',
  });
  return serializeReport(report);
}

async function listMyReports(userId, { page, limit } = {}) {
  const paging = parsePagination({ page, limit });
  const { rows, count } = await UserReport.findAndCountAll({
    where: { reported_by: userId },
    include: [
      {
        model: User,
        as: 'responder',
        attributes: ['id', 'first_name', 'last_name'],
        required: false,
      },
    ],
    order: [['created_at', 'DESC']],
    limit: paging.limit,
    offset: paging.offset,
  });
  return {
    rows: rows.map((row) => serializeReport(row)),
    pagination: buildPagination(count, paging.page, paging.limit),
  };
}

async function listAllReports({ status, page, limit, viewerId } = {}) {
  const where = {};
  if (status && STATUSES.includes(status)) {
    where.status = status;
  }
  const paging = parsePagination({ page, limit });
  const { rows, count } = await UserReport.findAndCountAll({
    where,
    include: reporterInclude,
    order: [['created_at', 'DESC']],
    limit: paging.limit,
    offset: paging.offset,
  });
  return {
    rows: rows.map((row) => serializeReport(row, { forAdmin: true, viewerId })),
    pagination: buildPagination(count, paging.page, paging.limit),
  };
}

async function getReportById(id) {
  return UserReport.findByPk(id, { include: reporterInclude });
}

async function updateReportStatus(adminUserId, reportId, { status, admin_response }) {
  if (!STATUSES.includes(status)) {
    const err = new Error('Status must be pending, in_progress, or completed');
    err.status = 400;
    throw err;
  }

  const report = await UserReport.findByPk(reportId);
  if (!report) {
    const err = new Error('Report not found');
    err.status = 404;
    throw err;
  }

  if (report.reported_by === adminUserId) {
    const err = new Error(
      'You cannot action a report you submitted. Another system administrator must handle it.'
    );
    err.status = 403;
    throw err;
  }

  const updates = { status };

  if (status === 'completed') {
    const note = String(admin_response || '').trim();
    if (!note) {
      const err = new Error('A response note is required when marking a report as completed');
      err.status = 400;
      throw err;
    }
    updates.admin_response = note;
    updates.responded_by = adminUserId;
    updates.responded_at = new Date();
  } else if (admin_response !== undefined) {
    const err = new Error('Admin response can only be set when status is completed');
    err.status = 400;
    throw err;
  }

  await report.update(updates);
  const refreshed = await getReportById(reportId);
  return serializeReport(refreshed, { forAdmin: true, viewerId: adminUserId });
}

async function canAccessAttachment(user, report) {
  if (!report) return false;
  if (user.role?.name === 'system_admin') return true;
  return report.reported_by === user.id;
}

function resolveAttachmentPath(imagePath) {
  return resolveReportImagePath(imagePath);
}

module.exports = {
  ISSUE_TYPES,
  STATUSES,
  DESCRIPTION_MAX,
  DEFAULT_PAGE_SIZE,
  createReport,
  listMyReports,
  listAllReports,
  getReportById,
  updateReportStatus,
  canAccessAttachment,
  resolveAttachmentPath,
  serializeReport,
};
