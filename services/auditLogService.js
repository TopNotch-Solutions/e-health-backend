const { AuditLog } = require('../models');

function actorName(user) {
  if (!user) return 'Unknown';
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return name || user.email || 'Unknown';
}

async function writeAuditLog(req, { action, resource, resourceId = null, details = null }) {
  if (!req?.user?.id) return;

  const payload = {
    user_id: req.user.id,
    action,
    resource,
    resource_id: resourceId,
    ip_address: req.ip || req.connection?.remoteAddress || null,
  };

  if (details != null) {
    payload.details = {
      ...details,
      performed_by: details.performed_by || actorName(req.user),
    };
  }

  try {
    await AuditLog.create(payload);
  } catch (err) {
    console.error('writeAuditLog error:', err.message);
  }
}

module.exports = {
  writeAuditLog,
  actorName,
};
