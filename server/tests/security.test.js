#!/usr/bin/env node
/**
 * 12 Tribes Investments — Security Integration Test Suite (F-018)
 *
 * Covers: auth flows, authorization, injection prevention, CSRF, rate limiting,
 *         security headers, data exposure, and CSP enforcement.
 *
 * Uses Node.js built-in test runner (no external dependencies).
 * Requires Node 18+ for `node:test` and `node:assert`.
 *
 * Usage:
 *   node --test server/tests/security.test.js
 *   TEST_SERVER_URL=http://localhost:4000 node --test server/tests/security.test.js
 *   TEST_SERVER_URL=https://one2-tribes-api.onrender.com node --test server/tests/security.test.js
 *
 * Env vars:
 *   TEST_SERVER_URL      — Backend URL (default: http://localhost:4000)
 *   TEST_ADMIN_EMAIL     — Admin email (default: abose.ctc@gmail.com)
 *   TEST_ADMIN_PASSWORD  — Admin password (default: Tribes2026!)
 *
 * ⚠ RATE LIMIT NOTE:
 *   The login endpoint is rate-limited to 5 attempts per IP per 15 minutes.
 *   This test suite makes multiple login attempts (valid + invalid + injection probes).
 *   Running the suite multiple times against production within a 15-minute window
 *   will exhaust the rate-limit budget. If "Valid credentials" or auth tests fail
 *   with an unexpected status, wait 15 minutes and re-run, or test against localhost.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL  = process.env.TEST_SERVER_URL    || 'http://localhost:4000';
const ADM_EMAIL = process.env.TEST_ADMIN_EMAIL   || 'abose.ctc@gmail.com';
const ADM_PASS  = process.env.TEST_ADMIN_PASSWORD || 'Tribes2026!';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function request(method, path, { body, token, withCSRF = true, extraHeaders = {} } = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (withCSRF) headers['X-Requested-With'] = 'XMLHttpRequest';
  if (token)    headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = {};
  try { data = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, data, headers: Object.fromEntries(res.headers.entries()) };
}

const get  = (path, opts)  => request('GET',    path, opts || {});
const post = (path, body, opts) => request('POST', path, { body, ...(opts || {}) });

// Cached admin token — fetched once in before() hook
let adminToken = null;

// ─── Setup ────────────────────────────────────────────────────────────────────

before(async () => {
  const { data, status } = await post('/api/auth/login', { email: ADM_EMAIL, password: ADM_PASS });
  if (status === 200 && data.accessToken) {
    adminToken = data.accessToken;
  }
  // If login fails the auth tests will surface the failure explicitly
});

// ─── Security Headers ─────────────────────────────────────────────────────────

describe('Security Headers', () => {
  test('Required headers present on every response', async () => {
    const { headers } = await get('/api/health');
    assert.ok(headers['x-content-type-options'],   'X-Content-Type-Options missing');
    assert.ok(headers['x-frame-options'],           'X-Frame-Options missing');
    assert.ok(headers['strict-transport-security'], 'Strict-Transport-Security (HSTS) missing');
    assert.ok(headers['content-security-policy'],   'Content-Security-Policy missing');
    assert.ok(headers['referrer-policy'],           'Referrer-Policy missing');
    assert.ok(headers['permissions-policy'],        'Permissions-Policy missing');
  });

  test("CSP uses 'default-src: none'", async () => {
    const { headers } = await get('/api/health');
    const csp = headers['content-security-policy'] || '';
    assert.match(csp, /default-src 'none'/, "CSP must lead with default-src 'none'");
  });

  test("CSP does not contain 'unsafe-inline'", async () => {
    const { headers } = await get('/api/health');
    const csp = headers['content-security-policy'] || '';
    assert.ok(!csp.includes("'unsafe-inline'"), "CSP must not contain 'unsafe-inline'");
  });

  test("CSP does not contain 'unsafe-eval'", async () => {
    const { headers } = await get('/api/health');
    const csp = headers['content-security-policy'] || '';
    assert.ok(!csp.includes("'unsafe-eval'"), "CSP must not contain 'unsafe-eval'");
  });

  test('X-Frame-Options is DENY', async () => {
    const { headers } = await get('/api/health');
    assert.equal(headers['x-frame-options']?.toUpperCase(), 'DENY');
  });

  test('HSTS max-age is at least 1 year (31536000)', async () => {
    const { headers } = await get('/api/health');
    const hsts = headers['strict-transport-security'] || '';
    const match = hsts.match(/max-age=(\d+)/);
    assert.ok(match, 'HSTS max-age not found');
    assert.ok(parseInt(match[1], 10) >= 31536000, 'HSTS max-age must be >= 31536000');
  });
});

// ─── Authentication ───────────────────────────────────────────────────────────

describe('Authentication', () => {
  test('Valid credentials return 200 + accessToken', async () => {
    const { status, data } = await post('/api/auth/login', { email: ADM_EMAIL, password: ADM_PASS });
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert.ok(data.accessToken, 'accessToken absent from response');
    assert.ok(typeof data.accessToken === 'string' && data.accessToken.split('.').length === 3,
      'accessToken does not look like a JWT (3 dot-separated segments)');
  });

  test('Wrong password is rejected (401 or 429 — never 200)', async () => {
    const { status, data } = await post('/api/auth/login', { email: ADM_EMAIL, password: 'WrongPass99!' });
    assert.notEqual(status, 200, `Wrong password must not return 200`);
    assert.ok(!data.accessToken, 'Wrong password must not yield an accessToken');
  });

  test('Non-existent email is rejected (401 or 429 — never 200)', async () => {
    const { status, data } = await post('/api/auth/login', { email: 'nobody@notreal.invalid', password: 'any' });
    assert.notEqual(status, 200);
    assert.ok(!data.accessToken);
  });

  test('Missing email field is rejected (400 or 429 — never 200)', async () => {
    const { status, data } = await post('/api/auth/login', { password: ADM_PASS });
    assert.notEqual(status, 200, `Missing email must not return 200`);
    assert.ok(!data.accessToken, 'Must not return an accessToken for incomplete request');
  });

  test('Missing password field is rejected (400 or 429 — never 200)', async () => {
    const { status, data } = await post('/api/auth/login', { email: ADM_EMAIL });
    assert.notEqual(status, 200, `Missing password must not return 200`);
    assert.ok(!data.accessToken, 'Must not return an accessToken for incomplete request');
  });

  test('Empty body is rejected (400 or 429 — never 200)', async () => {
    const { status, data } = await post('/api/auth/login', {});
    assert.notEqual(status, 200, `Empty body must not return 200`);
    assert.ok(!data.accessToken, 'Must not return an accessToken for empty body');
  });
});

// ─── Authorization ────────────────────────────────────────────────────────────

describe('Authorization', () => {
  test('Admin endpoint /api/admin/users requires auth — 401 without token', async () => {
    const { status } = await get('/api/admin/users');
    assert.equal(status, 401, `Expected 401 without token, got ${status}`);
  });

  test('Admin endpoint /api/admin/users accessible with valid admin token', async () => {
    assert.ok(adminToken, 'Admin token not available — check TEST_ADMIN_* env vars');
    const { status } = await get('/api/admin/users', { token: adminToken });
    assert.ok([200, 404].includes(status), `Expected 200/404 with valid token, got ${status}`);
  });

  test('Malformed JWT is rejected with 401', async () => {
    const { status } = await get('/api/admin/users', { token: 'not.a.jwt' });
    assert.equal(status, 401);
  });

  test('Forged JWT (wrong signature) is rejected with 401', async () => {
    // Forge a structurally valid JWT signed with a different secret
    const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
      '.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZW1haWwiOiJoYWNrZXJAZXZpbC5jb20iLCJpYXQiOjE1MTYyMzkwMjIsInJvbGUiOiJhZG1pbiJ9' +
      '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const { status } = await get('/api/admin/users', { token: fakeToken });
    assert.equal(status, 401, 'Forged JWT must be rejected');
  });

  test('Wallet data requires auth', async () => {
    const { status } = await get('/api/wallets');
    assert.ok([401, 403, 404].includes(status),
      `Expected auth-required response, got ${status}`);
  });
});

// ─── Injection Prevention ─────────────────────────────────────────────────────

describe('Injection Prevention', () => {
  // NOTE: Injection tests make login requests that count against the IP-keyed rate limiter.
  // All assertions only verify "no 200 and no token" — the exact rejection code
  // (400/401/429) depends on whether the rate limiter fires first.

  test("SQL injection in email does not return 200 or accessToken", async () => {
    const { status, data } = await post('/api/auth/login', {
      email: "' OR '1'='1'; DROP TABLE users; --",
      password: 'anything',
    });
    assert.notEqual(status, 200, 'SQL injection attempt must not return 200');
    assert.ok(!data.accessToken, 'SQL injection must not yield an accessToken');
  });

  test('Object/NoSQL injection in email object is rejected', async () => {
    const { status, data } = await post('/api/auth/login', {
      email: { '$gt': '' },
      password: { '$gt': '' },
    });
    assert.notEqual(status, 200, 'Object injection must not return 200');
    assert.ok(!data.accessToken, 'Object injection must not yield an accessToken');
  });

  test('XSS payload in email is not reflected unescaped', async () => {
    const xss = '<script>alert(document.cookie)</script>';
    const { data } = await post('/api/auth/login', { email: xss, password: 'test' });
    const body = JSON.stringify(data);
    assert.ok(!body.includes('<script>'), 'Raw <script> tag must not appear in error response');
    assert.ok(!data.accessToken, 'XSS payload must not yield an accessToken');
  });

  test('Null byte in password field does not crash server', async () => {
    // Use a non-auth endpoint to avoid rate-limit interference: inject via profile update
    // which will 401 (no token) without touching the login rate limiter
    const { status } = await post('/api/auth/change-password',
      { currentPassword: 'test\x00injection', newPassword: 'test' }
    );
    assert.ok(status < 500, `Server must not 500 on null-byte input, got ${status}`);
  });

  test('Oversized body does not crash server', async () => {
    const giant = 'A'.repeat(100_000);
    // POST to a non-rate-limited endpoint to avoid exhausting login budget
    const { status } = await post('/api/auth/register', { email: giant, password: giant, firstName: giant });
    assert.ok(status < 500, `Server must not 500 on oversized input, got ${status}`);
  });
});

// ─── CSRF Protection ──────────────────────────────────────────────────────────

describe('CSRF Protection', () => {
  test('POST to state-changing endpoint without X-Requested-With returns 403', async () => {
    // /api/positions/open is not on the CSRF exemption list
    const { status } = await post(
      '/api/positions/open',
      { symbol: 'BTC', side: 'LONG', quantity: 1 },
      { withCSRF: false }
    );
    assert.equal(status, 403, `Expected 403 CSRF block, got ${status}`);
  });

  test('POST with X-Requested-With header passes CSRF check', async () => {
    // Same endpoint — now with the header. Will still 401 (no auth), but NOT 403 (no CSRF block)
    const { status } = await post(
      '/api/positions/open',
      { symbol: 'BTC', side: 'LONG', quantity: 1 }
      // withCSRF defaults to true
    );
    assert.notEqual(status, 403, 'Valid CSRF header must not be blocked');
  });

  test('DELETE without X-Requested-With is blocked', async () => {
    const res = await fetch(`${BASE_URL}/api/positions/close/test-id`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(res.status, 403, `Expected 403 CSRF block on DELETE, got ${res.status}`);
  });
});

// ─── Rate Limiting ────────────────────────────────────────────────────────────

describe('Rate Limiting', () => {
  test('Repeated failed logins eventually trigger 429', async () => {
    // Use a unique email per run to avoid poisoning other tests via IP-keyed limiter
    const probeEmail = `ratelimit-probe-${Date.now()}@test.invalid`;
    let got429 = false;

    // Hit 7 times — limiter window is 5 attempts / 15 min
    for (let i = 0; i < 7; i++) {
      const { status } = await post('/api/auth/login', { email: probeEmail, password: 'wrong' });
      if (status === 429) { got429 = true; break; }
    }

    assert.ok(got429, 'Expected at least one 429 response after repeated failed login attempts');
  });
});

// ─── Data Exposure ────────────────────────────────────────────────────────────

describe('Data Exposure', () => {
  test('Auth response does not contain the user password', async () => {
    const { data } = await post('/api/auth/login', { email: ADM_EMAIL, password: ADM_PASS });
    const body = JSON.stringify(data).toLowerCase();
    assert.ok(!body.includes(ADM_PASS.toLowerCase()), 'Plain-text password in auth response');
    assert.ok(
      !body.includes('"password"') && !body.includes('"passwordhash"') && !body.includes('"hash"'),
      'Password or hash field exposed in auth response'
    );
  });

  test('/api/health does not expose secrets or internal paths', async () => {
    const { data } = await get('/api/health');
    const body = JSON.stringify(data);
    assert.ok(!body.includes('JWT_SECRET'),    'JWT_SECRET leaked in health endpoint');
    assert.ok(!body.includes('DATABASE_URL'),  'DATABASE_URL leaked in health endpoint');
    assert.ok(!body.includes('QA_API_KEY'),    'QA_API_KEY leaked in health endpoint');
    assert.ok(
      !body.toLowerCase().includes('password'),
      'Password data leaked in health endpoint'
    );
  });

  test('404 response does not echo raw query string (no token/PII leakage)', async () => {
    const { data } = await get('/api/nonexistent?token=super-secret-value&foo=bar');
    const body = JSON.stringify(data);
    assert.ok(!body.includes('super-secret-value'), 'Query param value reflected in 404 path echo');
  });
});

// ─── Server Stability ─────────────────────────────────────────────────────────

describe('Server Stability', () => {
  test('Server returns 200 on /api/health', async () => {
    const { status, data } = await get('/api/health');
    assert.equal(status, 200);
    assert.ok(data.status, 'health.status field missing');
  });

  test('Server responds to unexpected HTTP methods gracefully', async () => {
    const res = await fetch(`${BASE_URL}/api/health`, {
      method: 'PATCH',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    assert.ok(res.status < 500, `Server must not 500 on PATCH /api/health, got ${res.status}`);
  });

  test('Deeply nested JSON body does not crash server', async () => {
    let nested = { value: 'deep' };
    for (let i = 0; i < 50; i++) nested = { child: nested };
    const { status } = await post('/api/auth/login', nested);
    assert.ok(status < 500, `Server must not 500 on deeply nested JSON, got ${status}`);
  });
});
