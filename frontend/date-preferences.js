function localParts(instant, timeZone) {
  if (!timeZone) {
    return {
      year: instant.getFullYear(),
      month: instant.getMonth() + 1,
      day: instant.getDate()
    };
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function isoDate({ year, month, day }) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function dateInputValue(instant = new Date(), timeZone = null) {
  return isoDate(localParts(instant, timeZone));
}

export function budgetMonthValue(dateValue, resetDay) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day >= Math.min(resetDay, lastDay)) return `${year}-${String(month).padStart(2, '0')}`;
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function formatDate(dateValue, dateFormat = 'YYYY-MM-DD') {
  const [year, month, day] = String(dateValue).slice(0, 10).split('-');
  if (dateFormat === 'DD/MM/YYYY') return `${day}/${month}/${year}`;
  if (dateFormat === 'MM/DD/YYYY') return `${month}/${day}/${year}`;
  return `${year}-${month}-${day}`;
}
