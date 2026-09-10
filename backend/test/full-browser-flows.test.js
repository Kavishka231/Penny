import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright-core';

const browserPath = process.env.E2E_BROWSER_PATH
  || (process.platform === 'win32'
    ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    : undefined);

let browser;
let context;
let page;
let httpServer;
let pool;
let baseUrl;

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function register(name, email, password = 'StrongPass123!') {
  await page.locator('#auth-form [name="name"]').fill(name);
  await page.locator('#auth-form [name="email"]').fill(email);
  await page.locator('#auth-form [name="password"]').fill(password);
  await page.locator('#auth-form button[data-mode="register"]').click();
  await page.locator('#app-content').waitFor({ state: 'visible' });
}

async function login(email, password = 'StrongPass123!') {
  await page.locator('#auth-form [name="email"]').fill(email);
  await page.locator('#auth-form [name="password"]').fill(password);
  await page.locator('#auth-form button[data-mode="login"]').click();
  await page.locator('#app-content').waitFor({ state: 'visible' });
}

async function logout() {
  await page.locator('#logout-btn').click();
  await page.locator('#auth-panel').waitFor({ state: 'visible' });
}

async function openView(view) {
  await page.locator(`[data-view="${view}"]`).click();
  await page.locator(`#${view}`).waitFor({ state: 'visible' });
}

async function createTransaction({ merchant, amount, categoryId = '' }) {
  await openView('transactions');
  await page.locator('#transaction-form [name="merchant"]').fill(merchant);
  await page.locator('#transaction-form [name="amount"]').fill(String(amount));
  if (categoryId) {
    await page.locator('#transaction-category').selectOption(categoryId);
  }
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => (
      candidate.url().includes('/api/transactions')
      && ['POST', 'PUT'].includes(candidate.request().method())
    )),
    page.locator('#transaction-form button[type="submit"]').click()
  ]);
  assert.equal(response.request().method(), 'POST', 'Expected a new transaction request');
  assert.equal(response.status(), 201, await response.text());
  await page.locator('#transaction-table').getByText(merchant, { exact: true }).waitFor();
}

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'full-browser-flows-test-secret';
  process.env.PASSWORD_RESET_EXPOSE_TOKEN = 'true';
  process.env.PASSWORD_RESET_RATE_LIMIT_MAX = '20';
  process.env.FRONTEND_DIR = path.resolve(process.cwd(), '..', 'frontend');

  const modules = await Promise.all([
    import('../src/app.js'),
    import('../src/db.js')
  ]);
  const app = modules[0].default;
  pool = modules[1].pool;

  httpServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => httpServer.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  process.env.APP_BASE_URL = baseUrl;

  browser = await chromium.launch({
    ...(browserPath ? { executablePath: browserPath } : {}),
    headless: true
  });
  context = await browser.newContext();
  page = await context.newPage();
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.Chart = class { destroy() {} };'
  }));
});

after(async () => {
  await browser?.close();
  httpServer?.closeAllConnections();
  if (httpServer) await close(httpServer);
  await pool?.end();
});

test('uses the real API for critical authenticated finance flows', { timeout: 90_000 }, async () => {
  const unique = Date.now();
  const ownerEmail = `browser-owner-${unique}@example.com`;
  const otherEmail = `browser-other-${unique}@example.com`;
  const maliciousMerchant = '<img src=x onerror=alert(1)>';
  let dialogCount = 0;
  page.on('dialog', async (dialog) => {
    dialogCount += 1;
    await dialog.dismiss();
  });

  await page.goto(`${baseUrl}/app.html`);
  await register('Browser Owner', ownerEmail);
  assert.equal(await page.evaluate(() => localStorage.getItem('penny_token')), null);
  assert.equal(await page.evaluate(() => document.cookie.includes('penny_session=')), false);
  const sessionCookie = (await context.cookies()).find((cookie) => cookie.name === 'penny_session');
  assert.equal(sessionCookie?.httpOnly, true);
  assert.equal(sessionCookie?.sameSite, 'Strict');

  const expenseCategoryId = await page.locator('#transaction-category option')
    .filter({ hasNotText: 'Uncategorized' })
    .first()
    .getAttribute('value');
  assert.ok(expenseCategoryId, 'Expected registration to create expense categories');

  const owner = await pool.query('SELECT id FROM users WHERE email = $1', [ownerEmail]);
  const paginationMerchant = 'Browser pagination fixture';
  await Promise.all(Array.from({ length: 26 }, (_, index) => pool.query(
    `INSERT INTO transactions (user_id, type, merchant, amount, transaction_date)
     VALUES ($1, 'expense', $2, $3, '2020-01-15')`,
    [owner.rows[0].id, `${paginationMerchant} ${String(index + 1).padStart(2, '0')}`, index + 1]
  )));

  await openView('transactions');
  await page.locator('#search').fill(paginationMerchant);
  await page.locator('#transaction-page-summary').getByText('Page 1 of 2', { exact: true }).waitFor();
  assert.equal(await page.locator('#transaction-table tr').count(), 25);
  assert.equal(await page.locator('#transaction-page-summary').textContent(), 'Page 1 of 2');
  assert.equal(await page.locator('#transaction-previous').isDisabled(), true);
  assert.equal(await page.locator('#transaction-next').isEnabled(), true);

  await page.locator('#transaction-next').click();
  await page.locator('#transaction-page-summary').getByText('Page 2 of 2', { exact: true }).waitFor();
  assert.equal(await page.locator('#transaction-table tr').count(), 1);
  assert.equal(await page.locator('#transaction-page-summary').textContent(), 'Page 2 of 2');
  assert.equal(await page.locator('#transaction-previous').isEnabled(), true);
  assert.equal(await page.locator('#transaction-next').isDisabled(), true);

  await page.locator('#clear-filters-btn').click();
  await page.locator('#transaction-page-summary').getByText('Page 1 of 2', { exact: true }).waitFor();

  await createTransaction({
    merchant: 'Browser Merchant',
    amount: 42.50,
    categoryId: expenseCategoryId
  });
  await page.locator('#transaction-table [data-edit]').first().click();
  await page.locator('#transaction-form [name="merchant"]').fill('Edited Browser Merchant');
  await page.locator('#transaction-form button[type="submit"]').click();
  const editedRow = page.locator('#transaction-table tr', { hasText: 'Edited Browser Merchant' });
  await editedRow.waitFor();
  await editedRow.locator('[data-delete]').click();
  await editedRow.waitFor({ state: 'detached' });

  await createTransaction({
    merchant: maliciousMerchant,
    amount: 12,
    categoryId: expenseCategoryId
  });
  const maliciousCell = page.locator('#transaction-table td', { hasText: maliciousMerchant });
  await maliciousCell.waitFor();
  assert.equal(await maliciousCell.textContent(), maliciousMerchant);
  assert.equal(await maliciousCell.locator('img').count(), 0);
  assert.equal(dialogCount, 0, 'Stored HTML must never execute in the browser');

  await createTransaction({
    merchant: 'Budget warning expense',
    amount: 85,
    categoryId: expenseCategoryId
  });
  await openView('budgets');
  await page.locator('#budget-category').selectOption(expenseCategoryId);
  await page.locator('#budget-form [name="limitAmount"]').fill('100');
  await page.locator('#budget-form button[type="submit"]').click();
  const warning = page.locator('#budget-list .budget-item.warning');
  await warning.waitFor();
  assert.match(await warning.textContent(), /near monthly limit/i);

  await openView('recurring');
  await page.locator('#recurring-form [name="description"]').fill('Browser Monthly Rent');
  await page.locator('#recurring-form [name="amount"]').fill('700');
  await page.locator('#recurring-form button[type="submit"]').click();
  const recurringRow = page.locator('#recurring-table tr', { hasText: 'Browser Monthly Rent' });
  await recurringRow.waitFor();
  await recurringRow.locator('[data-recurring-toggle]').click();
  await recurringRow.getByText('Paused', { exact: true }).waitFor();
  await recurringRow.locator('[data-recurring-delete]').click();
  await recurringRow.waitFor({ state: 'detached' });

  await openView('tools');
  await page.locator('#csv-form input[name="statement"]').setInputFiles({
    name: 'browser-statement.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([
      'date,merchant,amount,type',
      `${new Date().toISOString().slice(0, 10)},Browser CSV Merchant,-33.25,expense`
    ].join('\n'))
  });
  await page.locator('#csv-form button[type="submit"]').click();
  await page.locator('#csv-result').getByText('Imported 1 transactions.').waitFor();
  await openView('transactions');
  await page.locator('#transaction-table').getByText('Browser CSV Merchant', { exact: true }).waitFor();

  await logout();
  await register('Other Browser User', otherEmail);
  await openView('transactions');
  assert.equal(await page.locator('#transaction-table').getByText(maliciousMerchant, { exact: true }).count(), 0);
  assert.equal(await page.locator('#transaction-table').getByText('Browser CSV Merchant', { exact: true }).count(), 0);

  await logout();
  await login(ownerEmail);
  await openView('transactions');
  await page.locator('#transaction-table').getByText(maliciousMerchant, { exact: true }).waitFor();
});

test('supports mobile application navigation and landing-page links', { timeout: 30_000 }, async () => {
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobileContext.newPage();
  const failedResponses = [];
  mobilePage.on('response', (response) => {
    const expectedAnonymousSessionCheck = response.status() === 401
      && ['/api/auth/me', '/api/auth/refresh'].some((path) => response.url().endsWith(path));
    if (response.status() >= 400
        && !response.url().endsWith('/favicon.ico')
        && !expectedAnonymousSessionCheck) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  try {
    await mobilePage.goto(`${baseUrl}/`);
    assert.equal(await mobilePage.locator('.nav-cta').getAttribute('href'), '/app.html');
    await mobilePage.locator('.header-nav a[href="#faq"]').click();
    await mobilePage.locator('#faq').waitFor({ state: 'visible' });
    assert.equal(await mobilePage.locator('.header-nav a').count(), 6);

    await mobilePage.locator('.nav-cta').click();
    await mobilePage.waitForURL(`${baseUrl}/app.html`);
    await mobilePage.locator('#auth-form [name="email"]').fill(
      `mobile-browser-${Date.now()}@example.com`
    );
    await mobilePage.locator('#auth-form [name="name"]').fill('Mobile Browser User');
    await mobilePage.locator('#auth-form [name="password"]').fill('StrongPass123!');
    await mobilePage.locator('#auth-form button[data-mode="register"]').click();
    await mobilePage.locator('#app-nav').waitFor({ state: 'visible' });
    await mobilePage.locator('[data-view="transactions"]').click();
    await mobilePage.locator('#transactions').waitFor({ state: 'visible' });
    assert.equal(await mobilePage.locator('#view-title').textContent(), 'Transactions');
    assert.deepEqual(failedResponses, []);
  } finally {
    await mobileContext.close();
  }
});
