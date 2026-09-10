import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validate.js';
import { alertsQuerySchema } from '../validation/schemas.js';
import {
  budgetPeriodForMonth,
  currentBudgetPeriod,
  financePreferencesForUser
} from '../lib/financePeriods.js';

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
    const preferences = await financePreferencesForUser(req.user.id);
    const period = req.query.month
      ? budgetPeriodForMonth(req.query.month, preferences.budgetResetDay)
      : currentBudgetPeriod(preferences.timeZone, preferences.budgetResetDay);
    const [budgets, spending] = await Promise.all([
      query(
      `SELECT b.id,
              b.category_id,
              c.name AS category_name,
              b.limit_amount
       FROM budgets b
       JOIN categories c ON c.id = b.category_id AND c.user_id = b.user_id
       WHERE b.user_id = $1 AND b.month = $2
         AND b.limit_amount > 0`,
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
    const alertRows = budgets.rows
      .map((budget) => ({
        ...budget,
        spent: spentByCategory.get(budget.category_id) || 0
      }))
      .filter((budget) => budget.spent >= Number(budget.limit_amount) * 0.8)
      .sort((left, right) => (
        right.spent - Number(right.limit_amount)
      ) - (
        left.spent - Number(left.limit_amount)
      ));

    res.json(alertRows.map(buildBudgetAlert));
  } catch (error) {
    next(error);
  }
});

export default router;
