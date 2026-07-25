ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_preference TEXT NOT NULL DEFAULT 'light';
ALTER TABLE users ADD COLUMN IF NOT EXISTS budget_reset_day INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_format TEXT NOT NULL DEFAULT 'YYYY-MM-DD';
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_token_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_expires TIMESTAMPTZ;
ALTER TABLE users DROP COLUMN IF EXISTS reset_password_token;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_theme_preference_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_theme_preference_check
      CHECK (theme_preference IN ('light', 'dark'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_budget_reset_day_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_budget_reset_day_check
      CHECK (budget_reset_day BETWEEN 1 AND 28);
  END IF;
END
$$;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_source_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_source_check
  CHECK (source IN ('manual', 'csv', 'recurring'));

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
);

CREATE INDEX IF NOT EXISTS idx_recurring_user
  ON recurring_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_recurring_next_run
  ON recurring_transactions(next_run_date)
  WHERE is_active = true;
