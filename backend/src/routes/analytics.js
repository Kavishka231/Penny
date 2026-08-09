import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

router.get('/summary', async (req, res, next) => {
  try {
    const result = await query(
      `WITH current_month AS (
         SELECT *
         FROM transactions
         WHERE user_id = $1
           AND transaction_date >= date_trunc('month', CURRENT_DATE)
           AND transaction_date < date_trunc('month', CURRENT_DATE) + interval '1 month'
       )
       SELECT
         COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0) AS income,
         COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) AS expenses,
         COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0) -
         COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) AS cash_flow
       FROM current_month`,
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get('/category-spend', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT COALESCE(c.name, 'Uncategorized') AS category, COALESCE(c.color, '#64748b') AS color, SUM(t.amount) AS total
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
       WHERE t.user_id = $1
         AND t.type = 'expense'
         AND t.transaction_date >= date_trunc('month', CURRENT_DATE)
       GROUP BY c.name, c.color
       ORDER BY total DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.get('/trends', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT transaction_date, type, amount
       FROM transactions
       WHERE user_id = $1`,
      [req.user.id]
    );

    const totals = new Map();
    result.rows.forEach((row) => {
      const date = new Date(row.transaction_date);
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      const month = totals.get(key) || { income: 0, expenses: 0 };
      month[row.type === 'income' ? 'income' : 'expenses'] += Number(row.amount);
      totals.set(key, month);
    });

    const formatter = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC'
    });
    const current = new Date();
    const trends = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 5 + index, 1));
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      const month = totals.get(key) || { income: 0, expenses: 0 };
      return { month: formatter.format(date), ...month };
    });

    res.json(trends);
  } catch (error) {
    next(error);
  }
});

router.get('/budget-progress', async (req, res, next) => {
  try {
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
        AND date_trunc('month', t.transaction_date)::date = b.month
       WHERE b.user_id = $1
         AND b.month = date_trunc('month', CURRENT_DATE)::date
       GROUP BY b.id, c.name, c.color, b.limit_amount
       ORDER BY spent DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.get('/top-merchants', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT merchant, SUM(amount) AS total
       FROM transactions
       WHERE user_id = $1
         AND type = 'expense'
         AND transaction_date >= date_trunc('month', CURRENT_DATE)
       GROUP BY merchant
       ORDER BY total DESC
       LIMIT 6`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

export default router;
