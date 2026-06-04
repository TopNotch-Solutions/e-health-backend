/**
 * Clinic Family Planning Suite — reproductive health queue and pharmacy routing.
 */

const FAMILY_PLANNING_DEPARTMENT = 'family_planning';
const PHARMACY_DEPARTMENT = 'pharmacy';

const INTERVENTION_TYPES = ['subdermal', 'device', 'oral'];
const INTERVENTION_TYPE_SET = new Set(INTERVENTION_TYPES);

function parseOralLog(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isValidInterventionType(value) {
  return INTERVENTION_TYPE_SET.has(value);
}

function inferInterventionType(body) {
  if (body.intervention_type && isValidInterventionType(body.intervention_type)) {
    return body.intervention_type;
  }
  const oral = parseOralLog(body.oral_contraceptive_log);
  if (oral.length > 0) return 'oral';
  if (
    (body.device_insertion_notes || '').trim()
    || (body.device_removal_notes || '').trim()
    || body.device_insertion_date
    || body.device_removal_date
  ) {
    return 'device';
  }
  if (
    (body.subdermal_insertion_notes || '').trim()
    || (body.subdermal_replacement_notes || '').trim()
    || body.subdermal_insertion_date
    || body.subdermal_replacement_date
  ) {
    return 'subdermal';
  }
  return null;
}

function hasContentForType(type, body) {
  const oral = parseOralLog(body.oral_contraceptive_log).filter(
    (e) => e.distributed_date || e.tablet_count != null || (e.notes || '').trim()
  );

  if (type === 'subdermal') {
    return Boolean(
      (body.subdermal_insertion_notes || '').trim()
      || (body.subdermal_replacement_notes || '').trim()
    );
  }
  if (type === 'device') {
    return Boolean(
      (body.device_insertion_notes || '').trim()
      || (body.device_removal_notes || '').trim()
    );
  }
  if (type === 'oral') {
    return oral.length > 0;
  }
  return false;
}

function validateRecordFields(body) {
  const type = inferInterventionType(body);
  if (!type) {
    return 'Select one intervention type: subdermal, intrauterine/barrier device, or oral contraceptives';
  }
  if (!hasContentForType(type, body)) {
    if (type === 'subdermal') {
      return 'Document subdermal insertion or replacement details';
    }
    if (type === 'device') {
      return 'Document device insertion or removal details';
    }
    return 'Add at least one oral contraceptive distribution or refill entry';
  }
  return null;
}

function payloadForInterventionType(type, body) {
  const empty = {
    intervention_type: type,
    subdermal_insertion_date: null,
    subdermal_insertion_notes: null,
    subdermal_replacement_date: null,
    subdermal_replacement_notes: null,
    device_type: null,
    device_insertion_date: null,
    device_insertion_notes: null,
    device_removal_date: null,
    device_removal_notes: null,
    oral_contraceptive_log: [],
    circumcision_surgical_criteria: null,
    circumcision_procedure_notes: null,
    circumcision_post_op_metrics: null,
  };

  if (type === 'subdermal') {
    return {
      ...empty,
      subdermal_insertion_date: body.subdermal_insertion_date || null,
      subdermal_insertion_notes: body.subdermal_insertion_notes?.trim() || null,
      subdermal_replacement_date: body.subdermal_replacement_date || null,
      subdermal_replacement_notes: body.subdermal_replacement_notes?.trim() || null,
    };
  }

  if (type === 'device') {
    return {
      ...empty,
      device_type: body.device_type?.trim() || null,
      device_insertion_date: body.device_insertion_date || null,
      device_insertion_notes: body.device_insertion_notes?.trim() || null,
      device_removal_date: body.device_removal_date || null,
      device_removal_notes: body.device_removal_notes?.trim() || null,
    };
  }

  return {
    ...empty,
    oral_contraceptive_log: parseOralLog(body.oral_contraceptive_log),
  };
}

function isSessionFinalized(record) {
  if (!record) return false;
  return Boolean(record.session_completed_at || record.routed_to_pharmacy_at);
}

module.exports = {
  FAMILY_PLANNING_DEPARTMENT,
  PHARMACY_DEPARTMENT,
  INTERVENTION_TYPES,
  parseOralLog,
  inferInterventionType,
  isValidInterventionType,
  validateRecordFields,
  payloadForInterventionType,
  isSessionFinalized,
};
