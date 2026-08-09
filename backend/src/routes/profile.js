import express from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { profileUpdateSchema } from '../validation/schemas.js';

const router = express.Router();
router.use(requireAuth);

const returnedProfileFields = `id, name, email, phone, address, preferred_currency,
  timezone, theme_preference, budget_reset_day, date_format, created_at`;

router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT ${returnedProfileFields} FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Profile not found' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

async function updateProfile(req, res, next) {
  try {
    const values = [req.user.id];
    const fields = [];
    const updates = { ...req.body };

    if (Object.hasOwn(updates, 'currency')) {
      updates.preferredCurrency = updates.currency;
    }
    if (updates.preferences) {
      Object.assign(updates, updates.preferences);
    }

    const columnByProperty = {
      name: 'name',
      email: 'email',
      phone: 'phone',
      address: 'address',
      preferredCurrency: 'preferred_currency',
      timezone: 'timezone',
      themePreference: 'theme_preference',
      budgetResetDay: 'budget_reset_day',
      dateFormat: 'date_format'
    };

    for (const [property, column] of Object.entries(columnByProperty)) {
      if (!Object.hasOwn(updates, property)) continue;
      values.push(updates[property]);
      fields.push(`${column} = ${property === 'email' ? 'lower(' : ''}$${values.length}${property === 'email' ? ')' : ''}`);
    }

    if (Object.hasOwn(updates, 'password')) {
      values.push(await bcrypt.hash(updates.password, 12));
      fields.push(`password_hash = $${values.length}`);
    }

    const result = await query(
      `UPDATE users
       SET ${fields.join(', ')}
       WHERE id = $1
       RETURNING ${returnedProfileFields}`,
      values
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Profile not found' });
    if (Object.hasOwn(updates, 'password')) {
      await query(
        `UPDATE auth_sessions SET revoked_at = now()
         WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
        [req.user.id, req.user.sid]
      );
    }
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'That email is already in use' });
    }
    next(error);
  }
}

router.patch('/', validate(profileUpdateSchema), updateProfile);
router.put('/', validate(profileUpdateSchema), updateProfile);

export default router;
