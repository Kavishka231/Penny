import express from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, name, email, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Profile not found' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.put('/', async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const params = [req.user.id, name, email];
    let sql = 'UPDATE users SET name = $2, email = lower($3)';

    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }
      params.push(await bcrypt.hash(password, 12));
      sql += `, password_hash = $${params.length}`;
    }

    sql += ' WHERE id = $1 RETURNING id, name, email, created_at';
    const result = await query(sql, params);
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'That email is already in use' });
    }
    next(error);
  }
});

export default router;
