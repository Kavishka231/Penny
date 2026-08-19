import 'dotenv/config';
import app from './app.js';
import { runMigrations } from './migrate.js';
import cron from 'node-cron';
import { processDueRecurring } from './services/recurringService.js';
import { validateProductionConfig } from './config.js';
import { pool } from './db.js';

const port = process.env.PORT || 3000;
validateProductionConfig();
runMigrations()
  .then(() => {
    const recurringTask = cron.schedule('0 2 * * *', async () => {
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

    const server = app.listen(port, () => {
      console.log(`Penny API listening on ${port}`);
    });

    let shuttingDown = false;
    const shutdown = (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`${signal} received; shutting down`);
      recurringTask.stop();

      const forcedExit = setTimeout(() => {
        console.error('Graceful shutdown timed out');
        process.exit(1);
      }, 10_000);
      forcedExit.unref();

      server.close(async (error) => {
        try {
          await pool.end();
        } finally {
          clearTimeout(forcedExit);
          process.exit(error ? 1 : 0);
        }
      });
    };

    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
  })
  .catch((error) => {
    console.error('Failed to prepare database', error);
    process.exit(1);
  });
