import { accessLifetimeSeconds, refreshLifetimeSeconds } from '../services/sessionService.js';

const accessCookieName = 'penny_session';
const refreshCookieName = 'penny_refresh';

function serializeCookie(name, value, maxAge, path) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

function readCookie(req, targetName) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=');
    if (separator < 0 || cookie.slice(0, separator).trim() !== targetName) continue;
    try {
      return decodeURIComponent(cookie.slice(separator + 1));
    } catch {
      return null;
    }
  }
  return null;
}

export function setSessionCookies(res, accessToken, refreshToken) {
  res.setHeader('Set-Cookie', [
    serializeCookie(accessCookieName, accessToken, accessLifetimeSeconds, '/'),
    serializeCookie(refreshCookieName, refreshToken, refreshLifetimeSeconds, '/api/auth')
  ]);
}

export function clearSessionCookies(res) {
  res.setHeader('Set-Cookie', [
    serializeCookie(accessCookieName, '', 0, '/'),
    serializeCookie(refreshCookieName, '', 0, '/api/auth')
  ]);
}

export function readSessionCookie(req) {
  return readCookie(req, accessCookieName);
}

export function readRefreshCookie(req) {
  return readCookie(req, refreshCookieName);
}
