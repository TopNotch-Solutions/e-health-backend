'use strict';

const { v4: uuidv4 } = require('uuid');
const { Facility } = require('../models');

const NATIONAL_ADMIN_FACILITY_NAME = 'National Health Administration';

async function resolveNationalAdminFacility(transaction) {
  let facility = await Facility.findOne({
    where: { name: NATIONAL_ADMIN_FACILITY_NAME },
    transaction,
  });

  if (!facility) {
    facility = await Facility.create({
      id: uuidv4(),
      name: NATIONAL_ADMIN_FACILITY_NAME,
      type: 'health_center',
      province: 'National',
      district: 'Central Administration',
      address: 'National e-health administration office',
      phone: null,
    }, { transaction });
  }

  return facility;
}

module.exports = {
  NATIONAL_ADMIN_FACILITY_NAME,
  resolveNationalAdminFacility,
};
