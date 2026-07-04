import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import validate, { validateQuery } from '../middleware/validate.js';
import { budgetQuerySchema, budgetSchema } from '../validation/schemas.js';

const router = express.Router();
router.use(requireAuth);

function monthStart(month) {
  return `${month.slice(0, 7)}-01`;
}

router.get('/', validateQuery(budgetQuerySchema), async (req, res, next) => {
  try {
    const month = monthStart(req.query.month || new Date().toISOString());
    const result = await query(
      `SELECT b.*, c.name AS category_name, c.color AS category_color,
              COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) AS spent,
              b.limit_amount - COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) AS remaining
       FROM budgets b
       JOIN categories c ON c.id = b.category_id
       LEFT JOIN transactions t
         ON t.category_id = b.category_id
        AND t.user_id = b.user_id
        AND date_trunc('month', t.transaction_date)::date = b.month
       WHERE b.user_id = $1 AND b.month = $2
       GROUP BY b.id, c.name, c.color
       ORDER BY c.name`,
      [req.user.id, month]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/', validate(budgetSchema), async (req, res, next) => {
  try {
    const {
      category_id: categoryId,
      month,
      monthly_limit: limitAmount,
    } = req.body;
    if (!categoryId || !month || limitAmount === undefined) {
      return res.status(400).json({ error: 'Category, month and limit are required' });
    }

    const result = await query(
      `INSERT INTO budgets (user_id, category_id, month, limit_amount)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, category_id, month)
       DO UPDATE SET limit_amount = excluded.limit_amount, updated_at = now()
       RETURNING *`,
      [req.user.id, categoryId, monthStart(month), limitAmount]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

export default router;
