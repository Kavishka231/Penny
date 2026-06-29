import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

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

router.post('/', async (req, res, next) => {
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
    next(error);
  }
});

export default router;
