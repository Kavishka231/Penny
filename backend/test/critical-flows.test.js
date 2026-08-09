import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'penny-tests-only-secret';
process.env.PASSWORD_RESET_EXPOSE_TOKEN = 'true';
process.env.PASSWORD_RESET_RATE_LIMIT_MAX = '8';
process.env.ALLOWED_ORIGINS = 'https://trusted.penny.test';

let request;
let app;
let pool;
let processDueRecurring;
let buildBudgetAlert;
let hashResetToken;
let mayExposeResetToken;
let primary;
let secondary;
let validResetToken;

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
  ({ hashResetToken, mayExposeResetToken } = await import('../src/services/passwordResetService.js'));
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

test('reports database health and applies browser security policy', async () => {
  const health = await request(app).get('/api/health');
  assert.equal(health.status, 200, health.text);
  assert.equal(health.body.database, 'ready');
  assert.match(health.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(health.headers['x-content-type-options'], 'nosniff');

  const rejectedOrigin = await request(app)
    .get('/api/health')
    .set('Origin', 'https://untrusted.example.com');
  assert.equal(rejectedOrigin.status, 403, rejectedOrigin.text);
  assert.equal(rejectedOrigin.body.error, 'Origin is not allowed by CORS');
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
  assert.match(existing.body.resetToken, /^[a-f0-9]{64}$/);
  validResetToken = existing.body.resetToken;

  const stored = await pool.query(
    'SELECT reset_password_token_hash FROM users WHERE id = $1',
    [primary.user.id]
  );
  assert.equal(stored.rows[0].reset_password_token_hash, hashResetToken(validResetToken));
  assert.notEqual(stored.rows[0].reset_password_token_hash, validResetToken);

  const unknown = await request(app)
    .post('/api/auth/forgot-password')
    .send({ email: 'missing@example.com' });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.resetToken, undefined);
});

test('never permits reset-token exposure in production', () => {
  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  assert.equal(mayExposeResetToken(), false);
  process.env.NODE_ENV = previousEnvironment;
});

test('accepts a valid reset token once and updates the password', async () => {
  const reset = await request(app)
    .post('/api/auth/reset-password')
    .send({ token: validResetToken, newPassword: 'NewStrongPass456!' });
  assert.equal(reset.status, 200, reset.text);

  const stored = await pool.query(
    'SELECT reset_password_token_hash, reset_password_expires FROM users WHERE id = $1',
    [primary.user.id]
  );
  assert.equal(stored.rows[0].reset_password_token_hash, null);
  assert.equal(stored.rows[0].reset_password_expires, null);

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'primary@example.com', password: 'NewStrongPass456!' });
  assert.equal(login.status, 200, login.text);
});

test('rejects a reused reset token', async () => {
  const reused = await request(app)
    .post('/api/auth/reset-password')
    .send({ token: validResetToken, newPassword: 'AnotherStrongPass789!' });
  assert.equal(reused.status, 400);
  assert.equal(reused.body.error, 'Reset token is invalid or expired');
});

test('rejects an expired reset token', async () => {
  const requestReset = await request(app)
    .post('/api/auth/forgot-password')
    .send({ email: 'primary@example.com' });
  assert.equal(requestReset.status, 200, requestReset.text);

  await pool.query(
    `UPDATE users
     SET reset_password_expires = $2
     WHERE id = $1`,
    [primary.user.id, new Date(Date.now() - 60_000)]
  );

  const expired = await request(app)
    .post('/api/auth/reset-password')
    .send({ token: requestReset.body.resetToken, newPassword: 'ExpiredStrongPass123!' });
  assert.equal(expired.status, 400);
  assert.equal(expired.body.error, 'Reset token is invalid or expired');
});

test('rejects an invalid reset token', async () => {
  const invalid = await request(app)
    .post('/api/auth/reset-password')
    .send({ token: crypto.randomBytes(32).toString('hex'), newPassword: 'InvalidStrongPass123!' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, 'Reset token is invalid or expired');
});

test('creates, edits, reads, and deletes a transaction', async () => {
  const created = await authenticated('post', '/api/transactions', primary.token)
    .send({
      description: 'Initial merchant',
      amount: 42.5,
      type: 'expense',
      date: currentDate,
      notes: 'Created through the browser contract'
    });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.body.notes, 'Created through the browser contract');

  const edited = await authenticated('put', `/api/transactions/${created.body.id}`, primary.token)
    .send({
      description: 'Edited merchant',
      amount: 50,
      type: 'expense',
      date: currentDate,
      notes: 'Edited through the browser contract'
    });
  assert.equal(edited.status, 200, edited.text);
  assert.equal(edited.body.merchant, 'Edited merchant');
  assert.equal(edited.body.notes, 'Edited through the browser contract');

  const list = await authenticated('get', '/api/transactions', primary.token);
  assert.equal(list.status, 200, list.text);
  assert.ok(list.body.some((transaction) => transaction.id === created.body.id));

  const deleted = await authenticated('delete', `/api/transactions/${created.body.id}`, primary.token);
  assert.equal(deleted.status, 204, deleted.text);
});

test('patches only the supplied transaction fields', async () => {
  const categories = await authenticated('get', '/api/categories', primary.token);
  const expenseCategories = categories.body.filter((category) => category.type === 'expense');
  assert.ok(expenseCategories.length >= 2);

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const created = await authenticated('post', '/api/transactions', primary.token)
    .send({
      description: 'Original merchant',
      amount: 100,
      type: 'expense',
      category_id: expenseCategories[0].id,
      date: currentDate,
      notes: 'Original notes'
    });
  assert.equal(created.status, 201, created.text);

  let current = created.body;
  const patchAndVerify = async (body, changedFields) => {
    const before = current;
    const response = await authenticated(
      'patch',
      `/api/transactions/${created.body.id}`,
      primary.token
    ).send(body);
    assert.equal(response.status, 200, response.text);

    for (const field of ['type', 'category_id', 'merchant', 'amount', 'transaction_date', 'notes']) {
      if (!changedFields.includes(field)) {
        assert.equal(String(response.body[field]), String(before[field]), `${field} changed unexpectedly`);
      }
    }
    current = response.body;
    return response.body;
  };

  const amountOnly = await patchAndVerify({ amount: 500 }, ['amount']);
  assert.equal(Number(amountOnly.amount), 500);

  const descriptionOnly = await patchAndVerify({ description: 'Changed merchant' }, ['merchant']);
  assert.equal(descriptionOnly.merchant, 'Changed merchant');

  const categoryOnly = await patchAndVerify(
    { category_id: expenseCategories[1].id },
    ['category_id']
  );
  assert.equal(categoryOnly.category_id, expenseCategories[1].id);

  const dateOnly = await patchAndVerify({ date: yesterday }, ['transaction_date']);
  assert.equal(String(dateOnly.transaction_date).slice(0, 10), yesterday);

  const multiple = await patchAndVerify(
    { amount: 725.5, description: 'Multi-field merchant', notes: 'Multi-field notes' },
    ['amount', 'merchant', 'notes']
  );
  assert.equal(Number(multiple.amount), 725.5);
  assert.equal(multiple.merchant, 'Multi-field merchant');
  assert.equal(multiple.notes, 'Multi-field notes');

  const invalidField = await authenticated(
    'patch',
    `/api/transactions/${created.body.id}`,
    primary.token
  ).send({ unsupported: 'value' });
  assert.equal(invalidField.status, 400, invalidField.text);

  const emptyPatch = await authenticated(
    'patch',
    `/api/transactions/${created.body.id}`,
    primary.token
  ).send({});
  assert.equal(emptyPatch.status, 400, emptyPatch.text);

  const afterRejectedPatches = await authenticated('get', '/api/transactions', primary.token);
  const unchanged = afterRejectedPatches.body.find((transaction) => transaction.id === created.body.id);
  assert.equal(Number(unchanged.amount), 725.5);
  assert.equal(unchanged.merchant, 'Multi-field merchant');
  assert.equal(unchanged.category_id, expenseCategories[1].id);
  assert.equal(String(unchanged.transaction_date).slice(0, 10), yesterday);

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

test('rejects cross-user categories across transactions, budgets, and recurring data', async () => {
  const primaryCategories = await authenticated('get', '/api/categories', primary.token);
  const secondaryCategories = await authenticated('get', '/api/categories', secondary.token);
  const primaryCategory = primaryCategories.body.find((category) => category.type === 'expense');
  const secondaryCategory = secondaryCategories.body.find((category) => category.type === 'expense');

  const createTransaction = await authenticated('post', '/api/transactions', primary.token)
    .send({
      description: 'Unauthorized category transaction',
      amount: 10,
      type: 'expense',
      category_id: secondaryCategory.id,
      date: currentDate
    });
  assert.equal(createTransaction.status, 400, createTransaction.text);

  const ownTransaction = await authenticated('post', '/api/transactions', primary.token)
    .send({
      description: 'Owned transaction',
      amount: 10,
      type: 'expense',
      category_id: primaryCategory.id,
      date: currentDate
    });
  assert.equal(ownTransaction.status, 201, ownTransaction.text);

  const updateTransaction = await authenticated(
    'put',
    `/api/transactions/${ownTransaction.body.id}`,
    primary.token
  ).send({
    description: 'Unauthorized update',
    amount: 10,
    type: 'expense',
    category_id: secondaryCategory.id,
    date: currentDate
  });
  assert.equal(updateTransaction.status, 400, updateTransaction.text);

  const createBudget = await authenticated('post', '/api/budgets', primary.token)
    .send({ category_id: secondaryCategory.id, monthly_limit: 100, month: currentMonth });
  assert.equal(createBudget.status, 400, createBudget.text);

  const createRecurring = await authenticated('post', '/api/recurring', primary.token)
    .send({
      description: 'Unauthorized recurring category',
      amount: 10,
      type: 'expense',
      category_id: secondaryCategory.id,
      frequency: 'monthly',
      start_date: currentDate
    });
  assert.equal(createRecurring.status, 400, createRecurring.text);

  const ownRecurring = await authenticated('post', '/api/recurring', primary.token)
    .send({
      description: 'Owned recurring category',
      amount: 10,
      type: 'expense',
      category_id: primaryCategory.id,
      frequency: 'monthly',
      start_date: currentDate
    });
  assert.equal(ownRecurring.status, 201, ownRecurring.text);

  const updateRecurring = await authenticated(
    'put',
    `/api/recurring/${ownRecurring.body.id}`,
    primary.token
  ).send({ category_id: secondaryCategory.id });
  assert.equal(updateRecurring.status, 400, updateRecurring.text);

  await assert.rejects(
    pool.query(
      `INSERT INTO transactions (user_id, category_id, type, merchant, amount, transaction_date)
       VALUES ($1, $2, 'expense', 'Database ownership check', 10, $3)`,
      [primary.user.id, secondaryCategory.id, currentDate]
    )
  );

  const deleteTransaction = await authenticated(
    'delete',
    `/api/transactions/${ownTransaction.body.id}`,
    primary.token
  );
  assert.equal(deleteTransaction.status, 204, deleteTransaction.text);

  const deleteRecurring = await authenticated(
    'delete',
    `/api/recurring/${ownRecurring.body.id}`,
    primary.token
  );
  assert.equal(deleteRecurring.status, 204, deleteRecurring.text);
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
  const recurring = await authenticated('post', '/api/recurring', primary.token)
    .send({
      description: 'Monthly rent',
      amount: 700,
      type: 'expense',
      frequency: 'monthly',
      start_date: currentDate
    });
  assert.equal(recurring.status, 201, recurring.text);

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
    [recurring.body.id]
  );
  assert.notEqual(String(schedule.rows[0].next_run_date).slice(0, 10), currentDate);
});

test('updates profile settings using the browser contract', async () => {
  const updated = await authenticated('put', '/api/profile', primary.token)
    .send({
      name: 'Updated Penny User',
      email: 'updated-primary@example.com',
      preferredCurrency: 'LKR',
      themePreference: 'dark',
      budgetResetDay: 5,
      dateFormat: 'DD/MM/YYYY'
    });

  assert.equal(updated.status, 200, updated.text);
  assert.equal(updated.body.name, 'Updated Penny User');
  assert.equal(updated.body.email, 'updated-primary@example.com');
  assert.equal(updated.body.preferred_currency, 'LKR');
  assert.equal(updated.body.theme_preference, 'dark');
  assert.equal(updated.body.budget_reset_day, 5);
  assert.equal(updated.body.date_format, 'DD/MM/YYYY');
});

test('patches profile fields without resetting omitted settings', async () => {
  const initialResponse = await authenticated('get', '/api/profile', primary.token);
  assert.equal(initialResponse.status, 200, initialResponse.text);
  const initial = initialResponse.body;
  let current = initial;
  const profileFields = [
    'name', 'email', 'phone', 'address', 'preferred_currency', 'timezone',
    'theme_preference', 'budget_reset_day', 'date_format'
  ];

  const patchAndVerify = async (body, changedFields) => {
    const before = current;
    const response = await authenticated('patch', '/api/profile', primary.token).send(body);
    assert.equal(response.status, 200, response.text);
    for (const field of profileFields) {
      if (!changedFields.includes(field)) {
        assert.equal(response.body[field], before[field], `${field} changed unexpectedly`);
      }
    }
    current = response.body;
    return response.body;
  };

  const nameOnly = await patchAndVerify({ name: 'Kavishka' }, ['name']);
  assert.equal(nameOnly.name, 'Kavishka');

  const emailOnly = await patchAndVerify(
    { email: 'kavishka.profile@example.com' },
    ['email']
  );
  assert.equal(emailOnly.email, 'kavishka.profile@example.com');

  const currencyOnly = await patchAndVerify({ currency: 'USD' }, ['preferred_currency']);
  assert.equal(currencyOnly.preferred_currency, 'USD');

  const timezoneOnly = await patchAndVerify({ timezone: 'Asia/Colombo' }, ['timezone']);
  assert.equal(timezoneOnly.timezone, 'Asia/Colombo');

  const preferencesOnly = await patchAndVerify({
    preferences: {
      themePreference: 'light',
      budgetResetDay: 7,
      dateFormat: 'YYYY-MM-DD'
    }
  }, ['theme_preference', 'budget_reset_day', 'date_format']);
  assert.equal(preferencesOnly.theme_preference, 'light');
  assert.equal(preferencesOnly.budget_reset_day, 7);
  assert.equal(preferencesOnly.date_format, 'YYYY-MM-DD');

  const combined = await patchAndVerify({
    name: 'Combined Profile',
    currency: 'LKR',
    timezone: 'Europe/London',
    preferences: { themePreference: 'dark', budgetResetDay: 12 }
  }, ['name', 'preferred_currency', 'timezone', 'theme_preference', 'budget_reset_day']);
  assert.equal(combined.name, 'Combined Profile');
  assert.equal(combined.preferred_currency, 'LKR');
  assert.equal(combined.timezone, 'Europe/London');
  assert.equal(combined.theme_preference, 'dark');
  assert.equal(combined.budget_reset_day, 12);

  const restored = await authenticated('patch', '/api/profile', primary.token).send({
    name: initial.name,
    email: initial.email,
    preferredCurrency: initial.preferred_currency,
    timezone: initial.timezone,
    themePreference: initial.theme_preference,
    budgetResetDay: initial.budget_reset_day,
    dateFormat: initial.date_format
  });
  assert.equal(restored.status, 200, restored.text);
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

test('calculates budget progress and ranks current-month expense merchants', async () => {
  const budgetProgress = await authenticated('get', '/api/analytics/budget-progress', primary.token);
  assert.equal(budgetProgress.status, 200, budgetProgress.text);
  assert.ok(budgetProgress.body.some((row) => (
    Number(row.limit_amount) === 100 && Number(row.spent) >= 85
  )), JSON.stringify(budgetProgress.body));

  const topMerchants = await authenticated('get', '/api/analytics/top-merchants', primary.token);
  assert.equal(topMerchants.status, 200, topMerchants.text);
  assert.ok(topMerchants.body.some((row) => (
    row.merchant === 'Budget test' && Number(row.total) >= 85
  )), JSON.stringify(topMerchants.body));
});

test('rate limits repeated password-reset requests', async () => {
  let limitedResponse;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'rate-limit@example.com' });
    if (response.status === 429) {
      limitedResponse = response;
      break;
    }
  }

  assert.ok(limitedResponse, 'Expected password reset requests to be rate limited');
  assert.equal(
    limitedResponse.body.error,
    'Too many password reset requests. Please try again later.'
  );
});
