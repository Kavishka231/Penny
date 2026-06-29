import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { withTransaction } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

router.post('/csv', requireAuth, upload.single('statement'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV file is required' });

    const records = parse(req.file.buffer.toString('utf8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    const inserted = await withTransaction(async (client) => {
      let count = 0;
      for (const record of records) {
        const merchant = record.merchant || record.description || record.Description;
        const amount = Number(record.amount || record.Amount);
        const date = record.date || record.Date;
        const type = amount < 0 ? 'expense' : (record.type || 'income').toLowerCase();
        if (!merchant || !amount || !date) continue;

        await client.query(
          `INSERT INTO transactions (user_id, type, merchant, amount, transaction_date, source)
           VALUES ($1, $2, $3, $4, $5, 'csv')`,
          [req.user.id, type, merchant, Math.abs(amount), date]
        );
        count += 1;
      }
      return count;
    });

    res.status(201).json({ inserted });
  } catch (error) {
    next(error);
  }
});

export default router;
