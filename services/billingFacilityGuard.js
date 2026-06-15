const { Bill, Visit } = require('../models');

function facilityMismatchError() {
  const err = new Error('This record belongs to another facility');
  err.statusCode = 403;
  return err;
}

async function loadBillForFacility(billId, facilityId, transaction = null) {
  const bill = await Bill.findByPk(billId, {
    include: [
      {
        model: Visit,
        as: 'visit',
        attributes: ['id', 'facility_id', 'visit_number', 'status'],
        required: true,
      },
      { association: 'patient' },
      { association: 'items', separate: true, order: [['created_at', 'ASC']] },
    ],
    transaction,
  });

  if (!bill) {
    const err = new Error('Bill not found');
    err.statusCode = 404;
    throw err;
  }

  if (!facilityId || bill.visit?.facility_id !== facilityId) {
    throw facilityMismatchError();
  }

  return bill;
}

async function loadVisitForFacility(visitId, facilityId, transaction = null) {
  const visit = await Visit.findByPk(visitId, { transaction });
  if (!visit) {
    const err = new Error('Visit not found');
    err.statusCode = 404;
    throw err;
  }
  if (!facilityId || visit.facility_id !== facilityId) {
    throw facilityMismatchError();
  }
  return visit;
}

module.exports = {
  loadBillForFacility,
  loadVisitForFacility,
  facilityMismatchError,
};
