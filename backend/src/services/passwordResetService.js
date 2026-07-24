import crypto from 'crypto';
import nodemailer from 'nodemailer';

const RESET_TOKEN_BYTES = 32;
const DEFAULT_TTL_MINUTES = 30;

function enabled(value) {
  return String(value).toLowerCase() === 'true';
}

export function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createResetToken() {
  const token = crypto.randomBytes(RESET_TOKEN_BYTES).toString('hex');
  return { token, tokenHash: hashResetToken(token) };
}

export function resetTokenExpiresAt() {
  const configured = Number(process.env.PASSWORD_RESET_TTL_MINUTES);
  const ttlMinutes = Number.isFinite(configured) && configured > 0
    ? Math.min(configured, 60)
    : DEFAULT_TTL_MINUTES;
  return new Date(Date.now() + ttlMinutes * 60 * 1000);
}

export function mayExposeResetToken() {
  return ['development', 'test'].includes(process.env.NODE_ENV)
    && enabled(process.env.PASSWORD_RESET_EXPOSE_TOKEN);
}

export function isEmailDeliveryConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.PASSWORD_RESET_FROM);
}

function createTransport() {
  const auth = process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
    : undefined;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: enabled(process.env.SMTP_SECURE),
    auth
  });
}

export async function sendPasswordResetEmail({ email, token }) {
  if (!isEmailDeliveryConfigured()) return false;

  const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const resetUrl = `${baseUrl}/app.html?resetToken=${encodeURIComponent(token)}`;
  await createTransport().sendMail({
    from: process.env.PASSWORD_RESET_FROM,
    to: email,
    subject: 'Reset your Penny password',
    text: `Reset your Penny password using this one-time link: ${resetUrl}`,
    html: `<p>Reset your Penny password using this one-time link:</p><p><a href="${resetUrl}">Reset password</a></p>`
  });
  return true;
}
