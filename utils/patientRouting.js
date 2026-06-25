const {
  EMERGENCY_UNIT_DEPARTMENT,
  isValidRoutingDestination,
  routingLabel,
} = require('../config/clinicQueueDepartments');
const {
  MAX_PEDIATRIC_AGE_EXCLUSIVE,
  ageFromDateOfBirth,
} = require('../config/pediatricCorner');

const PAP_SMEAR_DEPARTMENT = 'pap_smear';
const PEDIATRIC_DEPARTMENT = 'pediatric';

function parseFlag(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function isMaleSex(sex) {
  const value = String(sex || '').toLowerCase();
  return value === 'male' || value === 'm';
}

function assertPapSmearEligibleForPatient(sex, destination) {
  if (destination === PAP_SMEAR_DEPARTMENT && isMaleSex(sex)) {
    const err = new Error('Pap Smear routing is not available for male patients');
    err.statusCode = 400;
    throw err;
  }
}

function isPediatricEligible(dateOfBirth) {
  const age = ageFromDateOfBirth(dateOfBirth);
  if (age == null) return false;
  return age < MAX_PEDIATRIC_AGE_EXCLUSIVE;
}

function assertPediatricEligibleForPatient(dateOfBirth, destination) {
  if (destination !== PEDIATRIC_DEPARTMENT) return;

  if (!isPediatricEligible(dateOfBirth)) {
    const age = ageFromDateOfBirth(dateOfBirth);
    const err = age == null
      ? new Error('Pediatric routing requires a valid date of birth for patients under 12 years')
      : new Error(`Pediatric routing is only available for patients under ${MAX_PEDIATRIC_AGE_EXCLUSIVE} years`);
    err.statusCode = 400;
    throw err;
  }
}

/**
 * Resolve queue department and priority from front office intake payload.
 * - immediate_triage → Emergency Unit (priority emergency)
 * - otherwise → selected routing_destination (required for non-immediate)
 */
function resolveFrontOfficeRouting(body = {}) {
  const isEmergency = parseFlag(body.is_emergency);
  const immediateTriage = parseFlag(body.immediate_triage);

  if (immediateTriage) {
    return {
      department: EMERGENCY_UNIT_DEPARTMENT,
      priority: 'emergency',
      immediateTriage: true,
      isEmergency: true,
      routingLabel: routingLabel(EMERGENCY_UNIT_DEPARTMENT),
    };
  }

  const destination = body.routing_destination;
  if (!destination || !isValidRoutingDestination(destination)) {
    const err = new Error('Select a routing destination before sending the patient to queue');
    err.statusCode = 400;
    throw err;
  }

  assertPapSmearEligibleForPatient(body.sex, destination);
  assertPediatricEligibleForPatient(body.date_of_birth, destination);

  return {
    department: destination,
    priority: isEmergency ? 'emergency' : 'normal',
    immediateTriage: false,
    isEmergency,
    routingLabel: routingLabel(destination),
  };
}

function buildIntakeNotes(body, routing) {
  const parts = [
    body.mode_of_arrival && `Mode of arrival: ${body.mode_of_arrival}`,
    body.accompanied_by && `Accompanied by: ${body.accompanied_by}`,
    routing.immediateTriage && 'Immediate triage emergency',
    routing.isEmergency && !routing.immediateTriage && 'Emergency case classification',
    routing.routingLabel && `Routed to: ${routing.routingLabel}`,
  ];
  return parts.filter(Boolean).join('; ') || null;
}

function emitQueueEvents(io, routing, { queueEntry, patient, visit }) {
  io.to(`room:${routing.department}`).emit('queue:new_patient', {
    queueEntry,
    patient,
    visit,
  });

  if (routing.immediateTriage) {
    io.to(`room:${EMERGENCY_UNIT_DEPARTMENT}`).emit('emergency:override', {
      queueEntry,
      patient,
      visit,
    });
  }
}

module.exports = {
  parseFlag,
  resolveFrontOfficeRouting,
  buildIntakeNotes,
  emitQueueEvents,
  EMERGENCY_UNIT_DEPARTMENT,
};
