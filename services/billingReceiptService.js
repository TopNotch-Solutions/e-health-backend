const { Facility, User } = require('../models');
const billingChargeService = require('./billingChargeService');
const { loadBillForFacility } = require('./billingFacilityGuard');

function formatPatientName(patient) {
  return [patient?.first_name, patient?.last_name].filter(Boolean).join(' ');
}

function formatUserName(user) {
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ');
}

function formatFacilityLocation(facility) {
  return [facility?.address, facility?.district, facility?.province].filter(Boolean).join(', ');
}

async function buildBillingReceipt(billId, facilityId) {
  const bill = await loadBillForFacility(billId, facilityId);

  if (bill.status !== 'paid') {
    const err = new Error('Receipt is available only after payment has been recorded');
    err.statusCode = 400;
    throw err;
  }

  const facility = await Facility.findByPk(facilityId, {
    attributes: ['id', 'name', 'type', 'address', 'province', 'district', 'phone'],
  });

  let clerk = null;
  if (bill.paid_by) {
    clerk = await User.findByPk(bill.paid_by, {
      attributes: ['id', 'first_name', 'last_name'],
    });
  }

  const patient = bill.patient;
  const items = (bill.items || []).map((item) => ({
    id: item.id,
    description: item.description,
    category: item.category,
    amount: billingChargeService.money(item.amount),
  }));

  return {
    receipt_number: bill.visit?.visit_number || bill.id,
    bill_id: bill.id,
    visit_id: bill.visit_id,
    visit_number: bill.visit?.visit_number,
    facility: {
      name: facility?.name || 'Health facility',
      type: facility?.type,
      location: formatFacilityLocation(facility),
      phone: facility?.phone || null,
    },
    patient: {
      id: patient?.id || null,
      name: formatPatientName(patient),
      patient_number: patient?.patient_number || null,
      id_number: patient?.id_number || null,
      phone: patient?.phone || null,
      payment_type: patient?.payment_type || 'private',
    },
    items,
    total_amount: billingChargeService.money(bill.total_amount),
    cash_paid: billingChargeService.money(bill.cash_paid),
    eft_paid: billingChargeService.money(bill.eft_paid),
    paid_at: bill.paid_at,
    received_by: clerk ? formatUserName(clerk) : null,
  };
}

module.exports = {
  buildBillingReceipt,
};
