import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations'
);

export async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [734_662_991]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = (await fs.readdir(migrationsDir))
      .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
      .sort();

    for (const version of files) {
      const sql = await fs.readFile(path.join(migrationsDir, version), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const applied = await client.query(
        'SELECT checksum FROM schema_migrations WHERE version = $1',
        [version]
      );

      if (applied.rowCount) {
        if (applied.rows[0].checksum !== checksum) {
          throw new Error(`Migration checksum mismatch: ${version}`);
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
          [version, checksum]
        );
        await client.query('COMMIT');
        console.log(`Applied migration ${version}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [734_662_991]).catch(() => {});
    client.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error('Migration failed', error);
      await pool.end();
      process.exitCode = 1;
    });
}
