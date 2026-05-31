const {
  EMERGENCY_UNIT_DEPARTMENT,
  isValidRoutingDestination,
  routingLabel,
} = require('../config/clinicQueueDepartments');

function parseFlag(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
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
