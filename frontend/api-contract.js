function asObject(values) {
  return values instanceof FormData ? Object.fromEntries(values) : values;
}

function optional(value) {
  return value === undefined || value === null || value === '' ? undefined : value;
}

export function authPayload(values, mode) {
  const data = asObject(values);
  const payload = { email: data.email, password: data.password };
  if (mode === 'register') payload.name = data.name;
  return payload;
}

export function transactionPayload(values) {
  const data = asObject(values);
  return {
    description: data.merchant,
    amount: Number(data.amount),
    type: data.type,
    category_id: optional(data.categoryId),
    date: data.transactionDate,
    notes: optional(data.notes)
  };
}

export function recurringPayload(values) {
  const data = asObject(values);
  return {
    description: data.description,
    amount: Number(data.amount),
    type: data.type,
    category_id: optional(data.categoryId),
    frequency: data.frequency,
    start_date: data.startDate,
    end_date: optional(data.endDate)
  };
}

export function budgetPayload(values) {
  const data = asObject(values);
  return {
    category_id: data.categoryId,
    month: data.month,
    monthly_limit: Number(data.limitAmount)
  };
}

export function profilePayload(values) {
  const data = asObject(values);
  const payload = {
    name: data.name,
    email: data.email,
    preferredCurrency: data.preferredCurrency,
    themePreference: data.themePreference,
    budgetResetDay: Number(data.budgetResetDay),
    dateFormat: data.dateFormat
  };

  for (const key of ['phone', 'address', 'password']) {
    if (optional(data[key]) !== undefined) payload[key] = data[key];
  }

  return payload;
}

export function resetPasswordPayload(token, password) {
  return { token, password };
}
