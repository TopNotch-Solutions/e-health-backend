'use strict';

const { Op } = require('sequelize');
const { Facility } = require('../models');

function mapStateHospitalRow(facility) {
  const plain = typeof facility.toJSON === 'function' ? facility.toJSON() : facility;
  const location = [plain.district, plain.province].filter(Boolean).join(', ');
  return {
    id: plain.id,
    name: plain.name,
    type: plain.type,
    province: plain.province || null,
    district: plain.district || null,
    address: plain.address || null,
    location: location || plain.province || null,
    label: location ? `${plain.name} — ${location}` : plain.name,
  };
}

async function listStateHospitalFacilities({ excludeFacilityId = null } = {}) {
  const where = {
    type: { [Op.in]: ['hospital', 'health_center'] },
  };
  if (excludeFacilityId) {
    where.id = { [Op.ne]: excludeFacilityId };
  }

  const facilities = await Facility.findAll({
    where,
    attributes: ['id', 'name', 'type', 'province', 'district', 'address'],
    order: [['name', 'ASC']],
  });

  return facilities.map(mapStateHospitalRow);
}

module.exports = {
  mapStateHospitalRow,
  listStateHospitalFacilities,
};
