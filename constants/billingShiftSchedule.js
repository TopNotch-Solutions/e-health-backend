/** Fixed billing shifts: 08:00 + 12h, then 20:00 + 12h (local server time). */
const DAY_START_HOUR = 8;
const SHIFT_HOURS = 12;

function atLocalHour(baseDate, hour, minute = 0) {
  const d = new Date(baseDate);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/**
 * @param {Date} [at]
 * @returns {{ slot: 'day'|'night', shift_start: Date, shift_end: Date, label: string }}
 */
function getShiftWindow(at = new Date()) {
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
  };
}

module.exports = {
  DAY_START_HOUR,
  SHIFT_HOURS,
  getShiftWindow,
};
