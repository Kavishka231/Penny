const state = {
  token: localStorage.getItem('penny_token'),
  user: JSON.parse(localStorage.getItem('penny_user') || 'null'),
  categories: [],
  charts: {}
};

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const today = new Date().toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);

document.querySelector('[name="transactionDate"]').value = today;
document.querySelector('[name="month"]').value = thisMonth;

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(`/api${path}`, { ...options, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Request failed');
  }
  if (response.status === 204) return null;
  return response.json();
}

function setSession(payload) {
  state.token = payload.token;
  state.user = payload.user;
  localStorage.setItem('penny_token', payload.token);
  localStorage.setItem('penny_user', JSON.stringify(payload.user));
  renderShell();
  loadAll();
}

function renderShell() {
  document.querySelector('#auth-panel').classList.toggle('hidden', Boolean(state.token));
  document.querySelector('#app-content').classList.toggle('hidden', !state.token);
  document.querySelector('#logout-btn').classList.toggle('hidden', !state.token);
  document.querySelector('#user-label').textContent = state.user ? state.user.name : '';
}

function setView(view) {
  document.querySelectorAll('.view').forEach((node) => node.classList.toggle('active', node.id === view));
  document.querySelectorAll('.nav-link').forEach((node) => node.classList.toggle('active', node.dataset.view === view));
  document.querySelector('#view-title').textContent = view[0].toUpperCase() + view.slice(1);
}

function categoryOptions(type = null) {
  return state.categories
    .filter((category) => !type || category.type === type)
    .map((category) => `<option value="${category.id}">${category.name}</option>`)
    .join('');
}

async function loadCategories() {
  state.categories = await api('/categories');
  document.querySelector('#transaction-category').innerHTML = '<option value="">Uncategorized</option>' + categoryOptions();
  document.querySelector('#budget-category').innerHTML = categoryOptions('expense');
  document.querySelector('#category-list').innerHTML = state.categories.map((category) => `
    <article class="category-item">
      <span><span class="swatch" style="background:${category.color}"></span>${category.name}</span>
      <strong>${category.type}</strong>
    </article>
  `).join('');
}

async function loadDashboard() {
  const [summary, categorySpend, trends, alerts] = await Promise.all([
    api('/analytics/summary'),
    api('/analytics/category-spend'),
    api('/analytics/trends'),
    api('/alerts')
  ]);

  document.querySelector('#metric-income').textContent = money.format(summary.income);
  document.querySelector('#metric-expenses').textContent = money.format(summary.expenses);
  document.querySelector('#metric-cash-flow').textContent = money.format(summary.cash_flow);
  document.querySelector('#alert-list').innerHTML = alerts.map((alert) => `
    <article class="alert-item">${alert.categoryName} is over budget by ${money.format(alert.overBy)}</article>
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
}

function drawChart(id, type, data) {
  state.charts[id]?.destroy();
  state.charts[id] = new Chart(document.querySelector(`#${id}`), {
    type,
    data,
    options: { responsive: true, maintainAspectRatio: false }
  });
}

async function loadTransactions(search = '') {
  const rows = await api(`/transactions${search ? `?search=${encodeURIComponent(search)}` : ''}`);
  document.querySelector('#transaction-table').innerHTML = rows.map((row) => `
    <tr>
      <td>${row.transaction_date.slice(0, 10)}</td>
      <td>${row.merchant}</td>
      <td>${row.category_name || 'Uncategorized'}</td>
      <td>${row.type}</td>
      <td class="amount-${row.type}">${row.type === 'expense' ? '-' : '+'}${money.format(row.amount)}</td>
      <td><button class="ghost" data-delete="${row.id}">Delete</button></td>
    </tr>
  `).join('');
}

async function loadBudgets() {
  const rows = await api(`/budgets?month=${document.querySelector('[name="month"]').value}`);
  document.querySelector('#budget-list').innerHTML = rows.map((row) => {
    const spent = Number(row.spent);
    const limit = Number(row.limit_amount);
    const percent = limit ? Math.min((spent / limit) * 100, 100) : 0;
    return `
      <article class="budget-item ${spent > limit ? 'over' : ''}">
        <strong>${row.category_name}</strong>
        <p>${money.format(spent)} spent of ${money.format(limit)} ${spent > limit ? ' - over budget' : ''}</p>
        <div class="budget-line"><span style="width:${percent}%"></span></div>
      </article>
    `;
  }).join('');
}

async function loadAll() {
  if (!state.token) return;
  await loadCategories();
  await Promise.all([loadDashboard(), loadTransactions(), loadBudgets(), loadProfile()]);
}

document.querySelector('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const mode = event.submitter.dataset.mode;
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const payload = await api(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(data) });
    setSession(payload);
  } catch (error) {
    document.querySelector('#auth-error').textContent = error.message;
  }
});

document.querySelector('#logout-btn').addEventListener('click', () => {
  localStorage.clear();
  state.token = null;
  state.user = null;
  renderShell();
});

document.querySelectorAll('.nav-link').forEach((button) => {
  button.addEventListener('click', () => setView(button.dataset.view));
});

document.querySelector('#transaction-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  await api('/transactions', { method: 'POST', body: JSON.stringify(data) });
  event.currentTarget.reset();
  document.querySelector('[name="transactionDate"]').value = today;
  await Promise.all([loadDashboard(), loadTransactions(), loadBudgets()]);
});

document.querySelector('#transaction-table').addEventListener('click', async (event) => {
  const id = event.target.dataset.delete;
  if (!id) return;
  await api(`/transactions/${id}`, { method: 'DELETE' });
  await Promise.all([loadDashboard(), loadTransactions(), loadBudgets()]);
});

document.querySelector('#search').addEventListener('input', (event) => {
  loadTransactions(event.target.value);
});

document.querySelector('#budget-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  await api('/budgets', { method: 'POST', body: JSON.stringify(data) });
  await loadBudgets();
  await loadDashboard();
});

document.querySelector('#category-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  await api('/categories', { method: 'POST', body: JSON.stringify(data) });
  event.currentTarget.reset();
  document.querySelector('[name="color"]').value = '#2563eb';
  await loadCategories();
});

document.querySelector('#receipt-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const result = await api('/receipts/scan', { method: 'POST', body: form });
    document.querySelector('#receipt-result').textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    document.querySelector('#receipt-result').textContent = error.message;
  }
});

document.querySelector('#csv-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await api('/imports/csv', { method: 'POST', body: new FormData(event.currentTarget) });
  document.querySelector('#csv-result').textContent = `Imported ${result.inserted} transactions.`;
  await Promise.all([loadDashboard(), loadTransactions(), loadBudgets()]);
});

document.querySelector('#export-btn').addEventListener('click', async () => {
  const response = await fetch('/api/reports/transactions.csv', {
    headers: { Authorization: `Bearer ${state.token}` }
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
}

document.querySelector('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  if (!data.password) delete data.password;
  const profile = await api('/profile', { method: 'PUT', body: JSON.stringify(data) });
  state.user = { ...state.user, name: profile.name, email: profile.email };
  localStorage.setItem('penny_user', JSON.stringify(state.user));
  document.querySelector('#user-label').textContent = profile.name;
  document.querySelector('#profile-result').textContent = 'Profile saved.';
});

renderShell();
loadAll();
