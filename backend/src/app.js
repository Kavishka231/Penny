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
import { allowedOrigins, enabled } from './config.js';
import { query } from './db.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = process.env.FRONTEND_DIR
  ? path.resolve(process.env.FRONTEND_DIR)
  : path.resolve(__dirname, '..', 'public');

const production = process.env.NODE_ENV === 'production';
const origins = allowedOrigins();
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
}
if (production && enabled(process.env.FORCE_HTTPS)) {
  app.use((req, res, next) => {
    if (req.secure || req.path === '/api/health') return next();
    return res.redirect(308, `https://${req.get('host')}${req.originalUrl}`);
  });
}
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: production ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
  hsts: production
    ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
    : false
}));
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || (!production && !origins.length) || origins.includes(origin)) {
      return callback(null, true);
    }
    const error = new Error('Origin is not allowed by CORS');
    error.status = 403;
    return callback(error);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, name: 'Penny API', database: 'ready' });
  } catch (_error) {
    res.status(503).json({ ok: false, name: 'Penny API', database: 'unavailable' });
  }
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

export default app;
