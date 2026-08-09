ALTER TABLE categories
  ADD CONSTRAINT categories_id_user_id_key UNIQUE (id, user_id);

UPDATE transactions t
SET category_id = null
WHERE category_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM categories c
    WHERE c.id = t.category_id AND c.user_id = t.user_id
  );

DELETE FROM budgets b
WHERE NOT EXISTS (
  SELECT 1 FROM categories c
  WHERE c.id = b.category_id AND c.user_id = b.user_id
);

UPDATE recurring_transactions r
SET category_id = null
WHERE category_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM categories c
    WHERE c.id = r.category_id AND c.user_id = r.user_id
  );

ALTER TABLE transactions
  DROP CONSTRAINT transactions_category_id_fkey;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_category_owner_fkey
  FOREIGN KEY (category_id, user_id)
  REFERENCES categories (id, user_id)
  ON DELETE SET NULL (category_id);

ALTER TABLE budgets
  DROP CONSTRAINT budgets_category_id_fkey;
ALTER TABLE budgets
  ADD CONSTRAINT budgets_category_owner_fkey
  FOREIGN KEY (category_id, user_id)
  REFERENCES categories (id, user_id)
  ON DELETE CASCADE;

ALTER TABLE recurring_transactions
  DROP CONSTRAINT recurring_transactions_category_id_fkey;
ALTER TABLE recurring_transactions
  ADD CONSTRAINT recurring_transactions_category_owner_fkey
  FOREIGN KEY (category_id, user_id)
  REFERENCES categories (id, user_id)
  ON DELETE SET NULL (category_id);
