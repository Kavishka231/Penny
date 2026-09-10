import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import {
  calendarMonthPeriod,
  currentBudgetPeriod,
  financePreferencesForUser,
  recentCalendarMonths,
  transactionDateKey
} from '../lib/financePeriods.js';

const router = express.Router();
router.use(requireAuth);

router.get('/summary', async (req, res, next) => {
  try {
    const preferences = await financePreferencesForUser(req.user.id);
    const period = calendarMonthPeriod(preferences.timeZone);
    const result = await query(
      `WITH current_month AS (
         SELECT *
         FROM transactions
         WHERE user_id = $1
           AND transaction_date >= $2
           AND transaction_date < $3
       )
       SELECT
         COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0) AS income,
         COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) AS expenses,
         COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0) -
         COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) AS cash_flow
       FROM current_month`,
      [req.user.id, period.start, period.end]
    );
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get('/category-spend', async (req, res, next) => {
  try {
    const preferences = await financePreferencesForUser(req.user.id);
    const period = calendarMonthPeriod(preferences.timeZone);
    const result = await query(
      `SELECT COALESCE(c.name, 'Uncategorized') AS category, COALESCE(c.color, '#64748b') AS color, SUM(t.amount) AS total
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
       WHERE t.user_id = $1
         AND t.type = 'expense'
         AND t.transaction_date >= $2
         AND t.transaction_date < $3
       GROUP BY c.name, c.color
       ORDER BY total DESC`,
      [req.user.id, period.start, period.end]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.get('/trends', async (req, res, next) => {
  try {
    const preferences = await financePreferencesForUser(req.user.id);
    const months = recentCalendarMonths(preferences.timeZone);
    const result = await query(
      `SELECT transaction_date, type, amount
       FROM transactions
       WHERE user_id = $1
         AND transaction_date >= $2
         AND transaction_date < $3`,
      [req.user.id, months[0].start, months.at(-1).end]
    );

    const totals = new Map();
    result.rows.forEach((row) => {
      const key = transactionDateKey(row.transaction_date).slice(0, 7);
      const month = totals.get(key) || { income: 0, expenses: 0 };
      month[row.type === 'income' ? 'income' : 'expenses'] += Number(row.amount);
      totals.set(key, month);
    });

    const trends = months.map(({ key, label }) => ({
      month: label,
      ...(totals.get(key) || { income: 0, expenses: 0 })
    }));

    res.json(trends);
  } catch (error) {
    next(error);
  }
});

router.get('/budget-progress', async (req, res, next) => {
  try {
    const preferences = await financePreferencesForUser(req.user.id);
    const period = currentBudgetPeriod(preferences.timeZone, preferences.budgetResetDay);
    const result = await query(
      `SELECT c.name AS category,
              c.color,
              b.limit_amount,
              COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) AS spent
       FROM budgets b
       JOIN categories c ON c.id = b.category_id AND c.user_id = b.user_id
       LEFT JOIN transactions t
        ON t.category_id = b.category_id
        AND t.user_id = b.user_id
        AND t.transaction_date >= $3
        AND t.transaction_date < $4
       WHERE b.user_id = $1
         AND b.month = $2
       GROUP BY b.id, c.name, c.color, b.limit_amount
       ORDER BY spent DESC`,
      [req.user.id, period.key, period.start, period.end]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.get('/top-merchants', async (req, res, next) => {
  try {
    const preferences = await financePreferencesForUser(req.user.id);
    const period = calendarMonthPeriod(preferences.timeZone);
    const result = await query(
      `SELECT merchant, SUM(amount) AS total
       FROM transactions
       WHERE user_id = $1
         AND type = 'expense'
         AND transaction_date >= $2
         AND transaction_date < $3
       GROUP BY merchant
       ORDER BY total DESC
       LIMIT 6`,
      [req.user.id, period.start, period.end]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

export default router;
