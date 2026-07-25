import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { chromium } from 'playwright-core';

const browserPath = process.env.E2E_BROWSER_PATH
  || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function listen(server, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.removeListener('error', reject);
      resolve(typeof server.address === 'function' ? server.address() : server.server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function waitForMessage(messages) {
  const deadline = Date.now() + 10_000;
  while (!messages.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(messages.length, 1, 'Expected exactly one password-reset email');
  return messages[0];
}

test('delivers and consumes a one-time password-reset link through SMTP and the browser', {
  timeout: 60_000
}, async () => {
  const messages = [];
  const smtpServer = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    closeTimeout: 100,
    onData(stream, _session, callback) {
      simpleParser(stream)
        .then((message) => {
          messages.push(message);
          callback();
        })
        .catch(callback);
    }
  });
  const smtpAddress = await listen(smtpServer);

  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'password-reset-browser-test-secret';
  process.env.PASSWORD_RESET_EXPOSE_TOKEN = 'false';
  process.env.PASSWORD_RESET_RATE_LIMIT_MAX = '20';
  process.env.PASSWORD_RESET_FROM = 'Penny <no-reply@example.com>';
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(smtpAddress.port);
  process.env.SMTP_SECURE = 'false';
  process.env.FRONTEND_DIR = path.resolve(process.cwd(), '..', 'frontend');

  const [{ default: app }, { pool }] = await Promise.all([
    import('../src/app.js'),
    import('../src/db.js')
  ]);
  const httpServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => httpServer.once('listening', resolve));
  const httpAddress = httpServer.address();
  const baseUrl = `http://127.0.0.1:${httpAddress.port}`;
  process.env.APP_BASE_URL = baseUrl;

  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const page = await browser.newPage();
  const email = `reset-browser-${Date.now()}@example.com`;

  try {
    await page.route('https://cdn.jsdelivr.net/**', (route) => route.fulfill({
      contentType: 'application/javascript',
      body: 'window.Chart = class { destroy() {} };'
    }));
    for (const pathPattern of [
      '/api/analytics/**',
      '/api/alerts',
      '/api/budgets**',
      '/api/transactions**',
      '/api/recurring'
    ]) {
      await page.route(`${baseUrl}${pathPattern}`, (route) => route.fulfill({
        contentType: 'application/json',
        body: '[]'
      }));
    }
    await page.goto(`${baseUrl}/app.html`);

    await page.locator('#auth-form [name="name"]').fill('Reset Browser User');
    await page.locator('#auth-form [name="email"]').fill(email);
    await page.locator('#auth-form [name="password"]').fill('StrongPass123!');
    await page.locator('#auth-form button[data-mode="register"]').click();
    await page.locator('#app-content').waitFor({ state: 'visible' });
    await page.locator('#logout-btn').click();

    await page.locator('#auth-panel details summary').click();
    await page.locator('#reset-email').fill(email);
    await page.locator('#prepare-reset-btn').click();
    await page.locator('#reset-result').getByText('If that account exists').waitFor();
    assert.equal(await page.locator('#reset-token').inputValue(), '');

    const message = await waitForMessage(messages);
    assert.equal(message.to.value[0].address, email);
    const resetUrl = message.text.match(/https?:\/\/\S+\?resetToken=[a-f0-9]{64}/)?.[0];
    assert.ok(resetUrl, 'Expected the email to contain a reset link');

    await page.goto(resetUrl);
    const resetToken = await page.locator('#reset-token').inputValue();
    assert.match(resetToken, /^[a-f0-9]{64}$/);
    assert.equal(page.url().includes('resetToken='), false);
    await page.locator('#reset-new-password').fill('UpdatedPass456!');
    await page.locator('#reset-password-btn').click();
    await page.locator('#reset-result').getByText('Password reset successfully.').waitFor();

    await page.goto(resetUrl);
    await page.locator('#reset-new-password').fill('ReusedPass789!');
    await page.locator('#reset-password-btn').click();
    await page.locator('#reset-result').getByText('Reset token is invalid or expired').waitFor();

    await page.locator('#auth-form [name="email"]').fill(email);
    await page.locator('#auth-form [name="password"]').fill('UpdatedPass456!');
    await page.locator('#auth-form button[data-mode="login"]').click();
    await page.locator('#app-content').waitFor({ state: 'visible' });
  } finally {
    await browser.close();
    httpServer.closeAllConnections();
    await close(httpServer);
    await pool.end();
    smtpServer.connections.forEach((connection) => connection.close());
    await close(smtpServer);
  }
});
