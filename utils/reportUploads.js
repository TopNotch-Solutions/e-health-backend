'use strict';

const fs = require('fs');
const path = require('path');

const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads');
const REPORTS_DIR = path.join(UPLOADS_ROOT, 'reports');

function ensureReportUploadDirs() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function reportsRelativePath(filename) {
  return path.posix.join('uploads', 'reports', filename);
}

function resolveReportImagePath(storedPath) {
  if (!storedPath) return null;
  const normalized = String(storedPath).replace(/^\/+/, '');
  const full = path.isAbsolute(normalized)
    ? normalized
    : path.join(__dirname, '..', normalized);
  if (!fs.existsSync(full)) return null;
  return full;
}

function deleteReportImageIfExists(storedPath) {
  const full = resolveReportImagePath(storedPath);
  if (!full) return;
  try {
    fs.unlinkSync(full);
  } catch {
    // ignore missing file
  }
}

function mimeTypeForPath(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
  };
  return map[ext] || 'application/octet-stream';
}

module.exports = {
  REPORTS_DIR,
  ensureReportUploadDirs,
  reportsRelativePath,
  resolveReportImagePath,
  deleteReportImageIfExists,
  mimeTypeForPath,
};
