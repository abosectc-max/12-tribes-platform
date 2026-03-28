// ═══════════════════════════════════════════
//   12 TRIBES — CONFIGURATION MODULE
//   Centralized environment config with validation
// ═══════════════════════════════════════════

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

function required(key) {
  const val = process.env[key];
  if (!val && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val || '';
}

function optional(key, defaultValue) {
  return process.env[key] || defaultValue;
}

const config = {
  // ─── Server ───
  env: optional('NODE_ENV', 'development'),
  port: parseInt(optional('PORT', '4000'), 10),
  frontendUrl: optional('FRONTEND_URL', 'http://localhost:5173'),
  isDev: optional('NODE_ENV', 'development') === 'development',
  isProd: optional('NODE_ENV', 'development') === 'production',

  // ─── Database ───
  db: {
    connectionString: optional('DATABASE_URL', ''),
    host: optional('DB_HOST', 'localhost'),
    port: parseInt(optional('DB_PORT', '5432'), 10),
    name: optional('DB_NAME', 'twelve_tribes'),
    user: optional('DB_USER', 'tribes_user'),
    password: optional('DB_PASSWORD', ''),
    ssl: optional('DB_SSL', 'false') === 'true',
  },

  // ─── Authentication ───
  auth: {
    jwtSecret: optional('JWT_SECRET', 'dev-secret-change-in-production'),
    jwtExpiry: optional('JWT_EXPIRY', '24h'),
    jwtRefreshExpiry: optional('JWT_REFRESH_EXPIRY', '7d'),
    bcryptRounds: parseInt(optional('BCRYPT_ROUNDS', '12'), 10),
  },

  // ─── Alpaca ───
  alpaca: {
    paper: {
      apiKey: optional('ALPACA_PAPER_API_KEY', ''),
      apiSecret: optional('ALPACA_PAPER_API_SECRET', ''),
      baseUrl: optional('ALPACA_PAPER_BASE_URL', 'https://paper-api.alpaca.markets'),
      dataUrl: optional('ALPACA_PAPER_DATA_URL', 'https://data.alpaca.markets'),
    },
    live: {
      apiKey: optional('ALPACA_LIVE_API_KEY', ''),
      apiSecret: optional('ALPACA_LIVE_API_SECRET', ''),
      baseUrl: optional('ALPACA_LIVE_BASE_URL', 'https://api.alpaca.markets'),
      dataUrl: optional('ALPACA_LIVE_DATA_URL', 'https://data.alpaca.markets'),
    },
    oauth: {
      clientId: optional('ALPACA_OAUTH_CLIENT_ID', ''),
      clientSecret: optional('ALPACA_OAUTH_CLIENT_SECRET', ''),
      redirectUri: optional('ALPACA_OAUTH_REDIRECT_URI', 'http://localhost:4000/api/broker/alpaca/callback'),
    },
  },

  // ─── Market Data ───
  marketData: {
    polygonApiKey: optional('POLYGON_API_KEY', ''),
    useAlpacaData: optional('USE_ALPACA_DATA', 'true') === 'true',
  },

  // ─── Risk Management ───
  risk: {
    maxPositionSizePct: parseFloat(optional('MAX_POSITION_SIZE_PCT', '10')),
    maxDailyLossPct: parseFloat(optional('MAX_DAILY_LOSS_PCT', '5')),
    maxPortfolioDrawdownPct: parseFloat(optional('MAX_PORTFOLIO_DRAWDOWN_PCT', '15')),
    killSwitchDrawdownPct: parseFloat(optional('KILL_SWITCH_DRAWDOWN_PCT', '25')),
    maxOrdersPerMinute: parseInt(optional('MAX_ORDERS_PER_MINUTE', '10'), 10),
    requireConfirmationAbove: parseFloat(optional('REQUIRE_CONFIRMATION_ABOVE', '10000')),
  },

  // ─── Rate Limiting ───
  rateLimit: {
    windowMs: parseInt(optional('RATE_LIMIT_WINDOW_MS', '60000'), 10),
    maxRequests: parseInt(optional('RATE_LIMIT_MAX_REQUESTS', '100'), 10),
  },

  // ─── Logging ───
  logging: {
    level: optional('LOG_LEVEL', 'info'),
    file: optional('LOG_FILE', 'logs/server.log'),
  },
};

export default config;
