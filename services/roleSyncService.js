'use strict';

const { ROLES, ROLE_PERMISSIONS } = require('../config/roles');
const { AUTHORIZED_CLINIC_ROLES, HOSPITAL_ROLE_LABELS } = require('../config/clinicRoles');
const { MATERNITY_ROLE_LABELS } = require('../config/maternityConfig');
const { ROLE_LABELS: HOSPITAL_OUTPATIENT_ROLE_LABELS } = require('../config/hospitalOutpatientConfig');
const { Role, sequelize } = require('../models');

function displayNameForRole(slug) {
  if (MATERNITY_ROLE_LABELS[slug]) return MATERNITY_ROLE_LABELS[slug];
  if (HOSPITAL_ROLE_LABELS[slug]) return HOSPITAL_ROLE_LABELS[slug];
  if (AUTHORIZED_CLINIC_ROLES[slug]) return AUTHORIZED_CLINIC_ROLES[slug];
  return slug
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Ensure every role defined in config/roles.js exists in the database
 * with role_permissions. Safe to call on every admin roles fetch.
 */
async function ensureRolesSynced(transaction = null) {
  const run = async (t) => {
    const [existingRows] = await sequelize.query(
      'SELECT id, name, display_name FROM roles',
      { transaction: t }
    );
    const byName = new Map(existingRows.map((r) => [r.name, r]));

    const [permissions] = await sequelize.query(
      'SELECT id, resource, action FROM permissions',
      { transaction: t }
    );

    for (const slug of Object.values(ROLES)) {
      let roleRow = byName.get(slug);

      if (!roleRow) {
        await sequelize.query(
          'INSERT INTO roles (name, display_name) VALUES (:name, :display_name)',
          {
            replacements: { name: slug, display_name: displayNameForRole(slug) },
            transaction: t,
          }
        );
        const [inserted] = await sequelize.query(
          'SELECT id, name, display_name FROM roles WHERE name = :name LIMIT 1',
          { replacements: { name: slug }, transaction: t }
        );
        roleRow = inserted[0];
        byName.set(slug, roleRow);
      } else {
        const label = displayNameForRole(slug);
        if (roleRow.display_name !== label) {
          await sequelize.query(
            'UPDATE roles SET display_name = :display_name WHERE id = :id',
            { replacements: { display_name: label, id: roleRow.id }, transaction: t }
          );
        }
      }

      const perms = ROLE_PERMISSIONS[slug];
      if (!perms || !roleRow?.id) continue;

      const [existingRp] = await sequelize.query(
        'SELECT permission_id FROM role_permissions WHERE role_id = :roleId',
        { replacements: { roleId: roleRow.id }, transaction: t }
      );
      const existingPermIds = new Set(existingRp.map((r) => r.permission_id));

      const rows = [];
      for (const [resource, actions] of Object.entries(perms)) {
        for (const action of actions) {
          const perm = permissions.find((p) => p.resource === resource && p.action === action);
          if (perm && !existingPermIds.has(perm.id)) {
            rows.push({ role_id: roleRow.id, permission_id: perm.id });
          }
        }
      }
      if (rows.length) {
        await sequelize.query(
          `INSERT INTO role_permissions (role_id, permission_id) VALUES ${rows.map(() => '(?, ?)').join(', ')}`,
          {
            replacements: rows.flatMap((r) => [r.role_id, r.permission_id]),
            transaction: t,
          }
        );
      }
    }
  };

  if (transaction) {
    await run(transaction);
    return;
  }

  await sequelize.transaction(run);
}

module.exports = {
  displayNameForRole,
  ensureRolesSynced,
};
