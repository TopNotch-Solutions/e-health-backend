'use strict';

const { Patient, Facility, Bill, User, Visit } = require('../models');
const billingChargeService = require('./billingChargeService');
const {
  getAdminMedicalHistory,
  attachQueueStaffToHistory,
  clinicalDetailLines,
  userName,
  formatTs,
} = require('./patientMedicalExportService');

const USER_ATTRS = ['id', 'first_name', 'last_name'];

async function loadBillsForVisits(visitIds) {
  if (!visitIds.length) return new Map();

  const bills = await Bill.findAll({
    where: { visit_id: visitIds },
    include: [
      { association: 'items', separate: true, order: [['created_at', 'ASC']] },
      { model: User, as: 'paidByUser', attributes: USER_ATTRS, required: false },
    ],
  });

  return new Map(bills.map((bill) => [bill.visit_id, bill]));
}

function formatBilling(bill) {
  if (!bill) return null;

  return {
    status: bill.status,
    total_amount: billingChargeService.money(bill.total_amount),
    cash_paid: billingChargeService.money(bill.cash_paid),
    eft_paid: billingChargeService.money(bill.eft_paid),
    paid_at: bill.paid_at,
    received_by: userName(bill.paidByUser),
    items: (bill.items || []).map((item) => ({
      description: item.description,
      category: item.category,
      amount: billingChargeService.money(item.amount),
    })),
  };
}

function formatStop(stop) {
  const { _queueEntry, ...rest } = stop;
  return {
    department: rest.department,
    department_label: rest.department_label || rest.department,
    arrived_at: rest.arrived_at,
    started_at: rest.started_at,
    completed_at: rest.completed_at,
    attendees: rest.attendees || rest.assigned_to_name || '',
    routed_by: rest.routed_by || '',
    notes: rest.notes || '',
    clinical_details: clinicalDetailLines(rest.clinical),
  };
}

function formatVisit(visit, bill) {
  return {
    id: visit.id,
    visit_number: visit.visit_number,
    visit_type: visit.visit_type,
    status: visit.status,
    facility_name: visit.facility_name || '',
    started_at: visit.created_at,
    completed_at: visit.completed_at || null,
    stops: (visit.stops || []).map(formatStop),
    billing: formatBilling(bill),
  };
}

function formatFacility(facility) {
  if (!facility) return null;
  return {
    name: facility.name,
    type: facility.type,
    location: [facility.address, facility.district, facility.province].filter(Boolean).join(', '),
    phone: facility.phone || null,
  };
}

/**
 * Build printable patient medical card payload (with staff names and billing).
 * @param {string} patientId
 * @param {{ facilityId?: string|null, visitId?: string|null, allFacilities?: boolean }} options
 */
async function buildMedicalCardDocument(patientId, options = {}) {
  const { facilityId = null, visitId = null, allFacilities = false } = options;
  const resolvedFacilityId = allFacilities ? null : facilityId;

  const patient = await Patient.findByPk(patientId);
  if (!patient) {
    const err = new Error('Patient not found');
    err.status = 404;
    throw err;
  }

  if (visitId) {
    const visit = await Visit.findByPk(visitId, { attributes: ['id', 'patient_id', 'facility_id'] });
    if (!visit || visit.patient_id !== patientId) {
      const err = new Error('Visit not found');
      err.status = 404;
      throw err;
    }
    if (resolvedFacilityId && visit.facility_id !== resolvedFacilityId) {
      const err = new Error('This visit belongs to another facility');
      err.status = 403;
      throw err;
    }
  }

  let facility = null;
  if (resolvedFacilityId) {
    facility = await Facility.findByPk(resolvedFacilityId);
    if (!facility) {
      const err = new Error('Facility not found');
      err.status = 404;
      throw err;
    }
  } else if (visitId) {
    const visit = await Visit.findByPk(visitId, {
      include: [{ association: 'facility', attributes: ['id', 'name', 'type', 'address', 'province', 'district', 'phone'] }],
    });
    facility = visit?.facility || null;
  }

  const history = await attachQueueStaffToHistory(
    patientId,
    resolvedFacilityId,
    await getAdminMedicalHistory(patientId, resolvedFacilityId, 'all')
  );

  let visits = history.visits || [];
  if (visitId) {
    visits = visits.filter((visit) => visit.id === visitId);
  }

  const billByVisit = await loadBillsForVisits(visits.map((visit) => visit.id));

  const scope = visitId ? 'visit' : 'all';
  const patientName = [patient.first_name, patient.last_name].filter(Boolean).join(' ').trim();

  return {
    document_title: scope === 'visit' ? 'PATIENT MEDICAL CARD — CONSULTATION' : 'PATIENT MEDICAL CARD — FULL HISTORY',
    scope,
    generated_at: new Date().toISOString(),
    facility: formatFacility(facility) || {
      name: allFacilities ? 'All facilities' : 'Health facility',
      type: null,
      location: '',
      phone: null,
    },
    patient: {
      name: patientName,
      patient_number: patient.patient_number,
      id_number: patient.id_number,
      phone: patient.phone,
      sex: patient.sex,
      date_of_birth: patient.date_of_birth,
      payment_type: patient.payment_type,
    },
    visits: visits.map((visit) => formatVisit(visit, billByVisit.get(visit.id))),
    meta: {
      visit_count: visits.length,
      all_facilities: allFacilities,
      generated_label: formatTs(new Date().toISOString()),
    },
  };
}

module.exports = {
  buildMedicalCardDocument,
};
