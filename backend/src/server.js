import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import categoryRoutes from './routes/categories.js';
import transactionRoutes from './routes/transactions.js';
import budgetRoutes from './routes/budgets.js';
import analyticsRoutes from './routes/analytics.js';
import importRoutes from './routes/imports.js';
import reportRoutes from './routes/reports.js';
import alertRoutes from './routes/alerts.js';
import profileRoutes from './routes/profile.js';
import recurringRoutes from './routes/recurring.js';
import { ensureDatabase } from './db.js';
import cron from 'node-cron';
import { processDueRecurring } from './services/recurringService.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '..', 'public');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'Penny API' });
});

app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/budgets', budgetRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/imports', importRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/recurring', recurringRoutes);

app.use(express.static(publicDir));
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({
    error: error.message || 'Unexpected server error'
  });
});

const port = process.env.PORT || 3000;
ensureDatabase()
  .then(() => {
    cron.schedule('0 2 * * *', async () => {
      try {
        const result = await processDueRecurring();
        console.log(`Recurring job created ${result.createdCount} transaction(s)`);
        if (result.errors.length) {
          console.error('Recurring job errors', result.errors);
        }
      } catch (error) {
        console.error('Recurring job failed', error);
      }
    });

    app.listen(port, () => {
      console.log(`Penny API listening on ${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to prepare database', error);
    process.exit(1);
  });
