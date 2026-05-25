function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function buildHourlySlots() {
  const endHour = new Date().getHours();
  const slots = [];
  for (let h = 0; h <= endHour; h += 1) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
  }
  return slots;
}

function mapHourlyCounts(rows, hourKey = 'hour', countKey = 'count') {
  const byHour = {};
  for (const row of rows) {
    const h = Number(row[hourKey]);
    if (!Number.isNaN(h)) byHour[h] = Number(row[countKey]) || 0;
  }
  return byHour;
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function staffDisplayName(row) {
  return [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || 'Staff';
}

function buildVelocityFromRows(hourSlots, hourRows) {
  const byHour = mapHourlyCounts(hourRows);
  return hourSlots.map((hour) => {
    const h = parseInt(hour.slice(0, 2), 10);
    return { hour, count: byHour[h] || 0 };
  });
}

module.exports = {
  startOfDay,
  endOfDay,
  buildHourlySlots,
  mapHourlyCounts,
  formatTime,
  staffDisplayName,
  buildVelocityFromRows,
};
