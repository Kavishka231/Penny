import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validate.js';
import { alertsQuerySchema } from '../validation/schemas.js';

const router = express.Router();
router.use(requireAuth);

export function buildBudgetAlert(row) {
  const spent = Number(row.spent);
  const limit = Number(row.limit_amount);
  const overBy = spent - limit;
  const remaining = limit - spent;
  const percent = Math.round((spent / limit) * 100);
  const status = spent > limit ? 'over' : 'warning';

  return {
    id: row.id,
    status,
    categoryName: row.category_name,
    limitAmount: row.limit_amount,
    spent: row.spent,
    overBy,
    remaining,
    percent,
    message: status === 'over'
      ? `${row.category_name} is over budget by ${overBy.toFixed(2)}`
      : `${row.category_name} is near the monthly limit: ${percent}% used, ${remaining.toFixed(2)} left`
  };
}

router.get('/', validateQuery(alertsQuerySchema), async (req, res, next) => {
  try {
    const month = `${(req.query.month || new Date().toISOString()).slice(0, 7)}-01`;
    const result = await query(
      `SELECT b.id,
              c.name AS category_name,
              b.limit_amount,
              COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) AS spent
       FROM budgets b
       JOIN categories c ON c.id = b.category_id
       LEFT JOIN transactions t
         ON t.category_id = b.category_id
        AND t.user_id = b.user_id
        AND date_trunc('month', t.transaction_date)::date = b.month
       WHERE b.user_id = $1 AND b.month = $2
       GROUP BY b.id, c.name, b.limit_amount
       HAVING b.limit_amount > 0
          AND COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) >= b.limit_amount * 0.8
       ORDER BY COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) - b.limit_amount DESC`,
      [req.user.id, month]
    );

    res.json(result.rows.map(buildBudgetAlert));
  } catch (error) {
    next(error);
  }
});

export default router;
