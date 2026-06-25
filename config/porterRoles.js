'use strict';

const { ROLES } = require('./roles');

/** Legacy porter slug — treated as internal porter. */
const INTERNAL_PORTER_ROLE_SLUGS = [ROLES.PORTER, ROLES.INTERNAL_PORTER];
const EXTERNAL_PORTER_ROLE_SLUGS = [ROLES.EXTERNAL_PORTER];

const INTERNAL_PORTER_SOCKET_ROOM = 'room:internal_porter';
const EXTERNAL_PORTER_SOCKET_ROOM = 'room:external_porter';
const LEGACY_PORTER_SOCKET_ROOM = 'room:porter';

function isInternalPorterRole(roleName) {
  return INTERNAL_PORTER_ROLE_SLUGS.includes(roleName);
}

function isExternalPorterRole(roleName) {
  return EXTERNAL_PORTER_ROLE_SLUGS.includes(roleName);
}

function isAnyPorterRole(roleName) {
  return isInternalPorterRole(roleName) || isExternalPorterRole(roleName);
}

function transportScopeForRole(roleName) {
  if (isInternalPorterRole(roleName)) return 'internal';
  if (isExternalPorterRole(roleName)) return 'external';
  return null;
}

function assertRoleMatchesTransportScope(roleName, transportScope) {
  const expected = transportScopeForRole(roleName);
  if (!expected) {
    const err = new Error('Only porter staff can manage transport jobs');
    err.statusCode = 403;
    throw err;
  }
  if (expected !== transportScope) {
    const err = new Error(
      transportScope === 'external'
        ? 'This job is for external ambulance porters only'
        : 'This job is for internal porters only'
    );
    err.statusCode = 403;
    throw err;
  }
}

function emitTransportSocketRefresh(io, transportScope, event, payload) {
  if (!io) return;
  if (transportScope === 'external') {
    io.to(EXTERNAL_PORTER_SOCKET_ROOM).emit(event, payload);
    return;
  }
  io.to(INTERNAL_PORTER_SOCKET_ROOM).emit(event, payload);
  io.to(LEGACY_PORTER_SOCKET_ROOM).emit(event, payload);
}

module.exports = {
  INTERNAL_PORTER_ROLE_SLUGS,
  EXTERNAL_PORTER_ROLE_SLUGS,
  INTERNAL_PORTER_SOCKET_ROOM,
  EXTERNAL_PORTER_SOCKET_ROOM,
  LEGACY_PORTER_SOCKET_ROOM,
  isInternalPorterRole,
  isExternalPorterRole,
  isAnyPorterRole,
  transportScopeForRole,
  assertRoleMatchesTransportScope,
  emitTransportSocketRefresh,
};
