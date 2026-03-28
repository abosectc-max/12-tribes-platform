// ═══════════════════════════════════════════
//   12 TRIBES — RATE LIMITING
// ═══════════════════════════════════════════

import rateLimit from 'express-rate-limit';
import config from '../config/index.js';

// General API rate limit
export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: { error: 'Too many requests', code: 'RATE_LIMITED', retryAfter: config.rateLimit.windowMs / 1000 },
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict limit for auth endpoints (prevent brute force)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many login attempts', code: 'AUTH_RATE_LIMITED', retryAfter: 900 },
  standardHeaders: true,
  legacyHeaders: false,
});

// Trading rate limit (prevent accidental order floods)
export const tradeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.risk.maxOrdersPerMinute,
  message: { error: 'Order rate limit exceeded', code: 'TRADE_RATE_LIMITED' },
  standardHeaders: true,
  legacyHeaders: false,
});
