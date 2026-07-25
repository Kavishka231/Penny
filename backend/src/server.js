import 'dotenv/config';
import app from './app.js';
import { runMigrations } from './migrate.js';
import cron from 'node-cron';
import { processDueRecurring } from './services/recurringService.js';
import { validateProductionConfig } from './config.js';

const port = process.env.PORT || 3000;
validateProductionConfig();
runMigrations()
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
