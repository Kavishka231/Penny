import {
  authPayload,
  budgetPayload,
  profilePayload,
  recurringPayload,
  resetPasswordPayload,
  transactionPayload
} from './api-contract.js';
import { budgetMonthValue, dateInputValue, formatDate } from './date-preferences.js';
import { escapeHtml } from './safe-html.js';

const state = {
  authenticated: false,
  user: null,
  csrfToken: null,
  categories: [],
  transactions: [],
  transactionPagination: {
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrevious: false
  },
  timeZone: null,
  dateFormat: 'YYYY-MM-DD',
  budgetResetDay: 1,
  recurringTransactions: [],
  charts: {}
};

let transactionRequestController;
let transactionFilterTimer;

const themeToggle = document.querySelector('.theme-toggle');
const savedTheme = localStorage.getItem('penny_theme') || 'light';

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('penny_theme', theme);
  if (themeToggle) themeToggle.textContent = theme === 'dark' ? 'Light' : 'Dark';
  const themePreference = document.querySelector('[name="themePreference"]');
  if (themePreference) themePreference.value = theme;
}

setTheme(savedTheme);

themeToggle?.addEventListener('click', () => {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

let money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
let today = dateInputValue();
let thisMonth = budgetMonthValue(today, state.budgetResetDay);

function applyResetTokenFromUrl() {
  const url = new URL(window.location.href);
  const resetToken = url.searchParams.get('resetToken');
  if (!resetToken) return;

  document.querySelector('#reset-token').value = resetToken;
  document.querySelector('#auth-panel details').open = true;
  setStatus('#reset-result', 'Reset link verified. Enter a new password to continue.');

  url.searchParams.delete('resetToken');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function setLoading(button, loadingText = 'Saving...') {
  if (!button) return () => {};
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = loadingText;
  return () => {
    button.disabled = false;
    button.textContent = originalText;
  };
}

function setStatus(selector, message, isError = false) {
  const node = document.querySelector(selector);
  if (!node) return;
  node.textContent = message;
  node.classList.toggle('error', isError);
}

function markInvalid(field, invalid) {
  field?.classList.toggle('field-error', invalid);
}

function validatePositiveAmount(field) {
  const invalid = !field.value || Number(field.value) <= 0;
  markInvalid(field, invalid);
  return !invalid;
}

function validateRequired(form, names) {
  let valid = true;
  for (const name of names) {
    const field = form.elements[name];
    const invalid = !field?.value?.trim();
    markInvalid(field, invalid);
    if (invalid) valid = false;
  }
  return valid;
}

document.querySelector('[name="transactionDate"]').value = today;
document.querySelector('[name="month"]').value = thisMonth;
document.querySelector('[name="startDate"]').value = today;
applyResetTokenFromUrl();

function refreshRecurringCategoryOptions() {
  const type = document.querySelector('#recurring-form [name="type"]')?.value || null;
  const select = document.querySelector('#recurring-category');
  if (!select) return;
  select.innerHTML = '<option value="">Uncategorized</option>' + categoryOptions(type);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const method = String(options.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && state.csrfToken) {
    headers['X-CSRF-Token'] = state.csrfToken;
  }
  let response = await fetch(`/api${path}`, { ...options, headers, credentials: 'include' });
  const cannotRefresh = ['/auth/login', '/auth/register', '/auth/forgot-password',
    '/auth/reset-password', '/auth/refresh'].includes(path);
  if (response.status === 401 && !cannotRefresh) {
    const refreshed = await refreshSession();
    if (refreshed) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        headers['X-CSRF-Token'] = state.csrfToken;
      }
      response = await fetch(`/api${path}`, { ...options, headers, credentials: 'include' });
    }
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Request failed');
  }
  if (response.status === 204) return null;
  return response.json();
}

function setSession(payload) {
  state.authenticated = true;
  state.user = payload.user;
  state.csrfToken = payload.csrfToken;
  renderShell();
  loadAll();
}

async function refreshSession() {
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include'
  });
  if (!response.ok) return false;
  const payload = await response.json();
  state.authenticated = true;
  state.user = payload.user;
  state.csrfToken = payload.csrfToken;
  return true;
}

function renderShell() {
  document.querySelector('#auth-panel').classList.toggle('hidden', state.authenticated);
  document.querySelector('#app-content').classList.toggle('hidden', !state.authenticated);
  document.querySelector('#app-nav').classList.toggle('hidden', !state.authenticated);
  document.querySelector('#logout-btn').classList.toggle('hidden', !state.authenticated);
  document.querySelector('#user-label').textContent = state.user ? state.user.name : '';
  document.querySelector('#view-title').textContent = state.authenticated ? 'Dashboard' : 'Login / Sign up';
}

function setView(view) {
  document.querySelectorAll('.view').forEach((node) => node.classList.toggle('active', node.id === view));
  document.querySelectorAll('.nav-link').forEach((node) => node.classList.toggle('active', node.dataset.view === view));
  document.querySelector('#view-title').textContent = view[0].toUpperCase() + view.slice(1);
}

function categoryOptions(type = null) {
  return state.categories
    .filter((category) => !type || category.type === type)
    .map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`)
    .join('');
}

async function loadCategories() {
  state.categories = await api('/categories');
  document.querySelector('#transaction-category').innerHTML = '<option value="">Uncategorized</option>' + categoryOptions();
  document.querySelector('#budget-category').innerHTML = categoryOptions('expense');
  document.querySelector('#filter-category').innerHTML = '<option value="">All categories</option>' + categoryOptions();
  refreshRecurringCategoryOptions();
  document.querySelector('#category-list').innerHTML = state.categories.map((category) => `
    <article class="category-item">
      <div class="category-details">
        <span><span class="swatch" style="background:${escapeHtml(category.color)}"></span>${escapeHtml(category.name)}</span>
        <strong>${escapeHtml(category.type)}</strong>
      </div>
      <div class="category-actions">
        <button class="ghost" type="button" data-category-edit="${escapeHtml(category.id)}">Edit</button>
        <button class="ghost" type="button" data-category-delete="${escapeHtml(category.id)}">Delete</button>
      </div>
    </article>
  `).join('');
}

async function loadDashboard() {
  const [summary, categorySpend, trends, alerts, budgets, merchants] = await Promise.all([
    api('/analytics/summary'),
    api('/analytics/category-spend'),
    api('/analytics/trends'),
    api('/alerts'),
    api('/analytics/budget-progress'),
    api('/analytics/top-merchants')
  ]);

  document.querySelector('#metric-income').textContent = money.format(summary.income);
  document.querySelector('#metric-expenses').textContent = money.format(summary.expenses);
  document.querySelector('#metric-cash-flow').textContent = money.format(summary.cash_flow);
  document.querySelector('#alert-list').innerHTML = alerts.map((alert) => `
    <article class="alert-item ${alert.status === 'warning' ? 'warning' : ''}">${escapeHtml(alert.message)}</article>
  `).join('');

  drawChart('trend-chart', 'bar', {
    labels: trends.map((row) => row.month),
    datasets: [
      { label: 'Income', data: trends.map((row) => row.income), backgroundColor: '#059669' },
      { label: 'Expenses', data: trends.map((row) => row.expenses), backgroundColor: '#dc2626' }
    ]
  });

  drawChart('category-chart', 'doughnut', {
    labels: categorySpend.map((row) => row.category),
    datasets: [{ data: categorySpend.map((row) => row.total), backgroundColor: categorySpend.map((row) => row.color) }]
  });

  drawChart('budget-chart', 'bar', {
    labels: budgets.map((row) => row.category),
    datasets: [
      { label: 'Spent', data: budgets.map((row) => row.spent), backgroundColor: '#f97316' },
      { label: 'Limit', data: budgets.map((row) => row.limit_amount), backgroundColor: '#94a3b8' }
    ]
  });

  drawChart('merchant-chart', 'bar', {
    labels: merchants.map((row) => row.merchant),
    datasets: [{ label: 'Top merchants', data: merchants.map((row) => row.total), backgroundColor: '#0f9f9a' }]
  });
}

function drawChart(id, type, data) {
  state.charts[id]?.destroy();
  state.charts[id] = new Chart(document.querySelector(`#${id}`), {
    type,
    data,
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function transactionQuery(page = state.transactionPagination.page) {
  const params = new URLSearchParams();
  const values = {
    page,
    limit: state.transactionPagination.limit,
    search: document.querySelector('#search')?.value,
    type: document.querySelector('#filter-type')?.value,
    categoryId: document.querySelector('#filter-category')?.value,
    from: document.querySelector('#filter-from')?.value,
    to: document.querySelector('#filter-to')?.value,
    minAmount: document.querySelector('#filter-min')?.value,
    maxAmount: document.querySelector('#filter-max')?.value
  };

  Object.entries(values).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString();
  return query ? `?${query}` : '';
}

function renderTransactionPagination(loading = false) {
  const pagination = state.transactionPagination;
  const pageLabel = pagination.totalPages
    ? `Page ${pagination.page} of ${pagination.totalPages}`
    : 'Page 0 of 0';
  document.querySelector('#transaction-page-summary').textContent = pageLabel;
  document.querySelector('#transaction-total').textContent = `${pagination.total} transaction${pagination.total === 1 ? '' : 's'}`;
  document.querySelector('#transaction-previous').disabled = loading || !pagination.hasPrevious;
  document.querySelector('#transaction-next').disabled = loading || !pagination.hasNext;
}

function renderTransactions(rows) {
  document.querySelector('#transaction-table').innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td>${escapeHtml(formatDate(row.transaction_date, state.dateFormat))}</td>
      <td>${escapeHtml(row.merchant)}</td>
      <td>${escapeHtml(row.category_name || 'Uncategorized')}</td>
      <td>${escapeHtml(row.type)}</td>
      <td class="amount-${escapeHtml(row.type)}">${row.type === 'expense' ? '-' : '+'}${escapeHtml(money.format(row.amount))}</td>
      <td>
        <button class="ghost" data-edit="${escapeHtml(row.id)}">Edit</button>
        <button class="ghost" data-delete="${escapeHtml(row.id)}">Delete</button>
      </td>
    </tr>
  `).join('') : '<tr><td colspan="6" class="empty-state">No transactions match these filters.</td></tr>';
}

async function loadTransactions(page = state.transactionPagination.page) {
  transactionRequestController?.abort();
  const controller = new AbortController();
  transactionRequestController = controller;
  setStatus('#transaction-status', 'Loading transactions...');
  renderTransactionPagination(true);

  try {
    const payload = await api(`/transactions${transactionQuery(page)}`, { signal: controller.signal });
    if (transactionRequestController !== controller) return;
    if (payload.pagination.totalPages > 0 && page > payload.pagination.totalPages) {
      await loadTransactions(payload.pagination.totalPages);
      return;
    }

    const rows = payload.transactions;
    state.transactionPagination = payload.pagination;
    state.transactions = rows;
    renderTransactions(rows);
    renderTransactionPagination();

    const first = rows.length ? ((payload.pagination.page - 1) * payload.pagination.limit) + 1 : 0;
    const last = rows.length ? first + rows.length - 1 : 0;
    setStatus(
      '#transaction-status',
      rows.length
        ? `Showing ${first}-${last} of ${payload.pagination.total} transactions.`
        : 'No transactions found.'
    );
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (transactionRequestController !== controller) return;
    state.transactions = [];
    renderTransactions([]);
    setStatus('#transaction-status', error.message, true);
    renderTransactionPagination();
  } finally {
    if (transactionRequestController === controller) {
      transactionRequestController = null;
    }
  }
}

async function loadRecurringTransactions() {
  const rows = await api('/recurring');
  state.recurringTransactions = rows;
  document.querySelector('#recurring-table').innerHTML = rows.length ? rows.map((row) => `
    <tr class="${row.is_active ? '' : 'paused'}">
      <td>${escapeHtml(row.description)}</td>
      <td>${escapeHtml(row.category_name || 'Uncategorized')}</td>
      <td>${escapeHtml(row.frequency)}</td>
      <td class="amount-${escapeHtml(row.type)}">${row.type === 'expense' ? '-' : '+'}${escapeHtml(money.format(row.amount))}</td>
      <td>${escapeHtml(formatDate(row.next_run_date, state.dateFormat))}</td>
      <td>${row.is_active ? 'Active' : 'Paused'}</td>
      <td class="table-actions">
        <button class="ghost" data-recurring-toggle="${escapeHtml(row.id)}">${row.is_active ? 'Pause' : 'Resume'}</button>
        <button class="ghost" data-recurring-delete="${escapeHtml(row.id)}">Delete</button>
      </td>
    </tr>
  `).join('') : '<tr><td colspan="7" class="empty-state">No recurring transactions yet.</td></tr>';
}

async function loadBudgets() {
  const rows = await api(`/budgets?month=${document.querySelector('[name="month"]').value}`);
  document.querySelector('#budget-list').innerHTML = rows.map((row) => {
    const spent = Number(row.spent);
    const limit = Number(row.limit_amount);
    const percent = limit ? Math.min((spent / limit) * 100, 100) : 0;
    return `
      <article class="budget-item ${spent > limit ? 'over' : percent >= 80 ? 'warning' : ''}">
        <strong>${escapeHtml(row.category_name)}</strong>
        <p>${escapeHtml(money.format(spent))} spent of ${escapeHtml(money.format(limit))} ${spent > limit ? ' - over budget' : percent >= 80 ? ' - near monthly limit' : ''}</p>
        <div class="budget-line"><span style="width:${percent}%"></span></div>
      </article>
    `;
  }).join('');
}

async function loadAll() {
  if (!state.authenticated) return;
  await loadCategories();
  await loadProfile();
  await Promise.all([loadDashboard(), loadTransactions(), loadRecurringTransactions(), loadBudgets()]);
}

document.querySelector('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const stopLoading = setLoading(event.submitter, event.submitter.dataset.mode === 'login' ? 'Logging in...' : 'Creating...');
  const mode = event.submitter.dataset.mode;
  const form = event.currentTarget;
  const data = authPayload(new FormData(form), mode);
  document.querySelector('#auth-error').textContent = '';
  if (!validateRequired(form, ['email', 'password'])) {
    stopLoading();
    return;
  }
  try {
    const payload = await api(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(data) });
    setSession(payload);
  } catch (error) {
    document.querySelector('#auth-error').textContent = error.message;
  } finally {
    stopLoading();
  }
});

document.querySelector('#prepare-reset-btn').addEventListener('click', async (event) => {
  const stopLoading = setLoading(event.currentTarget, 'Preparing...');
  const email = document.querySelector('#reset-email').value;
  setStatus('#reset-result', '');
  try {
    const result = await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
    if (result.resetToken) document.querySelector('#reset-token').value = result.resetToken;
    setStatus('#reset-result', result.resetToken ? `${result.message} Token filled for local testing.` : result.message);
  } catch (error) {
    setStatus('#reset-result', error.message, true);
  } finally {
    stopLoading();
  }
});

document.querySelector('#reset-password-btn').addEventListener('click', async (event) => {
  const stopLoading = setLoading(event.currentTarget, 'Resetting...');
  setStatus('#reset-result', '');
  try {
    await api('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(resetPasswordPayload(
        document.querySelector('#reset-token').value,
        document.querySelector('#reset-new-password').value
      ))
    });
    document.querySelector('#reset-email').value = '';
    document.querySelector('#reset-token').value = '';
    document.querySelector('#reset-new-password').value = '';
    setStatus('#reset-result', 'Password reset successfully. You can log in now.');
  } catch (error) {
    setStatus('#reset-result', error.message, true);
  } finally {
    stopLoading();
  }
});

document.querySelector('#logout-btn').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  state.authenticated = false;
  state.user = null;
  state.csrfToken = null;
  renderShell();
});

document.querySelectorAll('.nav-link').forEach((button) => {
  button.addEventListener('click', () => setView(button.dataset.view));
});

document.querySelector('#recurring-form [name="type"]').addEventListener('change', refreshRecurringCategoryOptions);

document.querySelector('#recurring-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const stopLoading = setLoading(event.submitter, 'Saving...');
  const data = recurringPayload(new FormData(form));
  const result = document.querySelector('#recurring-result');
  result.classList.remove('error');
  result.textContent = '';
  if (!validateRequired(form, ['description', 'startDate']) || !validatePositiveAmount(form.elements.amount)) {
    stopLoading();
    return;
  }
  try {
    await api('/recurring', { method: 'POST', body: JSON.stringify(data) });
    form.reset();
    document.querySelector('[name="startDate"]').value = today;
    document.querySelector('[name="frequency"]').value = 'monthly';
    refreshRecurringCategoryOptions();
    result.textContent = 'Recurring transaction added successfully.';
    await loadRecurringTransactions();
  } catch (error) {
    result.classList.add('error');
    result.textContent = error.message;
  } finally {
    stopLoading();
  }
});

document.querySelector('#recurring-table').addEventListener('click', async (event) => {
  const toggleButton = event.target.closest('[data-recurring-toggle]');
  const deleteButton = event.target.closest('[data-recurring-delete]');

  if (toggleButton) {
    const recurring = state.recurringTransactions.find((row) => String(row.id) === toggleButton.dataset.recurringToggle);
    if (!recurring) return;
    await api(`/recurring/${recurring.id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: !recurring.is_active })
    });
    await loadRecurringTransactions();
    return;
  }

  if (deleteButton) {
    await api(`/recurring/${deleteButton.dataset.recurringDelete}`, { method: 'DELETE' });
    await loadRecurringTransactions();
  }
});

document.querySelector('#transaction-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = event.submitter;
  const editing = Boolean(form.elements.id.value);
  const stopLoading = setLoading(submitButton, editing ? 'Updating...' : 'Saving...');
  if (!validateRequired(form, ['merchant', 'transactionDate']) || !validatePositiveAmount(form.elements.amount)) {
    stopLoading();
    return;
  }
  const id = form.elements.id.value;
  const data = transactionPayload(new FormData(form));
  try {
    await api(editing ? `/transactions/${id}` : '/transactions', {
      method: editing ? 'PUT' : 'POST',
      body: JSON.stringify(data)
    });
    form.reset();
    form.elements.id.value = '';
    document.querySelector('[name="transactionDate"]').value = today;
    document.querySelector('#transaction-form button[type="submit"]').textContent = 'Add transaction';
    document.querySelector('#cancel-edit-btn').classList.add('hidden');
    await Promise.all([
      loadDashboard(),
      loadTransactions(editing ? state.transactionPagination.page : 1),
      loadBudgets()
    ]);
  } catch (error) {
    alert(error.message);
  } finally {
    stopLoading();
    if (!form.elements.id.value) {
      document.querySelector('#transaction-form button[type="submit"]').textContent = 'Add transaction';
    }
  }
});

document.querySelector('#cancel-recurring-edit-btn').addEventListener('click', () => {
  const form = document.querySelector('#recurring-form');
  form.reset();
  document.querySelector('[name="startDate"]').value = today;
  document.querySelector('[name="frequency"]').value = 'monthly';
  refreshRecurringCategoryOptions();
  document.querySelector('#cancel-recurring-edit-btn').classList.add('hidden');
  form.querySelector('button[type="submit"]').textContent = 'Add recurring';
});

document.querySelector('#transaction-table').addEventListener('click', async (event) => {
  const editButton = event.target.closest('[data-edit]');
  if (editButton) {
    const transaction = state.transactions.find((row) => row.id === editButton.dataset.edit);
    if (!transaction) return;
    const form = document.querySelector('#transaction-form');
    form.elements.id.value = transaction.id;
    form.elements.type.value = transaction.type;
    form.elements.merchant.value = transaction.merchant;
    form.elements.amount.value = transaction.amount;
    form.elements.transactionDate.value = transaction.transaction_date.slice(0, 10);
    form.elements.categoryId.value = transaction.category_id || '';
    form.elements.notes.value = transaction.notes || '';
    form.querySelector('button[type="submit"]').textContent = 'Update transaction';
    document.querySelector('#cancel-edit-btn').classList.remove('hidden');
    setView('transactions');
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  const id = event.target.dataset.delete;
  if (!id) return;
  await api(`/transactions/${id}`, { method: 'DELETE' });
  await Promise.all([loadDashboard(), loadTransactions(), loadBudgets()]);
});

document.querySelector('#cancel-edit-btn').addEventListener('click', () => {
  const form = document.querySelector('#transaction-form');
  form.reset();
  form.elements.id.value = '';
  document.querySelector('[name="transactionDate"]').value = today;
  form.querySelector('button[type="submit"]').textContent = 'Add transaction';
  document.querySelector('#cancel-edit-btn').classList.add('hidden');
});

document.querySelector('#search').addEventListener('input', () => {
  clearTimeout(transactionFilterTimer);
  transactionFilterTimer = setTimeout(() => loadTransactions(1), 250);
});

['#filter-type', '#filter-category', '#filter-from', '#filter-to', '#filter-min', '#filter-max'].forEach((selector) => {
  document.querySelector(selector).addEventListener('change', () => loadTransactions(1));
});

document.querySelector('#clear-filters-btn').addEventListener('click', () => {
  clearTimeout(transactionFilterTimer);
  ['#search', '#filter-type', '#filter-category', '#filter-from', '#filter-to', '#filter-min', '#filter-max'].forEach((selector) => {
    document.querySelector(selector).value = '';
  });
  loadTransactions(1);
});

document.querySelector('#transaction-previous').addEventListener('click', () => {
  if (state.transactionPagination.hasPrevious) {
    loadTransactions(state.transactionPagination.page - 1);
  }
});

document.querySelector('#transaction-next').addEventListener('click', () => {
  if (state.transactionPagination.hasNext) {
    loadTransactions(state.transactionPagination.page + 1);
  }
});

document.querySelector('#budget-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const stopLoading = setLoading(event.submitter, 'Saving...');
  if (!validatePositiveAmount(form.elements.limitAmount)) {
    stopLoading();
    return;
  }
  try {
    const data = budgetPayload(new FormData(form));
    await api('/budgets', { method: 'POST', body: JSON.stringify(data) });
    await loadBudgets();
    await loadDashboard();
  } catch (error) {
    alert(error.message);
  } finally {
    stopLoading();
  }
});

function resetCategoryForm() {
  const form = document.querySelector('#category-form');
  form.reset();
  form.elements.id.value = '';
  form.elements.type.disabled = false;
  form.elements.color.value = '#2563eb';
  form.querySelector('button[type="submit"]').textContent = 'Add category';
  document.querySelector('#cancel-category-edit-btn').classList.add('hidden');
}

async function refreshCategoryLabels() {
  await loadCategories();
  await Promise.all([
    loadDashboard(),
    loadTransactions(state.transactionPagination.page),
    loadRecurringTransactions(),
    loadBudgets()
  ]);
}

document.querySelector('#category-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const editing = Boolean(form.elements.id.value);
  const data = editing
    ? { name: form.elements.name.value, color: form.elements.color.value }
    : {
        name: form.elements.name.value,
        type: form.elements.type.value,
        color: form.elements.color.value
      };
  const result = document.querySelector('#category-result');
  result.classList.remove('error');
  result.textContent = '';
  const stopLoading = setLoading(event.submitter, 'Saving...');
  if (!validateRequired(form, ['name'])) {
    stopLoading();
    return;
  }
  try {
    await api(editing ? `/categories/${form.elements.id.value}` : '/categories', {
      method: editing ? 'PATCH' : 'POST',
      body: JSON.stringify(data)
    });
    resetCategoryForm();
    result.textContent = editing ? 'Category updated successfully.' : 'Category added successfully.';
    if (editing) {
      await refreshCategoryLabels();
    } else {
      await loadCategories();
    }
  } catch (error) {
    result.classList.add('error');
    result.textContent = error.message;
  } finally {
    stopLoading();
  }
});

document.querySelector('#cancel-category-edit-btn').addEventListener('click', () => {
  resetCategoryForm();
  setStatus('#category-result', '');
});

document.querySelector('#category-list').addEventListener('click', async (event) => {
  const editButton = event.target.closest('[data-category-edit]');
  const deleteButton = event.target.closest('[data-category-delete]');
  const categoryId = editButton?.dataset.categoryEdit || deleteButton?.dataset.categoryDelete;
  if (!categoryId) return;

  const category = state.categories.find((item) => item.id === categoryId);
  if (!category) return;

  if (editButton) {
    const form = document.querySelector('#category-form');
    form.elements.id.value = category.id;
    form.elements.name.value = category.name;
    form.elements.type.value = category.type;
    form.elements.type.disabled = true;
    form.elements.color.value = category.color;
    form.querySelector('button[type="submit"]').textContent = 'Update category';
    document.querySelector('#cancel-category-edit-btn').classList.remove('hidden');
    setStatus('#category-result', '');
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  if (!window.confirm(`Delete the category "${category.name}"?`)) return;
  const stopLoading = setLoading(deleteButton, 'Deleting...');
  try {
    await api(`/categories/${category.id}`, { method: 'DELETE' });
    if (document.querySelector('#category-form').elements.id.value === category.id) {
      resetCategoryForm();
    }
    setStatus('#category-result', 'Category deleted successfully.');
    await loadCategories();
  } catch (error) {
    setStatus('#category-result', error.message, true);
  } finally {
    stopLoading();
  }
});

document.querySelector('#csv-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const stopLoading = setLoading(event.submitter, 'Importing...');
  try {
    const result = await api('/imports/csv', { method: 'POST', body: new FormData(event.currentTarget) });
    document.querySelector('#csv-result').textContent = `Imported ${result.inserted} transactions.`;
    await Promise.all([loadDashboard(), loadTransactions(1), loadBudgets()]);
  } catch (error) {
    document.querySelector('#csv-result').textContent = error.message;
  } finally {
    stopLoading();
  }
});

document.querySelector('#export-btn').addEventListener('click', async () => {
  const response = await fetch('/api/reports/transactions.csv', {
    credentials: 'include'
  });
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'penny-transactions.csv';
  link.click();
  URL.revokeObjectURL(url);
});

async function loadProfile() {
  const profile = await api('/profile');
  const form = document.querySelector('#profile-form');
  form.elements.name.value = profile.name;
  form.elements.email.value = profile.email;
  form.elements.phone.value = profile.phone || '';
  form.elements.address.value = profile.address || '';
  form.elements.timezone.value = profile.timezone || 'UTC';
  form.elements.preferredCurrency.value = profile.preferred_currency || 'USD';
  form.elements.themePreference.value = localStorage.getItem('penny_theme') || profile.theme_preference || 'light';
  form.elements.budgetResetDay.value = profile.budget_reset_day || 1;
  form.elements.dateFormat.value = profile.date_format || 'YYYY-MM-DD';
  money = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: profile.preferred_currency || 'USD'
  });
  applyDatePreferences(profile);
  document.querySelector('#profile-initials').textContent = initialsFor(profile.name);
}

function applyDatePreferences(profile) {
  state.timeZone = profile.timezone || 'UTC';
  state.dateFormat = profile.date_format || 'YYYY-MM-DD';
  state.budgetResetDay = Number(profile.budget_reset_day) || 1;
  today = dateInputValue(new Date(), state.timeZone);
  thisMonth = budgetMonthValue(today, state.budgetResetDay);
  document.querySelector('[name="transactionDate"]').value = today;
  document.querySelector('[name="startDate"]').value = today;
  document.querySelector('[name="month"]').value = thisMonth;
}

function initialsFor(name = 'Penny User') {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'PU';
}

document.querySelector('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const stopLoading = setLoading(event.submitter, 'Saving...');
  const data = profilePayload(new FormData(form));
  const result = document.querySelector('#profile-result');
  result.classList.remove('error');
  result.textContent = '';
  try {
    const profile = await api('/profile', { method: 'PUT', body: JSON.stringify(data) });
    state.user = { ...state.user, name: profile.name, email: profile.email };
    document.querySelector('#user-label').textContent = profile.name;
    setTheme(profile.theme_preference || data.themePreference);
    applyDatePreferences(profile);
    document.querySelector('#profile-initials').textContent = initialsFor(profile.name);
    await Promise.all([
      loadDashboard(),
      loadTransactions(state.transactionPagination.page),
      loadRecurringTransactions(),
      loadBudgets()
    ]);
    result.textContent = 'Profile saved successfully.';
  } catch (error) {
    result.classList.add('error');
    result.textContent = error.message;
  } finally {
    stopLoading();
  }
});

async function restoreSession() {
  renderShell();
  try {
    const payload = await api('/auth/me');
    setSession(payload);
  } catch {
    state.authenticated = false;
    state.user = null;
    state.csrfToken = null;
    renderShell();
  }
}

restoreSession();
