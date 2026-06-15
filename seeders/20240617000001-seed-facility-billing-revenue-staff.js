'use strict';

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { ROLES } = require('../config/roles');

const DEMO_PASSWORD = 'Demo123!';

function facilityEmailSlug(name, id) {
  const fromName = String(name || 'facility')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const shortId = String(id).replace(/-/g, '').slice(0, 8);
  return `${fromName || 'facility'}-${shortId}`;
}

module.exports = {
  async up(queryInterface) {
    const [facilities] = await queryInterface.sequelize.query(
      'SELECT id, name, type FROM facilities ORDER BY created_at ASC'
    );
    if (!facilities.length) {
      console.log('seed-facility-billing-revenue-staff: no facilities, skip.');
      return;
    }

    const [roles] = await queryInterface.sequelize.query(
      `SELECT id, name FROM roles WHERE name IN ('${ROLES.BILLING_CLERK}', '${ROLES.REVENUE_OFFICER}')`
    );
    const billingRole = roles.find((r) => r.name === ROLES.BILLING_CLERK);
    const revenueRole = roles.find((r) => r.name === ROLES.REVENUE_OFFICER);
    if (!billingRole || !revenueRole) {
      throw new Error('seed-facility-billing-revenue-staff: billing/revenue roles missing.');
    }

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const now = new Date();
    const toInsert = [];

    for (const facility of facilities) {
      const slug = facilityEmailSlug(facility.name, facility.id);
      const typeLabel = facility.type === 'clinic' ? 'Clinic' : 'Hospital';

      for (const spec of [
        {
          role: billingRole,
          local: `billing_clerk.${slug}`,
          last: `Billing Clerk (${facility.name})`,
          emp: `DEMO-BILLING-${slug.toUpperCase()}`,
        },
        {
          role: revenueRole,
          local: `revenue_officer.${slug}`,
          last: `Revenue Officer (${facility.name})`,
          emp: `DEMO-REVENUE-${slug.toUpperCase()}`,
        },
      ]) {
        const email = `${spec.local}@demo.ehealth.gov`;

        const [[existingByEmail]] = await queryInterface.sequelize.query(
          'SELECT id FROM users WHERE email = :email LIMIT 1',
          { replacements: { email } }
        );
        if (existingByEmail) continue;

        const [[existingAtFacility]] = await queryInterface.sequelize.query(
          `SELECT u.id FROM users u
           WHERE u.facility_id = :facilityId AND u.role_id = :roleId
           LIMIT 1`,
          { replacements: { facilityId: facility.id, roleId: spec.role.id } }
        );
        if (existingAtFacility) continue;

        toInsert.push({
          id: uuidv4(),
          facility_id: facility.id,
          role_id: spec.role.id,
          employee_id: spec.emp.slice(0, 50),
          first_name: 'Demo',
          last_name: spec.last,
          email,
          password_hash: passwordHash,
          phone: '+26461000000',
          is_active: true,
          last_login: null,
          created_at: now,
        });
      }

      console.log(
        `seed-facility-billing-revenue-staff: queued ${typeLabel} staff for ${facility.name}`
      );
    }

    if (toInsert.length) {
      await queryInterface.bulkInsert('users', toInsert);
      console.log(`seed-facility-billing-revenue-staff: created ${toInsert.length} user(s).`);
    } else {
      console.log('seed-facility-billing-revenue-staff: all facilities already have staff.');
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM users
       WHERE email LIKE 'billing_clerk.%@demo.ehealth.gov'
          OR email LIKE 'revenue_officer.%@demo.ehealth.gov'`
    );
  },
};
