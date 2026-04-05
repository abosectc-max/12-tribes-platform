/**
 * server/auth.js — Pure authentication utilities
 *
 * Self-contained module: depends only on node:crypto + JWT_SECRET env var.
 * No database access — all DB-dependent logic stays in standalone.js.
 *
 * Exports:
 *   SCRYPT_PARAMS      — scrypt cost parameters (do not change without migration)
 *   hashPassword       — scrypt hash a plaintext password
 *   verifyPassword     — timing-safe password verification
 *   createJWT          — sign a HMAC-SHA256 JWT
 *   verifyJWT          — verify + decode a JWT (returns payload or null)
 *   revokeToken        — add a jti to the revocation store
 *   extractUser        — parse Bearer token from request headers
 */

import { createHmac, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

// ─── scrypt parameters ───
// N/r/p MUST NOT be changed without a full password migration.
// All stored hashes were generated with these exact values (Node default: N=16384,r=8,p=1).
// Changing N would silently break every existing user's login.
export const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64, SCRYPT_PARAMS).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = scryptSync(password, salt, 64, SCRYPT_PARAMS).toString('hex');
  // timingSafeEqual prevents timing attacks that could leak hash bits via response latency
  try {
    return timingSafeEqual(Buffer.from(test, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false; // buffer length mismatch → corrupted stored hash
  }
}

// ─── Token Revocation Store ───
// Maps jti → expiry timestamp. Checked on every verifyJWT call.
// Pruned every 10 minutes to remove expired entries (memory safety).
const revokedTokens = new Map(); // jti -> exp (unix seconds)
setInterval(() => {
  const now = Math.floor(Date.now() / 1000);
  for (const [jti, exp] of revokedTokens) {
    if (exp < now) revokedTokens.delete(jti);
  }
}, 600000);

export function revokeToken(jti, exp) {
  if (jti && exp) revokedTokens.set(jti, exp);
}

export function createJWT(payload, expiresInSec = 86400) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  // jti (JWT ID) enables per-token revocation on logout
  const jti = randomBytes(12).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, jti, iat: now, exp: now + expiresInSec })).toString('base64url');
  const signature = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyJWT(token) {
  try {
    const [header, body, signature] = token.split('.');
    const expected = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    // timingSafeEqual prevents HMAC oracle attacks via response-time analysis
    const sigBuf = Buffer.from(signature || '',  'base64url');
    const expBuf = Buffer.from(expected,          'base64url');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    // Check revocation list
    if (payload.jti && revokedTokens.has(payload.jti)) return null;
    return payload;
  } catch { return null; }
}

export function extractUser(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return verifyJWT(auth.split(' ')[1]);
}
