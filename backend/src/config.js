const unsafeJwtSecrets = new Set([
  'change-me-in-production',
  'generate-a-unique-random-secret-of-at-least-32-characters',
  'replace-with-a-long-random-secret',
  'secret'
]);

function enabled(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
}

export function allowedOrigins() {
  return String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function validateProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return;

  const errors = [];
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 32 || unsafeJwtSecrets.has(secret)) {
    errors.push('JWT_SECRET must be a unique secret of at least 32 characters');
  }
  if (!process.env.DATABASE_URL && !(process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD)) {
    errors.push('DATABASE_URL or PGHOST/PGUSER/PGPASSWORD must be configured');
  }
  const origins = allowedOrigins();
  if (!origins.length) {
    errors.push('ALLOWED_ORIGINS must contain at least one trusted HTTPS origin');
  } else if (origins.some((origin) => !origin.startsWith('https://'))) {
    errors.push('Every ALLOWED_ORIGINS value must use HTTPS in production');
  }
  if (!String(process.env.APP_BASE_URL || '').startsWith('https://')) {
    errors.push('APP_BASE_URL must use HTTPS in production');
  }
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    errors.push('SMTP_HOST, SMTP_USER and SMTP_PASSWORD must be configured');
  }
  if (!process.env.PASSWORD_RESET_FROM) {
    errors.push('PASSWORD_RESET_FROM must be configured');
  }
  if (String(process.env.PGPASSWORD || '').startsWith('replace-with-')
      || String(process.env.SMTP_PASSWORD || '').startsWith('replace-with-')) {
    errors.push('Placeholder database or SMTP passwords must be replaced');
  }
  if (enabled(process.env.PASSWORD_RESET_EXPOSE_TOKEN)) {
    errors.push('PASSWORD_RESET_EXPOSE_TOKEN must be false in production');
  }

  if (errors.length) {
    throw new Error(`Invalid production configuration:\n- ${errors.join('\n- ')}`);
  }
}

export { enabled };
