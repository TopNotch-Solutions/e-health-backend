const { AuditLog } = require('../models');

/**
 * Auto-logs mutations (POST, PUT, PATCH, DELETE) to audit_logs table.
 */
const auditMiddleware = (resource) => {
  return async (req, res, next) => {
    // Only log mutations
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next();
    }

    // Capture original json method to intercept response
    const originalJson = res.json.bind(res);
    res.json = async (data) => {
      // Log after successful response
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
        try {
          await AuditLog.create({
            user_id: req.user.id,
            action: getAction(req.method),
            resource: resource,
            resource_id: req.params.id || (data && data.data && data.data.id) || null,
            details: JSON.stringify({
              method: req.method,
              path: req.originalUrl,
              body: sanitizeBody(req.body),
            }),
            ip_address: req.ip || req.connection.remoteAddress,
          });
        } catch (err) {
          console.error('Audit log error:', err.message);
        }
      }
      return originalJson(data);
    };

    next();
  };
};

function getAction(method) {
  switch (method) {
    case 'POST': return 'create';
    case 'PUT':
    case 'PATCH': return 'update';
    case 'DELETE': return 'delete';
    default: return method.toLowerCase();
  }
}

function sanitizeBody(body) {
  if (!body) return null;
  const sanitized = { ...body };
  // Remove sensitive fields
  delete sanitized.password;
  delete sanitized.password_hash;
  delete sanitized.token;
  return sanitized;
}

module.exports = { auditMiddleware };
