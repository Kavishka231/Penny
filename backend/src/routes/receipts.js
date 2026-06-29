import express from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/scan', requireAuth, upload.single('receipt'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Receipt image is required' });
    if (!process.env.CLAUDE_API_KEY) {
      return res.status(503).json({ error: 'CLAUDE_API_KEY is not configured' });
    }

    const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20240620',
      max_tokens: 500,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: req.file.mimetype,
              data: req.file.buffer.toString('base64')
            }
          },
          {
            type: 'text',
            text: 'Extract receipt data as strict JSON with merchant, amount, date in YYYY-MM-DD, category, and notes. No markdown.'
          }
        ]
      }]
    });

    const text = response.content.find((part) => part.type === 'text')?.text || '{}';
    res.json(JSON.parse(text));
  } catch (error) {
    next(error);
  }
});

export default router;
