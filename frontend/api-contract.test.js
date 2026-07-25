import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authPayload,
  budgetPayload,
  profilePayload,
  recurringPayload,
  resetPasswordPayload,
  transactionPayload
} from './api-contract.js';

test('keeps login strict while including the name only for registration', () => {
  const form = {
    name: 'Penny User',
    email: 'penny@example.com',
    password: 'StrongPass123!'
  };
  assert.deepEqual(authPayload(form, 'login'), {
    email: 'penny@example.com',
    password: 'StrongPass123!'
  });
  assert.deepEqual(authPayload(form, 'register'), form);
});

test('maps transaction forms to the validated API contract', () => {
  assert.deepEqual(transactionPayload({
    merchant: 'Fresh Mart',
    amount: '42.50',
    type: 'expense',
    categoryId: '14dd5195-fb64-40c2-a88c-8ce4c94d84a5',
    transactionDate: '2026-07-25',
    notes: 'Weekly shop'
  }), {
    description: 'Fresh Mart',
    amount: 42.5,
    type: 'expense',
    category_id: '14dd5195-fb64-40c2-a88c-8ce4c94d84a5',
    date: '2026-07-25',
    notes: 'Weekly shop'
  });
});

test('maps recurring and budget forms to snake-case numeric contracts', () => {
  assert.deepEqual(recurringPayload({
    description: 'Rent',
    amount: '700',
    type: 'expense',
    categoryId: '',
    frequency: 'monthly',
    startDate: '2026-07-25',
    endDate: ''
  }), {
    description: 'Rent',
    amount: 700,
    type: 'expense',
    category_id: undefined,
    frequency: 'monthly',
    start_date: '2026-07-25',
    end_date: undefined
  });

  assert.deepEqual(budgetPayload({
    categoryId: '14dd5195-fb64-40c2-a88c-8ce4c94d84a5',
    month: '2026-07',
    limitAmount: '500'
  }), {
    category_id: '14dd5195-fb64-40c2-a88c-8ce4c94d84a5',
    month: '2026-07',
    monthly_limit: 500
  });
});

test('converts profile numbers and omits optional blank fields', () => {
  assert.deepEqual(profilePayload({
    name: 'Penny User',
    email: 'penny@example.com',
    phone: '',
    address: '',
    preferredCurrency: 'LKR',
    themePreference: 'dark',
    budgetResetDay: '5',
    dateFormat: 'DD/MM/YYYY',
    password: ''
  }), {
    name: 'Penny User',
    email: 'penny@example.com',
    preferredCurrency: 'LKR',
    themePreference: 'dark',
    budgetResetDay: 5,
    dateFormat: 'DD/MM/YYYY'
  });
});

test('uses the password-reset contract accepted by the backend', () => {
  assert.deepEqual(resetPasswordPayload('one-time-token', 'StrongPass123!'), {
    token: 'one-time-token',
    password: 'StrongPass123!'
  });
});
