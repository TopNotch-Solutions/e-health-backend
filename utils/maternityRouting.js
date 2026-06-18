'use strict';

const { parseFlag, buildIntakeNotes } = require('./patientRouting');
const {
  MATERNITY_DEPARTMENTS,
  FRONT_OFFICE_ROUTING,
  DEPARTMENT_LABELS,
} = require('../config/maternityConfig');

function resolveMaternityFrontOfficeRouting(body = {}) {
  const isEmergency = parseFlag(body.is_emergency);
  const immediateTriage = parseFlag(body.immediate_triage);

  if (immediateTriage) {
    return {
      department: MATERNITY_DEPARTMENTS.ICU,
      priority: 'emergency',
      immediateTriage: true,
      isEmergency: true,
      routingLabel: DEPARTMENT_LABELS[MATERNITY_DEPARTMENTS.ICU],
    };
  }

  const destination = body.routing_destination;
  const validDests = FRONT_OFFICE_ROUTING.map((r) => r.value);
  if (!destination || !validDests.includes(destination)) {
    const err = new Error('Select ANC or ANW before routing the patient');
    err.statusCode = 400;
    throw err;
  }

  return {
    department: destination,
    priority: isEmergency ? 'emergency' : 'normal',
    immediateTriage: false,
    isEmergency,
    routingLabel: DEPARTMENT_LABELS[destination],
  };
}

function buildMaternityAddress(body = {}) {
  const addressParts = [body.address, body.city, body.region].filter(Boolean);
  const base = addressParts.join(', ');
  const physicalNotes = body.physical_notes?.trim();
  if (!base && !physicalNotes) return null;
  return (
    base + (physicalNotes ? `\n[Physical notes: ${physicalNotes}]` : '')
  ).trim() || null;
}

function assertMaternityEligibleSex(sex) {
  const value = String(sex || '').toLowerCase();
  if (value === 'male' || value === 'm') {
    const err = new Error('Maternity front office is for female patients only. Male patients cannot be registered here.');
    err.statusCode = 400;
    throw err;
  }
  if (value !== 'female' && value !== 'f') {
    const err = new Error('Only female patients can be registered at maternity front office.');
    err.statusCode = 400;
    throw err;
  }
}

module.exports = {
  resolveMaternityFrontOfficeRouting,
  buildMaternityAddress,
  buildIntakeNotes,
  assertMaternityEligibleSex,
};
