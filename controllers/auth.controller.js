const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { User, Role, RefreshToken, AuditLog } = require('../models');
const { success, error } = require('../utils/response');

const generateTokens = (user) => {
  const accessToken = jwt.sign(
    { userId: user.id, role: user.role.name, facilityId: user.facility_id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );

  const refreshToken = jwt.sign(
    { userId: user.id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );

  return { accessToken, refreshToken };
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return error(res, 'Email and password are required', 400);
    }

    const user = await User.findOne({
      where: { email },
      include: [{ model: Role, as: 'role' }],
    });

    if (!user) {
      return error(res, 'Invalid credentials', 401);
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return error(res, 'Invalid credentials', 401);
    }

    if (!user.is_active) {
      return error(
        res,
        'Your account has been deactivated. Contact your system administrator.',
        403
      );
    }

    const tokens = generateTokens(user);

    // Store refresh token
    await RefreshToken.create({
      id: uuidv4(),
      user_id: user.id,
      token: tokens.refreshToken,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    // Update last login
    await user.update({ last_login: new Date() });

    // Audit log
    await AuditLog.create({
      user_id: user.id,
      action: 'login',
      resource: 'auth',
      ip_address: req.ip,
    });

    return success(res, {
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role.name,
        role_display: user.role.display_name,
        facility_id: user.facility_id,
      },
      ...tokens,
    }, 'Login successful');
  } catch (err) {
    console.error('Login error:', err);
    return error(res, 'Server error', 500);
  }
};

exports.refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return error(res, 'Refresh token required', 400);
    }

    const storedToken = await RefreshToken.findOne({
      where: { token: refreshToken, revoked: false },
    });

    if (!storedToken || new Date() > storedToken.expires_at) {
      return error(res, 'Invalid or expired refresh token', 401);
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.userId, {
      include: [{ model: Role, as: 'role' }],
    });

    if (!user) {
      return error(res, 'Invalid or expired refresh token', 401);
    }

    if (!user.is_active) {
      await storedToken.update({ revoked: true });
      return error(
        res,
        'Your account has been deactivated. Contact your system administrator.',
        403
      );
    }

    // Revoke old token and issue new ones
    await storedToken.update({ revoked: true });
    const tokens = generateTokens(user);

    await RefreshToken.create({
      id: uuidv4(),
      user_id: user.id,
      token: tokens.refreshToken,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    return success(res, tokens, 'Token refreshed');
  } catch (err) {
    return error(res, 'Invalid token', 401);
  }
};

exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await RefreshToken.update({ revoked: true }, { where: { token: refreshToken } });
    }

    await AuditLog.create({
      user_id: req.user.id,
      action: 'logout',
      resource: 'auth',
      ip_address: req.ip,
    });

    return success(res, null, 'Logged out successfully');
  } catch (err) {
    return error(res, 'Server error', 500);
  }
};

exports.me = async (req, res) => {
  const user = req.user;
  return success(res, {
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    role: user.role.name,
    role_display: user.role.display_name,
    facility_id: user.facility_id,
  });
};
