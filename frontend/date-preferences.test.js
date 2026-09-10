import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetMonthValue, dateInputValue, formatDate } from './date-preferences.js';

test('formats date-only values using each supported profile format', () => {
  assert.equal(formatDate('2026-09-05', 'YYYY-MM-DD'), '2026-09-05');
  assert.equal(formatDate('2026-09-05', 'DD/MM/YYYY'), '05/09/2026');
  assert.equal(formatDate('2026-09-05', 'MM/DD/YYYY'), '09/05/2026');
});

test('initializes date inputs from the selected timezone instead of UTC', () => {
  const instant = new Date('2026-01-01T00:30:00Z');
  assert.equal(dateInputValue(instant, 'America/New_York'), '2025-12-31');
  assert.equal(dateInputValue(instant, 'Asia/Colombo'), '2026-01-01');
});

test('selects the active budget month and clamps missing reset days', () => {
  assert.equal(budgetMonthValue('2026-03-01', 1), '2026-03');
  assert.equal(budgetMonthValue('2026-03-14', 15), '2026-02');
  assert.equal(budgetMonthValue('2026-03-15', 15), '2026-03');
  assert.equal(budgetMonthValue('2025-02-28', 31), '2025-02');
});
