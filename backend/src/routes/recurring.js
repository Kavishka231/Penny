import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import {
  recurringTransactionSchema,
  recurringTransactionUpdateSchema,
} from '../validation/schemas.js';
import { userOwnsCategory } from '../lib/categoryOwnership.js';

const router = express.Router();

router.use(requireAuth);

function normalizePayload(body) {
  return {
    description: body.description?.trim(),
    amount: body.amount,
    type: body.type,
    categoryId: Object.hasOwn(body, 'categoryId') ? body.categoryId : undefined,
    frequency: body.frequency,
    startDate: body.startDate || body.start_date,
    endDate: body.endDate || body.end_date || null,
    isActive: body.isActive ?? body.is_active
  };
}

function mapRecurringSchemaBody(body) {
  const mapped = { ...body };
  if ('category_id' in body) mapped.categoryId = body.category_id;
  if ('start_date' in body) mapped.startDate = body.start_date;
  if ('end_date' in body) mapped.endDate = body.end_date;
  if ('is_active' in body) mapped.isActive = body.is_active;
  return mapped;
}

router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT r.*, c.name AS category_name, c.color AS category_color
       FROM recurring_transactions r
       LEFT JOIN categories c ON c.id = r.category_id AND c.user_id = r.user_id
       WHERE r.user_id = $1
       ORDER BY r.next_run_date ASC, r.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/', validate(recurringTransactionSchema), async (req, res, next) => {
  try {
    const payload = normalizePayload(mapRecurringSchemaBody(req.body));
    if (!payload.description || !payload.amount || !payload.type || !payload.frequency || !payload.startDate) {
      return res.status(400).json({ error: 'Description, amount, type, frequency and start date are required' });
    }

    if (!['income', 'expense'].includes(payload.type)) {
      return res.status(400).json({ error: 'Type must be income or expense' });
    }

    if (!['daily', 'weekly', 'monthly', 'yearly'].includes(payload.frequency)) {
      return res.status(400).json({ error: 'Frequency must be daily, weekly, monthly or yearly' });
    }

    if (payload.endDate && payload.endDate < payload.startDate) {
      return res.status(400).json({ error: 'End date must be on or after the start date' });
    }
    if (!(await userOwnsCategory(payload.categoryId, req.user.id))) {
      return res.status(400).json({ error: 'Category does not belong to this user' });
    }

    const result = await query(
      `INSERT INTO recurring_transactions
       (user_id, category_id, description, amount, type, frequency, start_date, next_run_date, end_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)
       RETURNING *`,
      [
        req.user.id,
        payload.categoryId || null,
        payload.description,
        payload.amount,
        payload.type,
        payload.frequency,
        payload.startDate,
        payload.endDate
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.put('/:id', validate(recurringTransactionUpdateSchema), async (req, res, next) => {
  try {
    const payload = normalizePayload(mapRecurringSchemaBody(req.body));
    if (!(await userOwnsCategory(payload.categoryId, req.user.id))) {
      return res.status(400).json({ error: 'Category does not belong to this user' });
    }
    const fields = [];
    const values = [req.params.id, req.user.id];

    if (payload.description !== undefined) {
      values.push(payload.description);
      fields.push(`description = $${values.length}`);
    }
    if (payload.amount !== undefined) {
      values.push(payload.amount);
      fields.push(`amount = $${values.length}`);
    }
    if (payload.type !== undefined) {
      values.push(payload.type);
      fields.push(`type = $${values.length}`);
    }
    if (payload.categoryId !== undefined) {
      values.push(payload.categoryId);
      fields.push(`category_id = $${values.length}`);
    }
    if (payload.frequency !== undefined) {
      values.push(payload.frequency);
      fields.push(`frequency = $${values.length}`);
    }
    if (payload.startDate !== undefined) {
      values.push(payload.startDate);
      fields.push(`start_date = $${values.length}`);
      values.push(payload.startDate);
      fields.push(`next_run_date = $${values.length}`);
    }
    if (payload.endDate !== undefined) {
      values.push(payload.endDate);
      fields.push(`end_date = $${values.length}`);
    }
    if (payload.isActive !== undefined) {
      values.push(Boolean(payload.isActive));
      fields.push(`is_active = $${values.length}`);
    }

    if (!fields.length) {
      return res.status(400).json({ error: 'No changes provided' });
    }

    values.push(req.params.id, req.user.id);
    const result = await query(
      `UPDATE recurring_transactions
       SET ${fields.join(', ')}
       WHERE id = $${values.length - 1}
         AND user_id = $${values.length}
       RETURNING *`,
      values
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: 'Recurring transaction not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM recurring_transactions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: 'Recurring transaction not found' });
    }

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
