import express from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { profileUpdateSchema } from '../validation/schemas.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, name, email, phone, address, preferred_currency,
              theme_preference, budget_reset_day, date_format, created_at
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Profile not found' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.put('/', validate(profileUpdateSchema), async (req, res, next) => {
  try {
    const {
      name,
      email,
      password,
      phone,
      address,
      preferredCurrency = 'USD',
      themePreference = 'light',
      budgetResetDay = 1,
      dateFormat = 'YYYY-MM-DD'
    } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    if (!['light', 'dark'].includes(themePreference)) {
      return res.status(400).json({ error: 'Theme must be light or dark' });
    }
    const resetDay = Number(budgetResetDay);
    if (!Number.isInteger(resetDay) || resetDay < 1 || resetDay > 28) {
      return res.status(400).json({ error: 'Budget reset day must be between 1 and 28' });
    }

    const params = [
      req.user.id,
      name,
      email,
      phone || null,
      address || null,
      preferredCurrency,
      themePreference,
      resetDay,
      dateFormat
    ];
    let sql = `UPDATE users
       SET name = $2,
           email = lower($3),
           phone = $4,
           address = $5,
           preferred_currency = $6,
           theme_preference = $7,
           budget_reset_day = $8,
           date_format = $9`;

    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }
      params.push(await bcrypt.hash(password, 12));
      sql += `, password_hash = $${params.length}`;
    }

    sql += ` WHERE id = $1
      RETURNING id, name, email, phone, address, preferred_currency,
                theme_preference, budget_reset_day, date_format, created_at`;
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
