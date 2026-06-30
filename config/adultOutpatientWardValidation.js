'use strict';

const { ADMIT_TRANSPORT_CHECKLIST_OPTIONS } = require('../constants/admitTransportChecklist');

const EQUIPMENT_VALUES = ['wheelchair', 'stretcher', 'bed', 'walking', 'other'];
const REQUIRED_TRANSPORT_CHECKLIST_IDS = ['id_band', 'mobility_match', 'rails_bed'];

const TRANSFER_WARD_TYPES = ['general', 'icu', 'specialized_inpatient'];

function parseRequiredNumber(value, { min, max, label }) {
  if (value === null || value === undefined || value === '') {
    return { error: `${label} is required` };
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return { error: `${label} must be a valid number` };
  }
  if (min != null && n < min) {
    return { error: `${label} must be at least ${min}` };
  }
  if (max != null && n > max) {
    return { error: `${label} must be at most ${max}` };
  }
  return { value: n };
}

function validationFailure(errors) {
  const err = new Error(errors.map((e) => e.message).join(' '));
  err.statusCode = 400;
  err.validationErrors = errors;
  return err;
}

function validateAdultOutpatientDailyRecord(body = {}) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });

  const hr = parseRequiredNumber(body.heart_rate, { min: 20, max: 300, label: 'Heart rate' });
  if (hr.error) add('heart_rate', hr.error);

  const spo2 = parseRequiredNumber(body.oxygen_saturation, { min: 0, max: 100, label: 'Oxygen saturation' });
  if (spo2.error) add('oxygen_saturation', spo2.error);

  const rr = parseRequiredNumber(body.respiration_rate, { min: 4, max: 80, label: 'Respiration rate' });
  if (rr.error) add('respiration_rate', rr.error);

  const temp = parseRequiredNumber(body.body_temperature, { min: 30, max: 45, label: 'Body temperature' });
  if (temp.error) add('body_temperature', temp.error);

  const sys = parseRequiredNumber(body.blood_pressure_systolic, {
    min: 50,
    max: 300,
    label: 'Blood pressure (systolic)',
  });
  if (sys.error) add('blood_pressure_systolic', sys.error);

  const dia = parseRequiredNumber(body.blood_pressure_diastolic, {
    min: 30,
    max: 200,
    label: 'Blood pressure (diastolic)',
  });
  if (dia.error) add('blood_pressure_diastolic', dia.error);

  if (!sys.error && !dia.error && sys.value <= dia.value) {
    add('blood_pressure_systolic', 'Systolic blood pressure must be higher than diastolic');
  }

  if (errors.length) throw validationFailure(errors);
}

function checklistSelection(equipment_checklist) {
  if (!Array.isArray(equipment_checklist)) return [];
  const allowed = new Set(ADMIT_TRANSPORT_CHECKLIST_OPTIONS.map((o) => o.id));
  return equipment_checklist
    .filter((row) => row && row.checked && allowed.has(row.id))
    .map((row) => row.id);
}

function validateAdultOutpatientPorterTransport(transport = {}) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });

  const equipment = transport.equipment_required || 'stretcher';
  if (!EQUIPMENT_VALUES.includes(equipment)) {
    add('equipment_required', 'Select a valid equipment / transport mode');
  }

  if (equipment === 'other' && !String(transport.equipment_notes ?? '').trim()) {
    add('equipment_notes', 'Equipment notes are required when mode is Other');
  }

  if (!String(transport.critical_notes ?? '').trim()) {
    add('critical_notes', 'Critical notes for the porter are required');
  }

  const checked = checklistSelection(transport.equipment_checklist);
  for (const id of REQUIRED_TRANSPORT_CHECKLIST_IDS) {
    if (!checked.includes(id)) {
      const label = ADMIT_TRANSPORT_CHECKLIST_OPTIONS.find((o) => o.id === id)?.label || id;
      add('equipment_checklist', `Checklist required: ${label}`);
      break;
    }
  }

  if (errors.length) throw validationFailure(errors);
}

function validateAdultOutpatientMortuaryTransfer({ cause_of_death, transport } = {}) {
  const errors = [];
  if (!String(cause_of_death ?? '').trim()) {
    errors.push({ field: 'cause_of_death', message: 'Cause of death is required' });
  }

  try {
    validateAdultOutpatientPorterTransport(transport);
  } catch (err) {
    if (err.validationErrors) {
      errors.push(...err.validationErrors);
    } else {
      throw err;
    }
  }

  if (errors.length) throw validationFailure(errors);
}

function validateAdultOutpatientWardTransfer({ target_ward_type, transport } = {}) {
  const errors = [];
  if (!TRANSFER_WARD_TYPES.includes(target_ward_type)) {
    errors.push({ field: 'target_ward_type', message: 'Select a valid transfer destination' });
  }

  try {
    validateAdultOutpatientPorterTransport(transport);
  } catch (err) {
    if (err.validationErrors) {
      errors.push(...err.validationErrors);
    } else {
      throw err;
    }
  }

  if (errors.length) throw validationFailure(errors);
}

function validateAdultOutpatientDischarge({ discharge_notes } = {}) {
  if (!String(discharge_notes ?? '').trim()) {
    throw validationFailure([{ field: 'discharge_notes', message: 'Discharge notes are required' }]);
  }
}

module.exports = {
  TRANSFER_WARD_TYPES,
  validateAdultOutpatientDailyRecord,
  validateAdultOutpatientPorterTransport,
  validateAdultOutpatientMortuaryTransfer,
  validateAdultOutpatientWardTransfer,
  validateAdultOutpatientDischarge,
};
