import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { query, withTransaction } from '../db.js';

export const accessLifetimeSeconds = 15 * 60;
export const refreshLifetimeSeconds = 14 * 24 * 60 * 60;

function randomCredential() {
  return crypto.randomBytes(32).toString('hex');
}

function hashCredential(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function signAccessToken(user, session) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      sid: session.id,
      csrf: session.csrf_token
    },
    process.env.JWT_SECRET,
    {
      expiresIn: accessLifetimeSeconds,
      algorithm: 'HS256',
      issuer: 'penny',
      audience: 'penny-web'
    }
  );
}

export async function createSession(user) {
  const refreshToken = randomCredential();
  const csrfToken = randomCredential();
  const expiresAt = new Date(Date.now() + refreshLifetimeSeconds * 1000);
  const result = await query(
    `INSERT INTO auth_sessions (user_id, refresh_token_hash, csrf_token, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, csrf_token`,
    [user.id, hashCredential(refreshToken), csrfToken, expiresAt]
  );
  const session = result.rows[0];
  return {
    accessToken: signAccessToken(user, session),
    refreshToken,
    csrfToken: session.csrf_token
  };
}

export async function rotateSession(refreshToken) {
  if (!refreshToken) return null;

  return withTransaction(async (client) => {
    const current = await client.query(
      `SELECT s.id, s.user_id, s.csrf_token, u.name, u.email
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.refresh_token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
       FOR UPDATE`,
      [hashCredential(refreshToken)]
    );
    if (!current.rowCount) return null;

    const row = current.rows[0];
    const nextRefreshToken = randomCredential();
    const nextCsrfToken = randomCredential();
    await client.query(
      `UPDATE auth_sessions
       SET refresh_token_hash = $2, csrf_token = $3, last_used_at = now()
       WHERE id = $1`,
      [row.id, hashCredential(nextRefreshToken), nextCsrfToken]
    );

    const user = { id: row.user_id, name: row.name, email: row.email };
    const session = { id: row.id, csrf_token: nextCsrfToken };
    return {
      user,
      accessToken: signAccessToken(user, session),
      refreshToken: nextRefreshToken,
      csrfToken: nextCsrfToken
    };
  });
}

export async function sessionIsActive(sessionId, userId) {
  const result = await query(
    `SELECT 1 FROM auth_sessions
     WHERE id = $1 AND user_id = $2
       AND revoked_at IS NULL AND expires_at > now()`,
    [sessionId, userId]
  );
  return result.rowCount > 0;
}

export async function revokeSession(sessionId, userId) {
  await query(
    `UPDATE auth_sessions SET revoked_at = now()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [sessionId, userId]
  );
}
