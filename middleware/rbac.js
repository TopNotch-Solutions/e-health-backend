const { ROLE_PERMISSIONS } = require('../config/roles');

/**
 * Check if user's role has permission for the given resource and action.
 * Usage: authorize('patient', 'create')
 */
const authorize = (resource, action) => {
  return (req, res, next) => {
    const userRole = req.user.role.name;
    const rolePerms = ROLE_PERMISSIONS[userRole];

    if (!rolePerms) {
      return res.status(403).json({ success: false, message: 'Role not configured' });
    }

    const allowedActions = rolePerms[resource];
    if (!allowedActions || !allowedActions.includes(action)) {
      return res.status(403).json({
        success: false,
        message: `Access denied: ${userRole} cannot ${action} ${resource}`,
      });
    }

    next();
  };
};

/**
 * Allow access only to specific roles.
 * Usage: allowRoles('doctor', 'nurse', 'system_admin')
 */
const allowRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role.name)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: insufficient role',
      });
    }
    next();
  };
};

module.exports = { authorize, allowRoles };
