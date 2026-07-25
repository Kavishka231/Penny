import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const baseUrl = process.env.E2E_BASE_URL;
const browserPath = process.env.E2E_BROWSER_PATH
  || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

test('completes critical finance flows through the browser', {
  skip: !baseUrl ? 'E2E_BASE_URL is required for browser tests' : false,
  timeout: 60_000
}, async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const page = await browser.newPage();
  const unique = Date.now();
  const email = `browser-${unique}@example.com`;

  try {
    await page.route('https://cdn.jsdelivr.net/**', (route) => route.fulfill({
      contentType: 'application/javascript',
      body: 'window.Chart = class { destroy() {} };'
    }));
    await page.goto(`${baseUrl}/app.html`);

    await page.locator('#auth-form [name="name"]').fill('Browser Contract User');
    await page.locator('#auth-form [name="email"]').fill(email);
    await page.locator('#auth-form [name="password"]').fill('StrongPass123!');
    await page.locator('#auth-form button[data-mode="register"]').click();
    await page.locator('#app-content').waitFor({ state: 'visible' });

    await page.locator('[data-view="transactions"]').click();
    await page.locator('#transaction-form [name="merchant"]').fill('Browser Merchant');
    await page.locator('#transaction-form [name="amount"]').fill('42.50');
    await page.locator('#transaction-form button[type="submit"]').click();
    await page.locator('#transaction-table').getByText('Browser Merchant').waitFor();

    await page.locator('#transaction-table [data-edit]').click();
    await page.locator('#transaction-form [name="merchant"]').fill('Edited Browser Merchant');
    await page.locator('#transaction-form button[type="submit"]').click();
    await page.locator('#transaction-table').getByText('Edited Browser Merchant').waitFor();

    await page.locator('[data-view="budgets"]').click();
    const budgetCategory = page.locator('#budget-category option').first();
    assert.ok(await budgetCategory.getAttribute('value'));
    await page.locator('#budget-form [name="limitAmount"]').fill('500');
    await page.locator('#budget-form button[type="submit"]').click();
    await page.locator('#budget-list .budget-item').first().waitFor();

    await page.locator('[data-view="recurring"]').click();
    await page.locator('#recurring-form [name="description"]').fill('Browser Monthly Rent');
    await page.locator('#recurring-form [name="amount"]').fill('700');
    await page.locator('#recurring-form button[type="submit"]').click();
    await page.locator('#recurring-table').getByText('Browser Monthly Rent').waitFor();

    await page.locator('[data-view="profile"]').click();
    await page.locator('#profile-form [name="name"]').fill('Updated Browser User');
    await page.locator('#profile-form [name="preferredCurrency"]').selectOption('LKR');
    await page.locator('#profile-form [name="budgetResetDay"]').fill('5');
    await page.locator('#profile-form button[type="submit"]').click();
    await page.locator('#profile-result').getByText('Profile saved successfully.').waitFor();

    await page.locator('#logout-btn').click();
    await page.locator('#auth-panel details summary').click();
    await page.locator('#reset-email').fill(email);
    await page.locator('#prepare-reset-btn').click();
    await page.waitForFunction(
      () => /^[a-f0-9]{64}$/.test(document.querySelector('#reset-token')?.value || '')
    );
    assert.match(await page.locator('#reset-token').inputValue(), /^[a-f0-9]{64}$/);
    await page.locator('#reset-new-password').fill('UpdatedPass456!');
    await page.locator('#reset-password-btn').click();
    await page.locator('#reset-result').getByText('Password reset successfully.').waitFor();

    await page.locator('#auth-form [name="email"]').fill(email);
    await page.locator('#auth-form [name="password"]').fill('UpdatedPass456!');
    await page.locator('#auth-form button[data-mode="login"]').click();
    await page.locator('#app-content').waitFor({ state: 'visible' });
  } finally {
    await browser.close();
  }
});
