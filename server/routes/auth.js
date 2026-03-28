// ═══════════════════════════════════════════
//   12 TRIBES — AUTH ROUTES
//   Registration, Login, Session management
// ═══════════════════════════════════════════

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, getOne, withTransaction } from '../config/database.js';
import { authenticate, generateTokens, verifyRefreshToken } from '../middleware/auth.js';
import { registerRules, loginRules, handleValidation } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import config from '../config/index.js';
import { logger, auditLogger } from '../services/logger.js';

const router = Router();

// ─── POST /api/auth/register ───
router.post('/register', authLimiter, registerRules, handleValidation, async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;

    // Check for existing user
    const existing = await getOne('SELECT id FROM users WHERE email = $1', [email]);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered', code: 'EMAIL_EXISTS' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, config.auth.bcryptRounds);
    const avatar = (firstName[0] + lastName[0]).toUpperCase();

    // Create user + wallet in transaction
    const result = await withTransaction(async (client) => {
      const userResult = await client.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, avatar, role, status, trading_mode)
         VALUES ($1, $2, $3, $4, $5, 'investor', 'active', 'paper') RETURNING *`,
        [email, passwordHash, firstName, lastName, avatar]
      );
      const user = userResult.rows[0];

      // Create $100,000 virtual wallet
      await client.query(
        `INSERT INTO wallets (user_id, balance, initial_balance, equity, deposit_amount)
         VALUES ($1, 10000000, 10000000, 10000000, 10000000)`,
        [user.id]
      );

      // Record login
      await client.query(
        'INSERT INTO login_log (user_id, method, ip_address, user_agent) VALUES ($1, $2, $3, $4)',
        [user.id, 'register', req.ip, req.get('user-agent')]
      );

      return user;
    });

    const tokens = generateTokens(result);

    auditLogger.info('User registered', { userId: result.id, email });

    res.status(201).json({
      user: {
        id: result.id,
        email: result.email,
        firstName: result.first_name,
        lastName: result.last_name,
        avatar: result.avatar,
        role: result.role,
        tradingMode: result.trading_mode,
        isNewUser: true,
      },
      ...tokens,
    });
  } catch (err) {
    logger.error('Registration failed:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── POST /api/auth/login ───
router.post('/login', authLimiter, loginRules, handleValidation, async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await getOne('SELECT * FROM users WHERE email = $1', [email]);
    if (!user) {
      // Record failed attempt
      await query(
        'INSERT INTO login_log (user_id, method, ip_address, user_agent, success) VALUES (NULL, $1, $2, $3, false)',
        ['email', req.ip, req.get('user-agent')]
      );
      return res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Account suspended', code: 'ACCOUNT_SUSPENDED' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await query(
        'INSERT INTO login_log (user_id, method, ip_address, user_agent, success) VALUES ($1, $2, $3, $4, false)',
        [user.id, 'email', req.ip, req.get('user-agent')]
      );
      return res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }

    // Update login timestamp
    await query(
      'UPDATE users SET last_login_at = NOW(), login_count = login_count + 1 WHERE id = $1',
      [user.id]
    );

    // Record successful login
    await query(
      'INSERT INTO login_log (user_id, method, ip_address, user_agent) VALUES ($1, $2, $3, $4)',
      [user.id, 'email', req.ip, req.get('user-agent')]
    );

    const tokens = generateTokens(user);

    auditLogger.info('User logged in', { userId: user.id, email: user.email });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        avatar: user.avatar,
        role: user.role,
        tradingMode: user.trading_mode,
        lastLoginAt: user.last_login_at,
        loginCount: user.login_count + 1,
      },
      ...tokens,
    });
  } catch (err) {
    logger.error('Login failed:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── POST /api/auth/refresh ───
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded) return res.status(401).json({ error: 'Invalid refresh token' });

  const user = await getOne('SELECT * FROM users WHERE id = $1', [decoded.id]);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const tokens = generateTokens(user);
  res.json(tokens);
});

// ─── GET /api/auth/me ───
router.get('/me', authenticate, async (req, res) => {
  const user = await getOne(
    'SELECT id, email, first_name, last_name, avatar, role, trading_mode, registered_at, last_login_at, login_count FROM users WHERE id = $1',
    [req.userId]
  );
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({
    id: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    avatar: user.avatar,
    role: user.role,
    tradingMode: user.trading_mode,
    registeredAt: user.registered_at,
    lastLoginAt: user.last_login_at,
    loginCount: user.login_count,
  });
});

// ─── POST /api/auth/logout ───
router.post('/logout', authenticate, async (req, res) => {
  auditLogger.info('User logged out', { userId: req.userId });
  res.json({ success: true });
});

// ─── GET /api/auth/login-history ───
router.get('/login-history', authenticate, async (req, res) => {
  const logs = await query(
    'SELECT login_at, method, ip_address, user_agent, success FROM login_log WHERE user_id = $1 ORDER BY login_at DESC LIMIT 50',
    [req.userId]
  );
  res.json(logs.rows);
});

export default router;
