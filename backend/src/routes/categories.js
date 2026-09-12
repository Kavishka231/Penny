import express from 'express';
import { query, withTransaction } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import {
  categoryIdSchema,
  categorySchema,
  categoryUpdateSchema
} from '../validation/schemas.js';

const router = express.Router();
router.use(requireAuth);

function validateCategoryId(req, res, next) {
  const result = categoryIdSchema.safeParse(req.params.id);
  if (!result.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: [{ field: 'id', message: result.error.issues[0].message }]
    });
  }
  req.params.id = result.data;
  next();
}

function duplicateCategoryError(error, res, next) {
  if (error.code === '23505') {
    return res.status(409).json({ error: 'That category already exists for this type' });
  }
  return next(error);
}

router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM categories WHERE user_id = $1 ORDER BY type, name',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/', validate(categorySchema), async (req, res, next) => {
  try {
    const { name, type, color = '#3b82f6' } = req.body;
    if (!name || !['income', 'expense'].includes(type)) {
      return res.status(400).json({ error: 'Category name and type are required' });
    }

    const result = await query(
      'INSERT INTO categories (user_id, name, type, color) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, name, type, color]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    duplicateCategoryError(error, res, next);
  }
});

router.patch('/:id', validateCategoryId, validate(categoryUpdateSchema), async (req, res, next) => {
  try {
    const fields = [];
    const values = [req.params.id, req.user.id];
    for (const property of ['name', 'color']) {
      if (!Object.hasOwn(req.body, property)) continue;
      values.push(req.body[property]);
      fields.push(`${property} = $${values.length}`);
    }

    const result = await query(
      `UPDATE categories
       SET ${fields.join(', ')}
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      values
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Category not found' });
    res.json(result.rows[0]);
  } catch (error) {
    duplicateCategoryError(error, res, next);
  }
});

router.delete('/:id', validateCategoryId, async (req, res, next) => {
  try {
    const outcome = await withTransaction(async (client) => {
      const category = await client.query(
        'SELECT id FROM categories WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [req.params.id, req.user.id]
      );
      if (!category.rowCount) return { status: 'not-found' };

      const references = await client.query(
        `SELECT
           (SELECT COUNT(*) FROM transactions WHERE category_id = $1 AND user_id = $2) AS transactions,
           (SELECT COUNT(*) FROM budgets WHERE category_id = $1 AND user_id = $2) AS budgets,
           (SELECT COUNT(*) FROM recurring_transactions WHERE category_id = $1 AND user_id = $2) AS recurring_transactions`,
        [req.params.id, req.user.id]
      );
      const counts = {
        transactions: Number(references.rows[0].transactions),
        budgets: Number(references.rows[0].budgets),
        recurringTransactions: Number(references.rows[0].recurring_transactions)
      };
      if (Object.values(counts).some((count) => count > 0)) {
        return { status: 'conflict', counts };
      }

      await client.query(
        'DELETE FROM categories WHERE id = $1 AND user_id = $2',
        [req.params.id, req.user.id]
      );
      return { status: 'deleted' };
    });

    if (outcome.status === 'not-found') {
      return res.status(404).json({ error: 'Category not found' });
    }
    if (outcome.status === 'conflict') {
      return res.status(409).json({
        error: 'Category is linked to financial records and cannot be deleted',
        references: outcome.counts
      });
    }
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
