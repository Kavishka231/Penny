import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import validate, { validateQuery } from '../middleware/validate.js';
import {
  transactionCreateSchema,
  transactionQuerySchema,
  transactionUpdateSchema,
} from '../validation/schemas.js';
import { userOwnsCategory } from '../lib/categoryOwnership.js';

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
    const page = req.query.page;
    const limit = req.query.limit;
    const offset = (page - 1) * limit;
    const [countResult, transactionResult] = await Promise.all([
      query(
        `SELECT COUNT(*) AS total
         FROM transactions t
         WHERE ${clauses.join(' AND ')}`,
        params
      ),
      query(
      `SELECT t.*, c.name AS category_name, c.color AS category_color
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY t.transaction_date DESC, t.created_at DESC, t.id DESC
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      )
    ]);
    const total = Number(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    res.json({
      transactions: transactionResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1
      }
    });
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
    if (!(await userOwnsCategory(categoryId, req.user.id))) {
      return res.status(400).json({ error: 'Category does not belong to this user' });
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

async function updateTransaction(req, res, next) {
  try {
    if (Object.hasOwn(req.body, 'category_id')
        && !(await userOwnsCategory(req.body.category_id, req.user.id))) {
      return res.status(400).json({ error: 'Category does not belong to this user' });
    }

    const fields = [];
    const values = [req.params.id, req.user.id];
    const columnByProperty = {
      type: 'type',
      category_id: 'category_id',
      description: 'merchant',
      amount: 'amount',
      date: 'transaction_date',
      notes: 'notes'
    };

    for (const [property, column] of Object.entries(columnByProperty)) {
      if (!Object.hasOwn(req.body, property)) continue;
      values.push(req.body[property]);
      fields.push(`${column} = $${values.length}`);
    }

    const result = await query(
      `UPDATE transactions
       SET ${fields.join(', ')}, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      values
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Transaction not found' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
}

router.patch('/:id', validate(transactionUpdateSchema), updateTransaction);
router.put('/:id', validate(transactionUpdateSchema), updateTransaction);

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
