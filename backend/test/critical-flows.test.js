import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'penny-tests-only-secret';

let request;
let app;
let pool;
let processDueRecurring;
let buildBudgetAlert;
let primary;
let secondary;

const currentDate = new Date().toISOString().slice(0, 10);
const currentMonth = `${currentDate.slice(0, 7)}-01`;

async function register(name, email) {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ name, email, password: 'StrongPass123!' });

  assert.equal(response.status, 201, response.text);
  return response.body;
}

function authenticated(method, path, token) {
  return request(app)[method](path).set('Authorization', `Bearer ${token}`);
}

before(async () => {
  ({ default: request } = await import('supertest'));
  ({ default: app } = await import('../src/app.js'));
  ({ pool } = await import('../src/db.js'));
  ({ processDueRecurring } = await import('../src/services/recurringService.js'));
  ({ buildBudgetAlert } = await import('../src/routes/alerts.js'));
});

after(async () => {
  await pool.end();
});

test('registers users and creates isolated default categories', async () => {
  primary = await register('Primary User', 'primary@example.com');
  secondary = await register('Secondary User', 'secondary@example.com');

  assert.ok(primary.token);
  assert.notEqual(primary.user.id, secondary.user.id);

  const categories = await authenticated('get', '/api/categories', primary.token);
  assert.equal(categories.status, 200, categories.text);
  assert.ok(categories.body.length > 0);
  assert.ok(categories.body.every((category) => category.user_id === primary.user.id));
});

test('logs in with valid credentials and rejects an invalid login', async () => {
  const valid = await request(app)
    .post('/api/auth/login')
    .send({ email: 'PRIMARY@example.com', password: 'StrongPass123!' });
  assert.equal(valid.status, 200, valid.text);
  assert.ok(valid.body.token);

  const invalid = await request(app)
    .post('/api/auth/login')
    .send({ email: 'primary@example.com', password: 'not-the-password' });
  assert.equal(invalid.status, 401);
  assert.equal(invalid.body.error, 'Invalid email or password');
});

test('treats logout as client-side token removal and rejects logged-out requests', async () => {
  const authenticatedResponse = await authenticated('get', '/api/auth/me', primary.token);
  assert.equal(authenticatedResponse.status, 200);

  const afterTokenRemoval = await request(app).get('/api/auth/me');
  assert.equal(afterTokenRemoval.status, 401);
  assert.equal(afterTokenRemoval.body.error, 'Authentication required');
});

test('prepares password resets without revealing whether unknown accounts exist', async () => {
  const existing = await request(app)
    .post('/api/auth/forgot-password')
    .send({ email: 'primary@example.com' });
  assert.equal(existing.status, 200, existing.text);
  assert.match(existing.body.resetToken, /^[a-f0-9]{48}$/);

  const unknown = await request(app)
    .post('/api/auth/forgot-password')
    .send({ email: 'missing@example.com' });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.resetToken, undefined);
});

test('creates, edits, reads, and deletes a transaction', async () => {
  const created = await authenticated('post', '/api/transactions', primary.token)
    .send({
      description: 'Initial merchant',
      amount: 42.5,
      type: 'expense',
      date: currentDate
    });
  assert.equal(created.status, 201, created.text);

  const edited = await authenticated('put', `/api/transactions/${created.body.id}`, primary.token)
    .send({
      description: 'Edited merchant',
      amount: 50,
      type: 'expense',
      date: currentDate
    });
  assert.equal(edited.status, 200, edited.text);
  assert.equal(edited.body.merchant, 'Edited merchant');

  const list = await authenticated('get', '/api/transactions', primary.token);
  assert.equal(list.status, 200, list.text);
  assert.ok(list.body.some((transaction) => transaction.id === created.body.id));

  const deleted = await authenticated('delete', `/api/transactions/${created.body.id}`, primary.token);
  assert.equal(deleted.status, 204, deleted.text);
});

test('prevents one user from reading, editing, or deleting another user transaction', async () => {
  const created = await authenticated('post', '/api/transactions', primary.token)
    .send({
      description: 'Private transaction',
      amount: 20,
      type: 'expense',
      date: currentDate
    });
  assert.equal(created.status, 201, created.text);

  const secondaryList = await authenticated('get', '/api/transactions', secondary.token);
  assert.equal(secondaryList.status, 200, secondaryList.text);
  assert.equal(secondaryList.body.some((transaction) => transaction.id === created.body.id), false);

  const edit = await authenticated('put', `/api/transactions/${created.body.id}`, secondary.token)
    .send({
      description: 'Stolen transaction',
      amount: 1,
      type: 'expense',
      date: currentDate
    });
  assert.equal(edit.status, 404, edit.text);

  const remove = await authenticated('delete', `/api/transactions/${created.body.id}`, secondary.token);
  assert.equal(remove.status, 404, remove.text);

  const ownerList = await authenticated('get', '/api/transactions', primary.token);
  assert.ok(ownerList.body.some((transaction) => transaction.id === created.body.id));
});

test('creates a budget and reports its near-limit warning', async () => {
  const categoryResult = await pool.query(
    `SELECT id FROM categories
     WHERE user_id = $1 AND type = 'expense'
     ORDER BY name
     LIMIT 1`,
    [primary.user.id]
  );
  const categoryId = categoryResult.rows[0].id;

  const createdBudget = await authenticated('post', '/api/budgets', primary.token)
    .send({
      category_id: categoryId,
      month: currentMonth,
      monthly_limit: 100
    });
  assert.equal(createdBudget.status, 201, createdBudget.text);
  assert.equal(createdBudget.body.category_id, categoryId);

  await pool.query(
    `INSERT INTO transactions (user_id, category_id, type, merchant, amount, transaction_date)
     VALUES ($1, $2, 'expense', 'Budget test', 85, $3)`,
    [primary.user.id, categoryId, currentDate]
  );

  const spending = await pool.query(
    `SELECT SUM(amount) AS spent
     FROM transactions
     WHERE user_id = $1 AND category_id = $2 AND type = 'expense'`,
    [primary.user.id, categoryId]
  );
  const warning = buildBudgetAlert({
    id: createdBudget.body.id,
    category_name: 'Budget category',
    limit_amount: createdBudget.body.limit_amount,
    spent: spending.rows[0].spent
  });
  assert.equal(warning.status, 'warning');
  assert.equal(warning.percent, 85);
  assert.equal(warning.remaining, 15);
});

test('processes a due recurring transaction exactly once per run date', async () => {
  const recurring = await pool.query(
    `INSERT INTO recurring_transactions
      (user_id, description, amount, type, frequency, start_date, next_run_date)
     VALUES ($1, 'Monthly rent', 700, 'expense', 'monthly', $2, $2)
     RETURNING id`,
    [primary.user.id, currentDate]
  );

  const result = await processDueRecurring(primary.user.id);
  assert.equal(result.createdCount, 1);
  assert.deepEqual(result.errors, []);

  const transaction = await pool.query(
    `SELECT source, merchant, amount
     FROM transactions
     WHERE user_id = $1 AND source = 'recurring' AND merchant = 'Monthly rent'`,
    [primary.user.id]
  );
  assert.equal(transaction.rowCount, 1);
  assert.equal(Number(transaction.rows[0].amount), 700);

  const schedule = await pool.query(
    'SELECT next_run_date FROM recurring_transactions WHERE id = $1',
    [recurring.rows[0].id]
  );
  assert.notEqual(String(schedule.rows[0].next_run_date).slice(0, 10), currentDate);
});

test('validates CSV imports and imports only usable rows', async () => {
  const missing = await authenticated('post', '/api/imports/csv', primary.token);
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, 'CSV file is required');

  const csv = [
    'date,merchant,amount,type',
    `${currentDate},Imported salary,1200,income`,
    `${currentDate},Imported expense,-30,expense`,
    ',Missing date,12,expense'
  ].join('\n');

  const imported = await authenticated('post', '/api/imports/csv', primary.token)
    .attach('statement', Buffer.from(csv), {
      filename: 'statement.csv',
      contentType: 'text/csv'
    });
  assert.equal(imported.status, 201, imported.text);
  assert.equal(imported.body.inserted, 2);
});

test('calculates current-month income, expenses, cash flow, and category spend', async () => {
  const summary = await authenticated('get', '/api/analytics/summary', primary.token);
  assert.equal(summary.status, 200, summary.text);
  assert.ok(Number(summary.body.income) >= 1200);
  assert.ok(Number(summary.body.expenses) >= 885);
  assert.equal(
    Number(summary.body.cash_flow),
    Number(summary.body.income) - Number(summary.body.expenses)
  );

  const categorySpend = await authenticated('get', '/api/analytics/category-spend', primary.token);
  assert.equal(categorySpend.status, 200, categorySpend.text);
  assert.ok(categorySpend.body.some((row) => Number(row.total) >= 85));
});
