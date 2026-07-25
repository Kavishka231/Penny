import pg from 'pg';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let Pool = pg.Pool;

if (process.env.NODE_ENV === 'test') {
  const { DataType, newDb } = await import('pg-mem');
  const memoryDb = newDb({ autoCreateForeignKeyIndices: true });

  memoryDb.registerExtension('pgcrypto', (schema) => {
    schema.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      impure: true,
      implementation: () => crypto.randomUUID()
    });
  });

  memoryDb.public.registerFunction({
    name: 'date_trunc',
    args: [DataType.text, DataType.date],
    returns: DataType.date,
    implementation: (part, value) => {
      if (part !== 'month') throw new Error(`Unsupported date_trunc part in tests: ${part}`);
      const date = new Date(value);
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    }
  });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.resolve(__dirname, '..', '..', 'database', 'schema.sql');
  memoryDb.public.none(fs.readFileSync(schemaPath, 'utf8'));
  Pool = memoryDb.adapters.createPg().Pool;
}

const productionPoolOptions = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {};
if (process.env.DATABASE_SSL === 'true') {
  productionPoolOptions.ssl = { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' };
}

export const pool = process.env.NODE_ENV === 'test'
  ? new Pool()
  : new Pool(productionPoolOptions);

export async function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
