import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import validate, { validateQuery } from '../middleware/validate.js';
import { budgetQuerySchema, budgetSchema } from '../validation/schemas.js';
import { userOwnsCategory } from '../lib/categoryOwnership.js';
import {
  budgetPeriodForMonth,
  currentBudgetPeriod,
  financePreferencesForUser
} from '../lib/financePeriods.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', validateQuery(budgetQuerySchema), async (req, res, next) => {
  try {
    const preferences = await financePreferencesForUser(req.user.id);
    const period = req.query.month
      ? budgetPeriodForMonth(req.query.month, preferences.budgetResetDay)
      : currentBudgetPeriod(preferences.timeZone, preferences.budgetResetDay);
    const [budgets, spending] = await Promise.all([
      query(
      `SELECT b.*, c.name AS category_name, c.color AS category_color
       FROM budgets b
       JOIN categories c ON c.id = b.category_id AND c.user_id = b.user_id
       WHERE b.user_id = $1 AND b.month = $2
       ORDER BY c.name`,
      [req.user.id, period.key]
      ),
      query(
        `SELECT category_id, SUM(amount) AS spent
         FROM transactions
         WHERE user_id = $1
           AND type = 'expense'
           AND transaction_date >= $2
           AND transaction_date < $3
         GROUP BY category_id`,
        [req.user.id, period.start, period.end]
      )
    ]);
    const spentByCategory = new Map(
      spending.rows.map((row) => [row.category_id, Number(row.spent)])
    );
    res.json(budgets.rows.map((budget) => {
      const spent = spentByCategory.get(budget.category_id) || 0;
      return {
        ...budget,
        spent,
        remaining: Number(budget.limit_amount) - spent
      };
    }));
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
    if (!(await userOwnsCategory(categoryId, req.user.id))) {
      return res.status(400).json({ error: 'Category does not belong to this user' });
    }
    const preferences = await financePreferencesForUser(req.user.id);
    const period = budgetPeriodForMonth(month, preferences.budgetResetDay);

    const result = await query(
      `INSERT INTO budgets (user_id, category_id, month, limit_amount)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, category_id, month)
       DO UPDATE SET limit_amount = excluded.limit_amount, updated_at = now()
       RETURNING *`,
      [req.user.id, categoryId, period.key, limitAmount]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

export default router;
