'use strict';

/** Maximum time a clinic outpatient visit may remain active after front office intake. */
const CLINIC_VISIT_MAX_HOURS = 24;
const CLINIC_VISIT_MAX_MS = CLINIC_VISIT_MAX_HOURS * 60 * 60 * 1000;

const AUTO_CLOSE_QUEUE_NOTE =
  'Auto-closed: 24-hour clinic visit window expired since front office intake.';

const HOSPITAL_AUTO_CLOSE_QUEUE_NOTE =
  'Auto-closed: 24-hour hospital visit window expired since front office intake.';

module.exports = {
  CLINIC_VISIT_MAX_HOURS,
  CLINIC_VISIT_MAX_MS,
  AUTO_CLOSE_QUEUE_NOTE,
  HOSPITAL_AUTO_CLOSE_QUEUE_NOTE,
};
