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
       LEFT JOIN categories c ON c.id = t.category_id
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
      `SELECT to_char(months.month, 'Mon YYYY') AS month,
              COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0) AS income,
              COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) AS expenses
       FROM generate_series(
         date_trunc('month', CURRENT_DATE) - interval '5 months',
         date_trunc('month', CURRENT_DATE),
         interval '1 month'
       ) months(month)
       LEFT JOIN transactions t
         ON date_trunc('month', t.transaction_date) = months.month
        AND t.user_id = $1
       GROUP BY months.month
       ORDER BY months.month`,
      [req.user.id]
    );
    res.json(result.rows);
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
       JOIN categories c ON c.id = b.category_id
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
