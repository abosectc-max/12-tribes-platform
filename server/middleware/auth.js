// ═══════════════════════════════════════════
//   12 TRIBES — AUTH MIDDLEWARE
//   JWT verification + role-based access
// ═══════════════════════════════════════════

import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { getOne } from '../config/database.js';

// Verify JWT token and attach user to request
export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required', code: 'NO_TOKEN' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.auth.jwtSecret);
    req.user = decoded;
    req.userId = decoded.id;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
  }
}

// Require specific role(s)
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions', required: roles });
    }
    next();
  };
}

// Require live trading to be enabled for this user
export async function requireLiveTrading(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const user = await getOne('SELECT trading_mode FROM users WHERE id = $1', [req.userId]);
  if (!user || user.trading_mode !== 'live') {
    return res.status(403).json({
      error: 'Live trading not enabled',
      code: 'LIVE_TRADING_DISABLED',
      message: 'Switch to live trading mode in settings and connect a broker account first.',
    });
  }
  next();
}

// Generate JWT tokens
export function generateTokens(user) {
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role || 'investor',
    tradingMode: user.trading_mode || 'paper',
  };

  const accessToken = jwt.sign(payload, config.auth.jwtSecret, {
    expiresIn: config.auth.jwtExpiry,
  });

  const refreshToken = jwt.sign(
    { id: user.id, type: 'refresh' },
    config.auth.jwtSecret,
    { expiresIn: config.auth.jwtRefreshExpiry }
  );

  return { accessToken, refreshToken };
}

export function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, config.auth.jwtSecret);
    if (decoded.type !== 'refresh') throw new Error('Not a refresh token');
    return decoded;
  } catch {
    return null;
  }
}
