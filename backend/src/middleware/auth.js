import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { readSessionCookie } from '../lib/sessionCookie.js';
import { allowedOrigins } from '../config.js';
import { sessionIsActive } from '../services/sessionService.js';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

function sameValue(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function trustedRequestOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return false;

  const trustedOrigins = new Set(allowedOrigins());
  if (process.env.APP_BASE_URL) {
    trustedOrigins.add(process.env.APP_BASE_URL.replace(/\/$/, ''));
  }
  trustedOrigins.add(`${req.protocol}://${req.get('host')}`);
  return trustedOrigins.has(origin);
}

export async function requireAuth(req, res, next) {
  const token = readSessionCookie(req);

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'penny',
      audience: 'penny-web'
    });
    if (!req.user.csrf || !req.user.sid
        || !(await sessionIsActive(req.user.sid, req.user.id))) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    if (!safeMethods.has(req.method)) {
      if (!trustedRequestOrigin(req)) {
        return res.status(403).json({ error: 'Request origin is not allowed' });
      }
      if (!sameValue(req.get('x-csrf-token'), req.user.csrf)) {
        return res.status(403).json({ error: 'Invalid CSRF token' });
      }
    }
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
