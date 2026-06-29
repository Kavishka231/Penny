import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, withTransaction } from '../db.js';
import { defaultCategories } from '../lib/defaultCategories.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password || password.length < 8) {
      return res.status(400).json({ error: 'Name, email and an 8 character password are required' });
    }

    const user = await withTransaction(async (client) => {
      const passwordHash = await bcrypt.hash(password, 12);
      const created = await client.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, lower($2), $3) RETURNING id, name, email',
        [name, email, passwordHash]
      );

      for (const [categoryName, type, color] of defaultCategories) {
        await client.query(
          'INSERT INTO categories (user_id, name, type, color, is_default) VALUES ($1, $2, $3, $4, true)',
          [created.rows[0].id, categoryName, type, color]
        );
      }

      return created.rows[0];
    });

    res.status(201).json({ token: signToken(user), user });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'An account already exists for that email' });
    }
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await query(
      'SELECT id, name, email, password_hash FROM users WHERE email = lower($1)',
      [email]
    );
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    res.json({
      token: signToken(user),
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

export default router;
