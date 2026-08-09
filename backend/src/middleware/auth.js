import jwt from 'jsonwebtoken';
import { readSessionCookie } from '../lib/sessionCookie.js';

export function requireAuth(req, res, next) {
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
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
