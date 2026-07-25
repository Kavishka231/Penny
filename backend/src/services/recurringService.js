import { pool } from '../db.js';

function toDateString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function lastDayOfMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function getNextRunDate(currentDate, frequency) {
  const source = new Date(`${toDateString(currentDate)}T00:00:00Z`);
  let next = new Date(source);

  if (frequency === 'daily') {
    next.setUTCDate(next.getUTCDate() + 1);
  } else if (frequency === 'weekly') {
    next.setUTCDate(next.getUTCDate() + 7);
  } else if (frequency === 'monthly') {
    const targetYear = source.getUTCFullYear() + Math.floor((source.getUTCMonth() + 1) / 12);
    const targetMonth = (source.getUTCMonth() + 1) % 12;
    const day = Math.min(source.getUTCDate(), lastDayOfMonth(targetYear, targetMonth));
    next = new Date(Date.UTC(targetYear, targetMonth, day));
  } else if (frequency === 'yearly') {
    const targetYear = source.getUTCFullYear() + 1;
    const targetMonth = source.getUTCMonth();
    const day = Math.min(source.getUTCDate(), lastDayOfMonth(targetYear, targetMonth));
    next = new Date(Date.UTC(targetYear, targetMonth, day));
  } else {
    throw new Error(`Unsupported recurring frequency: ${frequency}`);
  }

  return next.toISOString().slice(0, 10);
}

export async function processDueRecurring(userId = null) {
  const params = [];
  let filter = '';

  if (userId) {
    params.push(userId);
    filter = ' AND user_id = $1';
  }

  const due = await pool.query(
    `SELECT id
     FROM recurring_transactions
     WHERE is_active = true
       AND next_run_date <= CURRENT_DATE${filter}
     ORDER BY next_run_date, id`,
    params
  );

  let createdCount = 0;
  const errors = [];

  for (const row of due.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const recurringResult = await client.query(
        `SELECT *
         FROM recurring_transactions
         WHERE id = $1
         FOR UPDATE`,
        [row.id]
      );
      const recurring = recurringResult.rows[0];

      if (!recurring || !recurring.is_active || toDateString(recurring.next_run_date) > toDateString(new Date())) {
        await client.query('COMMIT');
        continue;
      }

      const currentRunDate = toDateString(recurring.next_run_date);
      const nextRunDate = getNextRunDate(currentRunDate, recurring.frequency);
      const shouldDeactivate = recurring.end_date && nextRunDate > toDateString(recurring.end_date);

      await client.query(
        `INSERT INTO transactions (user_id, category_id, type, merchant, amount, transaction_date, notes, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'recurring')`,
        [
          recurring.user_id,
          recurring.category_id,
          recurring.type,
          recurring.description,
          recurring.amount,
          currentRunDate,
          null
        ]
      );

      await client.query(
        `UPDATE recurring_transactions
         SET next_run_date = $2,
             is_active = $3
         WHERE id = $1`,
        [recurring.id, nextRunDate, !shouldDeactivate]
      );

      await client.query('COMMIT');
      createdCount += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      errors.push({ id: row.id, message: error.message });
    } finally {
      client.release();
    }
  }

  return { createdCount, errors };
}