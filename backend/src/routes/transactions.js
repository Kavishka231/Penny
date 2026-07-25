import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import validate, { validateQuery } from '../middleware/validate.js';
import {
  transactionCreateSchema,
  transactionQuerySchema,
  transactionUpdateSchema,
} from '../validation/schemas.js';

const router = express.Router();
router.use(requireAuth);

function filters(req) {
  const clauses = ['t.user_id = $1'];
  const params = [req.user.id];

  for (const [key, sql] of [
    ['type', 't.type ='],
    ['categoryId', 't.category_id ='],
    ['from', 't.transaction_date >='],
    ['to', 't.transaction_date <='],
    ['minAmount', 't.amount >='],
    ['maxAmount', 't.amount <=']
  ]) {
    if (req.query[key]) {
      params.push(req.query[key]);
      clauses.push(`${sql} $${params.length}`);
    }
  }

  if (req.query.search) {
    params.push(`%${req.query.search}%`);
    clauses.push(`(t.merchant ILIKE $${params.length} OR t.notes ILIKE $${params.length})`);
  }

  return { clauses, params };
}

router.get('/', validateQuery(transactionQuerySchema), async (req, res, next) => {
  try {
    const { clauses, params } = filters(req);
    const result = await query(
      `SELECT t.*, c.name AS category_name, c.color AS category_color
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY t.transaction_date DESC, t.created_at DESC
       LIMIT 250`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/', validate(transactionCreateSchema), async (req, res, next) => {
  try {
    const {
      type,
      category_id: categoryId,
      description: merchant,
      amount,
      date: transactionDate,
      notes,
      source = 'manual',
    } = req.body;
    if (!['income', 'expense'].includes(type) || !merchant || !amount || !transactionDate) {
      return res.status(400).json({ error: 'Type, merchant, amount and date are required' });
    }

    const result = await query(
      `INSERT INTO transactions (user_id, category_id, type, merchant, amount, transaction_date, notes, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.user.id, categoryId || null, type, merchant, amount, transactionDate, notes || null, source]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.put('/:id', validate(transactionUpdateSchema), async (req, res, next) => {
  try {
    const {
      type,
      category_id: categoryId,
      description: merchant,
      amount,
      date: transactionDate,
      notes,
    } = req.body;
    const result = await query(
      `UPDATE transactions
       SET type = $3, category_id = $4, merchant = $5, amount = $6, transaction_date = $7, notes = $8, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [req.params.id, req.user.id, type, categoryId || null, merchant, amount, transactionDate, notes || null]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Transaction not found' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM transactions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Transaction not found' });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
