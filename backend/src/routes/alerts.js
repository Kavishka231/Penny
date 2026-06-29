import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
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
       HAVING COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) > b.limit_amount
       ORDER BY COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) - b.limit_amount DESC`,
      [req.user.id, month]
    );

    res.json(result.rows.map((row) => ({
      id: row.id,
      categoryName: row.category_name,
      limitAmount: row.limit_amount,
      spent: row.spent,
      overBy: Number(row.spent) - Number(row.limit_amount),
      message: `${row.category_name} is over budget by ${Number(row.spent) - Number(row.limit_amount)}`
    })));
  } catch (error) {
    next(error);
  }
});

export default router;
