const sessionCookieName = 'penny_session';
const sessionMaxAgeSeconds = 7 * 24 * 60 * 60;

function serializeCookie(value, maxAge) {
  const parts = [
    `${sessionCookieName}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', serializeCookie(token, sessionMaxAgeSeconds));
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', serializeCookie('', 0));
}

export function readSessionCookie(req) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=');
    if (separator < 0) continue;
    const name = cookie.slice(0, separator).trim();
    if (name === sessionCookieName) {
      try {
        return decodeURIComponent(cookie.slice(separator + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}
