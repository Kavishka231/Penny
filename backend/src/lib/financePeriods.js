import { query } from '../db.js';

function dateParts(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!match) throw new Error(`Invalid date value: ${value}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3] || 1)
  };
}

function shiftMonth(year, month, offset) {
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function resetDate(year, month, resetDay) {
  return isoDate(year, month, Math.min(resetDay, daysInMonth(year, month)));
}

export function dateInTimeZone(timeZone, instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function calendarMonthPeriod(timeZone, instant = new Date()) {
  const { year, month } = dateParts(dateInTimeZone(timeZone, instant));
  const next = shiftMonth(year, month, 1);
  return {
    key: isoDate(year, month, 1),
    start: isoDate(year, month, 1),
    end: isoDate(next.year, next.month, 1)
  };
}

export function budgetPeriodForMonth(monthValue, resetDay) {
  const { year, month } = dateParts(monthValue);
  const next = shiftMonth(year, month, 1);
  return {
    key: isoDate(year, month, 1),
    start: resetDate(year, month, resetDay),
    end: resetDate(next.year, next.month, resetDay)
  };
}

export function currentBudgetPeriod(timeZone, resetDay, instant = new Date()) {
  const localDate = dateInTimeZone(timeZone, instant);
  const current = budgetPeriodForMonth(localDate, resetDay);
  if (localDate >= current.start) return current;

  const { year, month } = dateParts(localDate);
  const previous = shiftMonth(year, month, -1);
  return budgetPeriodForMonth(isoDate(previous.year, previous.month, 1), resetDay);
}

export function recentCalendarMonths(timeZone, instant = new Date(), count = 6) {
  const current = calendarMonthPeriod(timeZone, instant);
  const { year, month } = dateParts(current.start);
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  });

  return Array.from({ length: count }, (_, index) => {
    const value = shiftMonth(year, month, index - count + 1);
    const next = shiftMonth(value.year, value.month, 1);
    const key = `${value.year}-${String(value.month).padStart(2, '0')}`;
    return {
      key,
      label: formatter.format(new Date(`${key}-01T00:00:00Z`)),
      start: isoDate(value.year, value.month, 1),
      end: isoDate(next.year, next.month, 1)
    };
  });
}

export function transactionDateKey(value) {
  if (typeof value === 'string') return value.slice(0, 10);
  return isoDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

export async function financePreferencesForUser(userId) {
  const result = await query(
    `SELECT timezone, budget_reset_day, date_format
     FROM users
     WHERE id = $1`,
    [userId]
  );
  if (!result.rowCount) throw Object.assign(new Error('Profile not found'), { status: 404 });
  return {
    timeZone: result.rows[0].timezone || 'UTC',
    budgetResetDay: Number(result.rows[0].budget_reset_day) || 1,
    dateFormat: result.rows[0].date_format || 'YYYY-MM-DD'
  };
}
