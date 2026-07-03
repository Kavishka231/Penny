import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

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

export async function ensureDatabase() {
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT');
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT');
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_currency TEXT NOT NULL DEFAULT 'USD'");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_preference TEXT NOT NULL DEFAULT 'light'");
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS budget_reset_day INTEGER NOT NULL DEFAULT 1');
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS date_format TEXT NOT NULL DEFAULT 'YYYY-MM-DD'");
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_token TEXT');
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_expires TIMESTAMPTZ');
  await query('ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_source_check');
  await query("ALTER TABLE transactions ADD CONSTRAINT transactions_source_check CHECK (source IN ('manual', 'csv', 'recurring'))");
  await query(`
    CREATE TABLE IF NOT EXISTS recurring_transactions (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id UUID REFERENCES categories(id),
      description VARCHAR(255) NOT NULL,
      amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
      frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
      start_date DATE NOT NULL,
      next_run_date DATE NOT NULL,
      end_date DATE,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS idx_recurring_user ON recurring_transactions(user_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_recurring_next_run ON recurring_transactions(next_run_date) WHERE is_active = true');
}
