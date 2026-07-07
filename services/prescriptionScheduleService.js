'use strict';

const SCHEDULE_TYPES = ['once_off', 'monthly_day', 'recurring_weekdays', 'recurring_dates'];

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function ordinalDay(day) {
  const n = Number(day);
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function normalizeWeekdays(value) {
  if (!value) return [];
  let raw = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const unique = [...new Set(raw.map((d) => parseInt(d, 10)).filter((d) => d >= 0 && d <= 6))];
  return unique.sort((a, b) => a - b);
}

function normalizeRecurringDates(value) {
  if (!value) return [];
  let raw = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const unique = [...new Set(
    raw
      .map((d) => String(d || '').trim())
      .filter((d) => ISO_DATE_RE.test(d))
  )];
  return unique.sort();
}

function formatRecurringDateLabel(isoDate) {
  if (!ISO_DATE_RE.test(isoDate)) return isoDate;
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function validateScheduleFields(item, { medicationName } = {}) {
  const label = medicationName || item.medication_name || 'Medication';
  const schedule_type = SCHEDULE_TYPES.includes(item.schedule_type) ? item.schedule_type : 'once_off';

  if (schedule_type === 'once_off') {
    return {
      schedule_type,
      recurring_day_of_month: null,
      recurring_weekdays: null,
      recurring_dates: null,
      schedule_active: true,
    };
  }

  if (schedule_type === 'monthly_day') {
    const day = parseInt(item.recurring_day_of_month, 10);
    if (!day || day < 1 || day > 31) {
      const err = new Error(`${label}: select the day of the month (1–31) for monthly dispensing`);
      err.statusCode = 400;
      throw err;
    }
    return {
      schedule_type,
      recurring_day_of_month: day,
      recurring_weekdays: null,
      recurring_dates: null,
      schedule_active: true,
    };
  }

  if (schedule_type === 'recurring_weekdays') {
    const weekdays = normalizeWeekdays(item.recurring_weekdays);
    if (!weekdays.length) {
      const err = new Error(`${label}: select at least one weekday for recurring dispensing`);
      err.statusCode = 400;
      throw err;
    }
    return {
      schedule_type,
      recurring_day_of_month: null,
      recurring_weekdays: weekdays,
      recurring_dates: null,
      schedule_active: true,
    };
  }

  if (schedule_type === 'recurring_dates') {
    const dates = normalizeRecurringDates(item.recurring_dates);
    if (!dates.length) {
      const err = new Error(`${label}: add at least one date for recurring dispensing`);
      err.statusCode = 400;
      throw err;
    }
    return {
      schedule_type,
      recurring_day_of_month: null,
      recurring_weekdays: null,
      recurring_dates: dates,
      schedule_active: true,
    };
  }

  const err = new Error(`${label}: invalid dispensing schedule`);
  err.statusCode = 400;
  throw err;
}

function formatScheduleLabel(item) {
  const row = item?.toJSON ? item.toJSON() : item;
  const schedule_type = row.schedule_type || 'once_off';
  const active = row.schedule_active !== false;

  if (schedule_type === 'once_off') {
    return 'Once-off';
  }

  if (schedule_type === 'monthly_day') {
    const day = row.recurring_day_of_month;
    if (!day) return 'Monthly (day not set)';
    const base = `Monthly on the ${ordinalDay(day)}`;
    return active ? base : `${base} (stopped)`;
  }

  if (schedule_type === 'recurring_weekdays') {
    const days = normalizeWeekdays(row.recurring_weekdays)
      .map((d) => WEEKDAY_LABELS[d])
      .join(', ');
    const base = days ? `Every ${days}` : 'Recurring (days not set)';
    return active ? `${base} until patient is better` : `${base} (stopped)`;
  }

  if (schedule_type === 'recurring_dates') {
    const dates = normalizeRecurringDates(row.recurring_dates);
    if (!dates.length) return 'Selected dates (not set)';
    const formatted = dates.map((d) => formatRecurringDateLabel(d));
    const base = formatted.length <= 3
      ? formatted.join('; ')
      : `${formatted.slice(0, 2).join('; ')}; +${formatted.length - 2} more`;
    return active ? `${base} until patient is better` : `${base} (stopped)`;
  }

  return 'Once-off';
}

function isRecurringSchedule(item) {
  const schedule_type = item?.schedule_type || 'once_off';
  return schedule_type !== 'once_off' && item?.schedule_active !== false;
}

module.exports = {
  SCHEDULE_TYPES,
  WEEKDAY_LABELS,
  normalizeWeekdays,
  normalizeRecurringDates,
  validateScheduleFields,
  formatScheduleLabel,
  isRecurringSchedule,
};
