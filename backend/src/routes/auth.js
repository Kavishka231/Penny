import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { query, withTransaction } from '../db.js';
import { defaultCategories } from '../lib/defaultCategories.js';
import { requireAuth } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { processDueRecurring } from '../services/recurringService.js';
import {
  createResetToken,
  hashResetToken,
  isEmailDeliveryConfigured,
  mayExposeResetToken,
  resetTokenExpiresAt,
  sendPasswordResetEmail,
} from '../services/passwordResetService.js';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '../validation/schemas.js';

const router = express.Router();
const resetRequestLimiter = rateLimit({
  windowMs: Number(process.env.PASSWORD_RESET_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  limit: Number(process.env.PASSWORD_RESET_RATE_LIMIT_MAX || 5),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Please try again later.' }
});
const resetResponseMessage = 'If that account exists, a reset link has been prepared.';

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

router.post('/register', validate(registerSchema), async (req, res, next) => {
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

router.post('/login', validate(loginSchema), async (req, res, next) => {
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

    try {
      await processDueRecurring(user.id);
    } catch (error) {
      console.error('Failed to process recurring transactions during login', error);
    }

    res.json({
      token: signToken(user),
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/forgot-password', resetRequestLimiter, validate(forgotPasswordSchema), async (req, res, next) => {
  try {
    const exposeToken = mayExposeResetToken();
    if (!isEmailDeliveryConfigured() && !exposeToken) {
      return res.status(503).json({ error: 'Password reset delivery is not configured' });
    }

    const { email } = req.body;
    const { token, tokenHash } = createResetToken();
    const expiresAt = resetTokenExpiresAt();
    const result = await query(
      `UPDATE users
       SET reset_password_token_hash = $2,
           reset_password_expires = $3
       WHERE email = lower($1)
       RETURNING email`,
      [email, tokenHash, expiresAt]
    );

    if (!result.rowCount) {
      return res.json({ message: resetResponseMessage });
    }

    try {
      await sendPasswordResetEmail({ email: result.rows[0].email, token });
    } catch (error) {
      console.error('Failed to deliver password reset email', error);
      await query(
        `UPDATE users
         SET reset_password_token_hash = null,
             reset_password_expires = null
         WHERE email = lower($1)
           AND reset_password_token_hash = $2`,
        [email, tokenHash]
      );
    }

    const response = { message: resetResponseMessage };
    if (exposeToken) response.resetToken = token;
    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.post('/reset-password', validate(resetPasswordSchema), async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password || password.length < 8) {
      return res.status(400).json({ error: 'Reset token and an 8 character password are required' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const tokenHash = hashResetToken(token);
    const result = await query(
      `UPDATE users
       SET password_hash = $2,
           reset_password_token_hash = null,
           reset_password_expires = null
       WHERE reset_password_token_hash = $1
         AND reset_password_expires > now()
       RETURNING id`,
      [tokenHash, passwordHash]
    );

    if (!result.rowCount) {
      return res.status(400).json({ error: 'Reset token is invalid or expired' });
    }

    res.json({ message: 'Password reset successfully. You can log in now.' });
  } catch (error) {
    next(error);
  }
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

export default router;
