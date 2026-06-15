/** Hospital billing shifts: 08:00 + 12h, then 20:00 + 12h (local server time). */
const DAY_START_HOUR = 8;
const SHIFT_HOURS = 12;

/** Clinic billing clerk shift: 08:00–17:00 daily. */
const CLINIC_SHIFT_START_HOUR = 8;
const CLINIC_SHIFT_END_HOUR = 17;

function atLocalHour(baseDate, hour, minute = 0) {
  const d = new Date(baseDate);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function getHospitalShiftWindow(at = new Date()) {
  const now = new Date(at);
  const hour = now.getHours();

  if (hour >= DAY_START_HOUR && hour < DAY_START_HOUR + SHIFT_HOURS) {
    const shift_start = atLocalHour(now, DAY_START_HOUR);
    const shift_end = atLocalHour(now, DAY_START_HOUR + SHIFT_HOURS);
    return {
      slot: 'day',
      shift_start,
      shift_end,
      label: 'Day shift (08:00 – 20:00)',
      facility_type: 'hospital',
    };
  }

  let shift_start;
  let shift_end;
  const nightStartHour = DAY_START_HOUR + SHIFT_HOURS;
  if (hour >= nightStartHour) {
    shift_start = atLocalHour(now, nightStartHour);
    shift_end = atLocalHour(now, DAY_START_HOUR);
    shift_end.setDate(shift_end.getDate() + 1);
  } else {
    shift_end = atLocalHour(now, DAY_START_HOUR);
    shift_start = atLocalHour(now, nightStartHour);
    shift_start.setDate(shift_start.getDate() - 1);
  }

  return {
    slot: 'night',
    shift_start,
    shift_end,
    label: 'Night shift (20:00 – 08:00)',
    facility_type: 'hospital',
  };
}

function getClinicShiftWindow(at = new Date()) {
  const now = new Date(at);
  const shift_start = atLocalHour(now, CLINIC_SHIFT_START_HOUR);
  const shift_end = atLocalHour(now, CLINIC_SHIFT_END_HOUR);

  return {
    slot: 'day',
    shift_start,
    shift_end,
    label: 'Clinic shift (08:00 – 17:00)',
    facility_type: 'clinic',
  };
}

/**
 * @param {Date} [at]
 * @param {{ facilityType?: string }} [options]
 * @returns {{ slot: 'day'|'night', shift_start: Date, shift_end: Date, label: string, facility_type?: string }}
 */
function getShiftWindow(at = new Date(), { facilityType } = {}) {
  if (facilityType === 'clinic') {
    return getClinicShiftWindow(at);
  }
  return getHospitalShiftWindow(at);
}

module.exports = {
  DAY_START_HOUR,
  SHIFT_HOURS,
  CLINIC_SHIFT_START_HOUR,
  CLINIC_SHIFT_END_HOUR,
  getShiftWindow,
  getHospitalShiftWindow,
  getClinicShiftWindow,
};
