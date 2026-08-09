import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

router.get('/transactions.csv', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT t.transaction_date, t.type, t.merchant, t.amount, COALESCE(c.name, '') AS category, COALESCE(t.notes, '') AS notes, t.source
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
       WHERE t.user_id = $1
       ORDER BY transaction_date DESC`,
      [req.user.id]
    );

    const lines = ['date,type,merchant,amount,category,notes,source'];
    for (const row of result.rows) {
      lines.push([
        String(row.transaction_date).slice(0, 10),
        row.type,
        row.merchant,
        row.amount,
        row.category,
        row.notes,
        row.source
      ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','));
    }

    res.header('Content-Type', 'text/csv');
    res.attachment('penny-transactions.csv');
    res.send(lines.join('\n'));
  } catch (error) {
    next(error);
  }
});

export default router;
