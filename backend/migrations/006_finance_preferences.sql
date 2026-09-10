ALTER TABLE users DROP CONSTRAINT IF EXISTS users_budget_reset_day_check;
ALTER TABLE users
  ADD CONSTRAINT users_budget_reset_day_check
  CHECK (budget_reset_day BETWEEN 1 AND 31);

UPDATE users
SET date_format = 'YYYY-MM-DD'
WHERE date_format NOT IN ('YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY');

ALTER TABLE users
  ADD CONSTRAINT users_date_format_check
  CHECK (date_format IN ('YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'));
