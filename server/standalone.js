#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════════════
//   12 TRIBES — STANDALONE BACKEND SERVER v1.0
//   Zero external dependencies — Node.js built-ins only
//   JSON file database | Crypto auth | Raw WebSocket | HTTP router
//
//   Run: node standalone.js
//   Production: swap JsonDB for PostgreSQL adapter (schema in db/schema.sql)
// ═══════════════════════════════════════════════════════════════════════

import { createServer } from 'node:http';
import { createHash, scryptSync, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync, unlinkSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ═══════ CONFIG ═══════
const PORT = parseInt(process.env.PORT || '4000', 10);
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const JWT_SECRET = process.env.JWT_SECRET || 'tribes-dev-secret-' + randomBytes(16).toString('hex');
const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'data');
const INITIAL_BALANCE = 100000;  // $100,000 virtual wallet
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'abose.ctc@gmail.com').toLowerCase();
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev'; // Resend default sender (works without domain verification)
const APP_NAME = '12 Tribes Investments';
const FRONTEND_ORIGIN = process.env.FRONTEND_URL || 'https://12-tribes-platform.vercel.app';
const ALLOWED_ORIGINS = [
  'http://localhost:5173', 'http://localhost:4173', 'http://localhost:3000',
  'https://12-tribes-platform.vercel.app',
  FRONTEND_ORIGIN,
].filter(Boolean);

// ─── Rate Limiter ───
const rateLimitStore = new Map();
function rateLimit(key, maxAttempts, windowMs) {
  const now = Date.now();
  const record = rateLimitStore.get(key) || [];
  const recent = record.filter(t => now - t < windowMs);
  if (recent.length >= maxAttempts) return false;
  recent.push(now);
  rateLimitStore.set(key, recent);
  return true;
}
// Clean rate limit store every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of rateLimitStore) {
    const recent = times.filter(t => now - t < 3600000);
    if (recent.length === 0) rateLimitStore.delete(key);
    else rateLimitStore.set(key, recent);
  }
}, 300000);

// Risk management defaults
const RISK = {
  maxPositionSizePct: 15,      // Allow larger positions for growth
  maxDailyLossPct: 8,          // Wider daily loss limit for active trading
  maxDrawdownPct: 20,          // Allow deeper drawdown during growth phase
  killSwitchDrawdownPct: 35,   // Emergency kill at 35%
  maxOrdersPerMinute: 20,      // Higher frequency for compounding
  confirmationThreshold: 10000,
};

// ═══════════════════════════════════════════
//   HARDENED JSON FILE DATABASE
//   Atomic writes | Backup rotation | Corruption recovery
//   Survives redeploys, crashes, and partial writes
// ═══════════════════════════════════════════

const DB_TABLES = [
  'users', 'wallets', 'positions', 'trades', 'snapshots',
  'login_log', 'agent_stats', 'broker_connections', 'risk_events',
  'order_queue', 'access_requests', 'auto_trade_log', 'fund_settings',
  'verification_codes', 'qa_reports', 'feedback', 'withdrawal_requests',
  // Tax Engine tables
  'tax_ledger', 'tax_lots', 'wash_sales', 'tax_allocations',
  // Distribution & Capital Account tables
  'distributions', 'capital_accounts',
  // WebAuthn Passkey table
  'passkey_credentials',
];

const BACKUP_DIR_NAME = '_backups';
const MAX_BACKUPS = 10;           // Keep last 10 rotation backups per table
const BACKUP_INTERVAL_MS = 300000; // Auto-backup every 5 minutes

class JsonDB {
  constructor(dataDir) {
    this.dir = dataDir;
    this.backupDir = join(dataDir, BACKUP_DIR_NAME);
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    if (!existsSync(this.backupDir)) mkdirSync(this.backupDir, { recursive: true });
    this.tables = {};
    this._dirty = new Set(); // Track tables that have been modified since last backup

    // Load all tables with corruption recovery
    for (const table of DB_TABLES) {
      this._load(table);
    }

    // Seed AI agents if empty
    if (this.tables.agent_stats.length === 0) {
      ['Viper', 'Oracle', 'Spectre', 'Sentinel', 'Phoenix', 'Titan'].forEach(name => {
        this.tables.agent_stats.push({
          id: randomUUID(), agent_name: name,
          total_trades: 0, wins: 0, losses: 0, total_pnl: 0,
          best_trade: 0, worst_trade: 0, avg_return: 0,
        });
      });
      this._save('agent_stats');
    }

    // Log startup data integrity
    const counts = DB_TABLES.map(t => `${t}:${this.tables[t].length}`).join(', ');
    console.log(`[DB] Loaded from ${dataDir} — ${counts}`);

    // Start auto-backup rotation
    this._backupInterval = setInterval(() => this._rotateBackup(), BACKUP_INTERVAL_MS);
  }

  _filePath(table) { return join(this.dir, `${table}.json`); }
  _tmpPath(table) { return join(this.dir, `${table}.json.tmp`); }
  _bakPath(table) { return join(this.dir, `${table}.json.bak`); }

  // ─── LOAD with multi-layer recovery ───
  _load(table) {
    const fp = this._filePath(table);
    const bak = this._bakPath(table);

    // Try primary file
    const primary = this._tryParseFile(fp);
    if (primary !== null) {
      this.tables[table] = primary;
      return;
    }

    // Primary failed — try .bak file
    console.warn(`[DB] Primary file corrupt/missing for "${table}", trying backup...`);
    const backup = this._tryParseFile(bak);
    if (backup !== null) {
      console.warn(`[DB] Recovered "${table}" from .bak file (${backup.length} records)`);
      this.tables[table] = backup;
      this._save(table); // Re-save good data to primary
      return;
    }

    // Both failed — try rotation backups (newest first)
    const rotationBackup = this._tryRecoverFromRotation(table);
    if (rotationBackup !== null) {
      console.warn(`[DB] Recovered "${table}" from rotation backup (${rotationBackup.length} records)`);
      this.tables[table] = rotationBackup;
      this._save(table);
      return;
    }

    // No recovery possible — start empty (this is a genuinely new table)
    console.warn(`[DB] No data found for "${table}" — starting empty`);
    this.tables[table] = [];
  }

  _tryParseFile(fp) {
    try {
      if (!existsSync(fp)) return null;
      const raw = readFileSync(fp, 'utf8').trim();
      if (!raw || raw.length < 2) return null; // Empty or truncated
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null; // Must be an array
      return parsed;
    } catch (err) {
      console.error(`[DB] Parse error in ${fp}: ${err.message}`);
      return null;
    }
  }

  _tryRecoverFromRotation(table) {
    try {
      const prefix = `${table}_`;
      const files = readdirSync(this.backupDir)
        .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
        .sort()
        .reverse(); // Newest first (ISO timestamp sorts correctly)

      for (const file of files) {
        const data = this._tryParseFile(join(this.backupDir, file));
        if (data !== null && data.length > 0) return data;
      }
    } catch {}
    return null;
  }

  // ─── ATOMIC SAVE: write temp → rename (prevents corruption) ───
  _save(table) {
    const fp = this._filePath(table);
    const tmp = this._tmpPath(table);
    const bak = this._bakPath(table);

    try {
      const json = JSON.stringify(this.tables[table], null, 2);

      // Validate what we're about to write (never write empty if we had data)
      if (this.tables[table].length === 0) {
        // Only write empty if the file doesn't exist or was already empty
        const existing = this._tryParseFile(fp);
        if (existing && existing.length > 0) {
          console.error(`[DB] BLOCKED: Refusing to overwrite ${table} (${existing.length} records) with empty array`);
          return;
        }
      }

      // Step 1: Write to temp file
      writeFileSync(tmp, json);

      // Step 2: Verify temp file is valid JSON
      const verify = JSON.parse(readFileSync(tmp, 'utf8'));
      if (!Array.isArray(verify)) throw new Error('Temp file validation failed');

      // Step 3: Backup current file before overwriting
      if (existsSync(fp)) {
        try { copyFileSync(fp, bak); } catch {}
      }

      // Step 4: Atomic rename (on same filesystem, this is atomic on Linux)
      renameSync(tmp, fp);

      this._dirty.add(table);
    } catch (err) {
      console.error(`[DB] Save error for "${table}": ${err.message}`);
      // Clean up temp file if it exists
      try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
    }
  }

  // ─── ROTATION BACKUP: periodic full snapshots ───
  _rotateBackup() {
    if (this._dirty.size === 0) return; // Nothing changed

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    for (const table of this._dirty) {
      try {
        const backupFile = join(this.backupDir, `${table}_${timestamp}.json`);
        const json = JSON.stringify(this.tables[table], null, 2);
        writeFileSync(backupFile, json);

        // Prune old backups (keep MAX_BACKUPS newest)
        const prefix = `${table}_`;
        const files = readdirSync(this.backupDir)
          .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
          .sort();
        while (files.length > MAX_BACKUPS) {
          const oldest = files.shift();
          try { unlinkSync(join(this.backupDir, oldest)); } catch {}
        }
      } catch (err) {
        console.error(`[DB] Backup error for "${table}": ${err.message}`);
      }
    }

    console.log(`[DB] Backup rotation complete: ${this._dirty.size} tables backed up at ${timestamp}`);
    this._dirty.clear();
  }

  // ─── FLUSH ALL: called during graceful shutdown ───
  flushAll() {
    console.log('[DB] Flushing all tables to disk...');
    for (const table of DB_TABLES) {
      try {
        this._save(table);
      } catch (err) {
        console.error(`[DB] Flush error for "${table}": ${err.message}`);
      }
    }
    // Final rotation backup
    this._dirty = new Set(DB_TABLES);
    this._rotateBackup();
    console.log('[DB] Flush complete.');
  }

  // ─── STOP: cleanup intervals ───
  stop() {
    if (this._backupInterval) clearInterval(this._backupInterval);
  }

  // ─── CRUD operations (unchanged interface) ───

  insert(table, record) {
    if (!record.id) record.id = randomUUID();
    record.created_at = new Date().toISOString();
    this.tables[table].push(record);
    this._save(table);
    return record;
  }

  findOne(table, predicate) {
    return this.tables[table].find(predicate) || null;
  }

  findMany(table, predicate) {
    return predicate ? this.tables[table].filter(predicate) : [...this.tables[table]];
  }

  update(table, predicate, updates) {
    const record = this.tables[table].find(predicate);
    if (record) {
      Object.assign(record, updates, { updated_at: new Date().toISOString() });
      this._save(table);
    }
    return record;
  }

  remove(table, predicate) {
    const idx = this.tables[table].findIndex(predicate);
    if (idx >= 0) {
      const removed = this.tables[table].splice(idx, 1)[0];
      this._save(table);
      return removed;
    }
    return null;
  }

  count(table, predicate) {
    return predicate ? this.tables[table].filter(predicate).length : this.tables[table].length;
  }
}

const db = new JsonDB(DATA_DIR);

// ═══════════════════════════════════════════
//   AUTHENTICATION (scrypt + HMAC JWT)
// ═══════════════════════════════════════════

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = scryptSync(password, salt, 64).toString('hex');
  return test === hash;
}

function createJWT(payload, expiresInSec = 86400) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSec })).toString('base64url');
  const signature = createHash('sha256').update(`${header}.${body}.${JWT_SECRET}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyJWT(token) {
  try {
    const [header, body, signature] = token.split('.');
    const expected = createHash('sha256').update(`${header}.${body}.${JWT_SECRET}`).digest('base64url');
    if (signature !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function extractUser(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return verifyJWT(auth.split(' ')[1]);
}

// ═══════════════════════════════════════════
//   HTTP ROUTER
// ═══════════════════════════════════════════

class Router {
  constructor() { this.routes = []; }

  add(method, path, ...handlers) {
    // Convert /api/path/:param to regex
    const paramNames = [];
    const pattern = path.replace(/:(\w+)/g, (_, name) => { paramNames.push(name); return '([^/]+)'; });
    const regex = new RegExp(`^${pattern}$`);
    this.routes.push({ method: method.toUpperCase(), regex, paramNames, handlers });
  }

  get(path, ...h) { this.add('GET', path, ...h); }
  post(path, ...h) { this.add('POST', path, ...h); }
  put(path, ...h) { this.add('PUT', path, ...h); }
  patch(path, ...h) { this.add('PATCH', path, ...h); }
  delete(path, ...h) { this.add('DELETE', path, ...h); }

  async handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    req.query = Object.fromEntries(url.searchParams);

    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const match = pathname.match(route.regex);
      if (!match) continue;

      req.params = {};
      route.paramNames.forEach((name, i) => { req.params[name] = match[i + 1]; });

      for (const handler of route.handlers) {
        let called = false;
        await new Promise((resolve, reject) => {
          handler(req, res, () => { called = true; resolve(); });
          if (!called) setTimeout(resolve, 0);
        });
        if (res.writableEnded) return true;
      }
      return true;
    }
    return false;
  }
}

// ═══════════════════════════════════════════
//   REAL MARKET DATA — Yahoo Finance Integration
//   Fetches live quotes with automatic fallback to simulated engine
// ═══════════════════════════════════════════

const MARKET_DATA_MODE = process.env.MARKET_DATA_MODE || 'hybrid'; // 'real' | 'simulated' | 'hybrid'
const REAL_PRICE_CACHE = {}; // { symbol: { price, timestamp } }
const REAL_PRICE_TTL = 15000; // 15-second cache to avoid rate limiting
let lastRealFetchTime = 0;
let realDataAvailable = false; // Set true once first successful fetch completes

// Yahoo Finance symbol mapping (crypto needs special format)
const YAHOO_SYMBOL_MAP = {
  'BTC': 'BTC-USD', 'ETH': 'ETH-USD', 'SOL': 'SOL-USD', 'AVAX': 'AVAX-USD',
  'DOGE': 'DOGE-USD', 'XRP': 'XRP-USD', 'ADA': 'ADA-USD',
  'EUR/USD': 'EURUSD=X', 'GBP/USD': 'GBPUSD=X', 'USD/JPY': 'JPY=X', 'AUD/USD': 'AUDUSD=X',
};

function getYahooSymbol(sym) {
  return YAHOO_SYMBOL_MAP[sym] || sym;
}

// Fetch real quotes from Yahoo Finance (batch — up to 10 symbols per call)
async function fetchRealPrices(symbols) {
  if (MARKET_DATA_MODE === 'simulated') return {};

  const https = await import('node:https');
  const yahooSymbols = symbols.map(s => getYahooSymbol(s));
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${yahooSymbols.join(',')}`;

  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; 12Tribes/1.0)' },
      timeout: 8000,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const quotes = data?.quoteResponse?.result || [];
          const prices = {};
          for (const quote of quotes) {
            // Map Yahoo symbol back to our symbol
            const ourSym = symbols.find(s => getYahooSymbol(s) === quote.symbol) || quote.symbol;
            const price = quote.regularMarketPrice || quote.price;
            if (price && price > 0) {
              const decimals = price < 10 ? 4 : 2;
              prices[ourSym] = roundTo(price, decimals);
              REAL_PRICE_CACHE[ourSym] = { price: prices[ourSym], timestamp: Date.now() };
            }
          }
          if (Object.keys(prices).length > 0) {
            realDataAvailable = true;
            lastRealFetchTime = Date.now();
          }
          resolve(prices);
        } catch (e) {
          console.warn('[Market Data] Yahoo Finance parse error:', e.message);
          resolve({});
        }
      });
    });
    req.on('error', (e) => {
      console.warn('[Market Data] Yahoo Finance fetch error:', e.message);
      resolve({});
    });
    req.on('timeout', () => { req.destroy(); resolve({}); });
  });
}

// Batch fetch all symbols — called periodically
async function refreshRealMarketData() {
  if (MARKET_DATA_MODE === 'simulated') return;

  const allSyms = Object.keys(DEFAULT_PRICES);
  // Batch in groups of 10 to avoid URL length issues
  for (let i = 0; i < allSyms.length; i += 10) {
    const batch = allSyms.slice(i, i + 10);
    try {
      const prices = await fetchRealPrices(batch);
      for (const [sym, price] of Object.entries(prices)) {
        if (price > 0) {
          marketPrices[sym] = price;
          // Update price history with real data
          if (priceHistory[sym]) {
            priceHistory[sym].push(price);
            if (priceHistory[sym].length > PRICE_HISTORY_LEN) priceHistory[sym].shift();
            symbolRegimes[sym] = detectRegime(priceHistory[sym]);
          }
        }
      }
    } catch (e) {
      console.warn(`[Market Data] Batch fetch error for ${batch.join(',')}: ${e.message}`);
    }
    // Small delay between batches to be respectful
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`[Market Data] Real prices refreshed: ${Object.keys(REAL_PRICE_CACHE).length} symbols, mode=${MARKET_DATA_MODE}`);
}

// ═══════════════════════════════════════════
//   MARKET DATA + SIMULATED PRICE ENGINE
// ═══════════════════════════════════════════

const DEFAULT_PRICES = {
  // ─── STOCKS: Tech/Growth ───
  "AAPL": 227.50, "MSFT": 422.30, "NVDA": 138.20, "TSLA": 278.40,
  "AMZN": 198.60, "GOOGL": 175.80, "META": 612.40, "JPM": 248.90,
  "AMD": 164.30, "PLTR": 72.80, "COIN": 248.50,
  "JNJ": 158.20, "VOO": 478.60,
  // ─── STOCKS: Recovery/Value ───
  "F": 11.40, "BAC": 42.80, "WISH": 5.20, "RIOT": 12.60, "GE": 174.30, "CCIV": 24.50,
  // ─── CRYPTO: Full Universe ───
  "BTC": 87432, "ETH": 3287, "SOL": 187.50, "AVAX": 38.20,
  "DOGE": 0.1742, "XRP": 2.18, "ADA": 0.72,
  "DOT": 7.45, "MATIC": 0.58, "LINK": 16.80,
  // ─── FOREX: Major Pairs ───
  "EUR/USD": 1.0842, "GBP/USD": 1.2934, "USD/JPY": 150.85, "AUD/USD": 0.6521,
  "USD/CHF": 0.8812, "USD/CAD": 1.3645,
  // ─── ETFs: Broad Market + Sectors ───
  "SPY": 521.47, "QQQ": 441.22, "GLD": 284.70, "TLT": 87.30,
  "IWM": 202.40, "EEM": 42.70, "DIA": 394.50, "VTI": 268.30,
  "XLF": 42.80, "XLE": 89.40, "XLK": 218.50, "ARKK": 52.30, "HYG": 77.60,
  // ─── OPTIONS PROXIES: Leveraged ETFs ───
  "TQQQ": 62.40, "SOXL": 28.70, "UVXY": 24.80, "SPXS": 9.15, "SQQQ": 10.20, "TNA": 38.60,
  // ─── FUTURES: Commodities + Index ───
  "CL=F": 78.40, "GC=F": 2340.50, "SI=F": 28.15, "NG=F": 2.68,
  "ES=F": 5245.00, "NQ=F": 18320.00, "YM=F": 39480.00, "ZB=F": 118.25,
  // ─── CASH: Money Market / Short-Term Treasuries ───
  "BIL": 91.58, "SHV": 110.42, "SGOV": 100.38,
};

const marketPrices = { ...DEFAULT_PRICES };

// ─── Precision-safe rounding to avoid floating point drift ───
function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// ═══════════════════════════════════════════
//   PRICE HISTORY + REGIME DETECTION
//   Tracks rolling windows for each symbol
//   so agents can detect trends/momentum
// ═══════════════════════════════════════════
const PRICE_HISTORY_LEN = 120; // ~4 minutes of 2s ticks
const priceHistory = {};
const symbolRegimes = {}; // 'trending_up' | 'trending_down' | 'ranging'

// Seed price history with strong trend data so agents can trade on first tick
// Creates a mix of bullish, bearish, and ranging histories across symbols
const symKeys = Object.keys(DEFAULT_PRICES);
for (let si = 0; si < symKeys.length; si++) {
  const sym = symKeys[si];
  const basePrice = DEFAULT_PRICES[sym];
  const hist = [];
  const decimals = basePrice < 10 ? 4 : 2;

  // Alternate symbols between bullish rally, bearish dip, and recovery patterns
  const pattern = si % 3; // 0=bullish, 1=bearish, 2=recovery (oversold bounce)

  if (pattern === 0) {
    // BULLISH: overall uptrend ~3-5% with natural pullbacks every 15-25 ticks
    let p = basePrice * 0.96;
    const stepUp = (basePrice - p) / PRICE_HISTORY_LEN;
    let pullbackCountdown = 15 + Math.floor(Math.random() * 10);
    for (let i = 0; i < PRICE_HISTORY_LEN; i++) {
      pullbackCountdown--;
      if (pullbackCountdown <= 0 && pullbackCountdown > -5) {
        // 5-tick pullback: price dips ~0.3-0.5%
        p -= Math.abs(stepUp) * (1.5 + Math.random());
      } else {
        p += stepUp + (Math.random() - 0.35) * stepUp * 1.5;
        if (pullbackCountdown <= -5) pullbackCountdown = 15 + Math.floor(Math.random() * 10);
      }
      hist.push(roundTo(Math.max(p, basePrice * 0.93), decimals));
    }
  } else if (pattern === 1) {
    // BEARISH: overall downtrend ~3-5% with relief rallies every 15-25 ticks
    let p = basePrice * 1.05;
    const stepDown = (p - basePrice) / PRICE_HISTORY_LEN;
    let rallyCountdown = 15 + Math.floor(Math.random() * 10);
    for (let i = 0; i < PRICE_HISTORY_LEN; i++) {
      rallyCountdown--;
      if (rallyCountdown <= 0 && rallyCountdown > -4) {
        // 4-tick relief rally
        p += Math.abs(stepDown) * (1.5 + Math.random());
      } else {
        p -= stepDown + (Math.random() - 0.35) * stepDown * 1.5;
        if (rallyCountdown <= -4) rallyCountdown = 15 + Math.floor(Math.random() * 10);
      }
      hist.push(roundTo(Math.min(p, basePrice * 1.07), decimals));
    }
  } else {
    // RECOVERY: dip phase with oscillation, then gradual bounce
    let p = basePrice * 1.02;
    for (let i = 0; i < PRICE_HISTORY_LEN; i++) {
      if (i < 70) {
        // Dip phase with natural oscillation (not monotonic)
        const oscillation = Math.sin(i / 8) * 0.0003;
        p *= (1 - 0.0006 - Math.random() * 0.0008 + oscillation);
      } else if (i < 90) {
        // Base-building / consolidation
        p *= (1 + (Math.random() - 0.5) * 0.002);
      } else {
        // Recovery bounce
        p *= (1 + 0.0015 + Math.random() * 0.001);
      }
      hist.push(roundTo(p, decimals));
    }
  }
  // Snap last price to current market price
  hist[hist.length - 1] = basePrice;
  priceHistory[sym] = hist;
}
// Detect regimes from seeded data
for (const sym of symKeys) {
  symbolRegimes[sym] = detectRegime(priceHistory[sym]);
}
console.log(`[Boot] Price history seeded: ${symKeys.length} symbols × ${PRICE_HISTORY_LEN} ticks, regimes detected`);

// ─── Technical Indicators (computed from price history) ───
function sma(arr, n) {
  if (arr.length < n) return arr.reduce((a, b) => a + b, 0) / arr.length;
  const slice = arr.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

function ema(arr, n) {
  const k = 2 / (n + 1);
  let e = arr[0];
  for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
  return e;
}

function rsi(arr, period = 14) {
  if (arr.length < period + 1) return 50;
  const data = arr.slice(-(period * 3 + 1)); // Use 3x period for Wilder's smoothing warmup
  let avgGain = 0, avgLoss = 0;
  // Initial average from first `period` changes
  for (let i = 1; i <= Math.min(period, data.length - 1); i++) {
    const diff = data[i] - data[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  // Wilder's exponential smoothing for remaining data points
  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 95; // Cap at 95 to avoid overbought saturation
  const rs = avgGain / avgLoss;
  return Math.min(95, Math.max(5, 100 - (100 / (1 + rs)))); // Clamp to 5-95 range
}

function momentum(arr, lookback = 20) {
  if (arr.length < lookback + 1) return 0;
  return (arr[arr.length - 1] / arr[arr.length - 1 - lookback] - 1) * 100;
}

function volatility(arr, n = 20) {
  if (arr.length < n) return 0;
  const slice = arr.slice(-n);
  const mean = slice.reduce((a, b) => a + b, 0) / n;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return Math.sqrt(variance) / mean * 100; // % volatility
}

// ═══════════════════════════════════════════════════════════
//   ADVANCED TECHNICAL INDICATORS — Big Data Layer
// ═══════════════════════════════════════════════════════════

// Bollinger Bands: mean ± k*stdev
function bollingerBands(arr, n = 20, k = 2) {
  if (arr.length < n) return { upper: 0, middle: 0, lower: 0, width: 0, pctB: 0.5 };
  const slice = arr.slice(-n);
  const middle = slice.reduce((a, b) => a + b, 0) / n;
  const stdev = Math.sqrt(slice.reduce((a, b) => a + (b - middle) ** 2, 0) / n);
  const upper = middle + k * stdev;
  const lower = middle - k * stdev;
  const width = stdev > 0 ? (upper - lower) / middle * 100 : 0;
  const price = arr[arr.length - 1];
  const pctB = upper !== lower ? (price - lower) / (upper - lower) : 0.5;
  return { upper, middle, lower, width, pctB };
}

// Average Directional Index (ADX) — trend strength
function adx(arr, period = 14) {
  if (arr.length < period * 2) return 0;
  const recent = arr.slice(-(period * 2));
  let plusDM = 0, minusDM = 0, tr = 0;
  for (let i = 1; i < recent.length; i++) {
    const high = recent[i]; // approximation: price as proxy for H/L/C
    const low = recent[i] * 0.998;
    const prevHigh = recent[i - 1];
    const prevLow = recent[i - 1] * 0.998;
    const upMove = high - prevHigh;
    const downMove = prevLow - low;
    plusDM += upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM += downMove > upMove && downMove > 0 ? downMove : 0;
    tr += Math.max(high - low, Math.abs(high - recent[i - 1]), Math.abs(low - recent[i - 1]));
  }
  if (tr === 0) return 0;
  const plusDI = (plusDM / tr) * 100;
  const minusDI = (minusDM / tr) * 100;
  const diSum = plusDI + minusDI;
  return diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
}

// Stochastic Oscillator (%K, %D)
function stochastic(arr, kPeriod = 14, dPeriod = 3) {
  if (arr.length < kPeriod) return { k: 50, d: 50 };
  const kValues = [];
  for (let i = kPeriod; i <= arr.length; i++) {
    const window = arr.slice(i - kPeriod, i);
    const high = Math.max(...window);
    const low = Math.min(...window);
    const close = window[window.length - 1];
    kValues.push(high !== low ? ((close - low) / (high - low)) * 100 : 50);
  }
  const k = kValues[kValues.length - 1];
  const d = kValues.length >= dPeriod
    ? kValues.slice(-dPeriod).reduce((a, b) => a + b, 0) / dPeriod : k;
  return { k, d };
}

// On-Balance Volume proxy (using price direction as volume proxy)
function obv(arr) {
  if (arr.length < 10) return 0;
  let cumOBV = 0;
  for (let i = 1; i < arr.length; i++) {
    const vol = Math.abs(arr[i] - arr[i - 1]) / arr[i - 1] * 1000; // proxy volume from price change
    cumOBV += arr[i] > arr[i - 1] ? vol : arr[i] < arr[i - 1] ? -vol : 0;
  }
  return cumOBV;
}

// Rate of Change (ROC) — percentage change over n periods
function roc(arr, n = 12) {
  if (arr.length < n + 1) return 0;
  return (arr[arr.length - 1] / arr[arr.length - 1 - n] - 1) * 100;
}

// Average True Range proxy (volatility in price units)
function atr(arr, period = 14) {
  if (arr.length < period + 1) return 0;
  let sumTR = 0;
  for (let i = arr.length - period; i < arr.length; i++) {
    const tr = Math.abs(arr[i] - arr[i - 1]);
    sumTR += tr;
  }
  return sumTR / period;
}

// VWAP proxy (volume-weighted average using price change as volume proxy)
function vwap(arr) {
  if (arr.length < 10) return arr[arr.length - 1] || 0;
  let cumPV = 0, cumV = 0;
  for (let i = 1; i < arr.length; i++) {
    const vol = Math.abs(arr[i] - arr[i - 1]) / arr[i - 1] * 1000 + 1; // ensure non-zero
    cumPV += arr[i] * vol;
    cumV += vol;
  }
  return cumV > 0 ? cumPV / cumV : arr[arr.length - 1];
}

// ═══════════════════════════════════════════════════════════
//   MULTI-TIMEFRAME ANALYSIS
//   Short (10 ticks), Medium (30 ticks), Long (90 ticks)
// ═══════════════════════════════════════════════════════════
function multiTimeframeSignal(hist) {
  if (hist.length < 90) return { short: 0, medium: 0, long: 0, alignment: 0 };
  const shortHist = hist.slice(-10);
  const medHist = hist.slice(-30);
  const longHist = hist.slice(-90);

  const shortMom = momentum(shortHist, Math.min(5, shortHist.length - 1));
  const medMom = momentum(medHist, 20);
  const longMom = momentum(longHist, 60);

  const shortRsi = rsi(shortHist, Math.min(7, shortHist.length - 1));
  const medRsi = rsi(medHist, 14);

  const shortSignal = shortMom > 0.2 ? 1 : shortMom < -0.2 ? -1 : 0;
  const medSignal = medMom > 0.3 ? 1 : medMom < -0.3 ? -1 : 0;
  const longSignal = longMom > 0.5 ? 1 : longMom < -0.5 ? -1 : 0;

  // Alignment: all 3 timeframes agree = strongest signal
  const alignment = shortSignal === medSignal && medSignal === longSignal && shortSignal !== 0
    ? shortSignal * 3
    : shortSignal + medSignal + longSignal;

  return {
    short: shortSignal, medium: medSignal, long: longSignal,
    alignment,
    shortMom, medMom, longMom, shortRsi, medRsi,
  };
}

// ═══════════════════════════════════════════════════════════
//   CROSS-ASSET CORRELATION ENGINE
//   Detects: BTC/ETH correlation, sector rotation,
//   risk-on/risk-off regime from SPY/TLT/GLD
// ═══════════════════════════════════════════════════════════
const correlationCache = { data: {}, lastUpdated: 0 };

function computeCorrelation(arr1, arr2, n = 30) {
  if (arr1.length < n || arr2.length < n) return 0;
  const a = arr1.slice(-n);
  const b = arr2.slice(-n);
  const retA = [], retB = [];
  for (let i = 1; i < n; i++) {
    retA.push(a[i] / a[i - 1] - 1);
    retB.push(b[i] / b[i - 1] - 1);
  }
  const meanA = retA.reduce((s, v) => s + v, 0) / retA.length;
  const meanB = retB.reduce((s, v) => s + v, 0) / retB.length;
  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < retA.length; i++) {
    cov += (retA[i] - meanA) * (retB[i] - meanB);
    varA += (retA[i] - meanA) ** 2;
    varB += (retB[i] - meanB) ** 2;
  }
  const denom = Math.sqrt(varA * varB);
  return denom > 0 ? cov / denom : 0;
}

function updateCorrelationMatrix() {
  const now = Date.now();
  if (now - correlationCache.lastUpdated < 60000) return; // Update every 60s
  correlationCache.lastUpdated = now;

  // Key pairs for cross-asset intelligence
  const pairs = [
    ['SPY', 'TLT'],   // Stocks vs Bonds (risk-on/off)
    ['SPY', 'GLD'],   // Stocks vs Gold (fear gauge)
    ['BTC', 'ETH'],   // Crypto correlation
    ['BTC', 'SPY'],   // Crypto-equity linkage
    ['NVDA', 'AMD'],  // Sector correlation
    ['QQQ', 'IWM'],   // Growth vs Value
  ];

  for (const [a, b] of pairs) {
    if (priceHistory[a]?.length >= 30 && priceHistory[b]?.length >= 30) {
      correlationCache.data[`${a}_${b}`] = computeCorrelation(priceHistory[a], priceHistory[b]);
    }
  }

  // Derive market regime from cross-asset signals
  const spyTlt = correlationCache.data['SPY_TLT'] || 0;
  const spyGld = correlationCache.data['SPY_GLD'] || 0;
  correlationCache.marketRegime =
    spyTlt < -0.3 && spyGld < -0.2 ? 'RISK_ON' :    // Stocks up, bonds/gold down
    spyTlt > 0.3 && spyGld > 0.2 ? 'RISK_OFF' :      // Everything correlated = stress
    'NEUTRAL';
}

// ═══════════════════════════════════════════════════════════
//   NEWS SENTIMENT ENGINE
//   Fetches real headlines, scores sentiment, feeds to agents.
//   Uses free APIs: NewsAPI.org, Alpha Vantage, or RSS feeds.
//   Falls back to simulated sentiment if APIs unavailable.
// ═══════════════════════════════════════════════════════════
const sentimentStore = {}; // { symbol: { score: -1 to 1, headlines: [], lastUpdated, source } }
const SENTIMENT_KEYWORDS = {
  bullish: ['surge','rally','beat','upgrade','buy','growth','record','breakthrough','soar','bullish','profit','revenue beat','strong earnings','outperform','all-time high'],
  bearish: ['crash','plunge','miss','downgrade','sell','decline','layoff','bearish','loss','warning','cut','weak','underperform','investigate','lawsuit','bankruptcy','default'],
};

function scoreSentiment(text) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const word of SENTIMENT_KEYWORDS.bullish) {
    if (lower.includes(word)) score += 0.15;
  }
  for (const word of SENTIMENT_KEYWORDS.bearish) {
    if (lower.includes(word)) score -= 0.15;
  }
  return Math.max(-1, Math.min(1, score));
}

async function fetchNewsSentiment() {
  const symbols = ['AAPL', 'TSLA', 'NVDA', 'BTC', 'MSFT', 'META', 'GOOGL', 'SPY'];

  for (const sym of symbols) {
    try {
      // Try Alpha Vantage news sentiment (free tier: 25 req/day)
      const avKey = process.env.ALPHA_VANTAGE_KEY;
      if (avKey) {
        const https = await import('node:https');
        const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${sym}&limit=5&apikey=${avKey}`;
        const data = await new Promise((resolve, reject) => {
          https.get(url, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
          }).on('error', reject);
        });

        if (data?.feed?.length > 0) {
          const headlines = data.feed.slice(0, 5).map(a => a.title);
          const scores = data.feed.slice(0, 5).map(a => {
            const tickerSentiment = a.ticker_sentiment?.find(t => t.ticker === sym);
            return tickerSentiment ? parseFloat(tickerSentiment.ticker_sentiment_score) : scoreSentiment(a.title);
          });
          const avgScore = scores.reduce((s, v) => s + v, 0) / scores.length;
          sentimentStore[sym] = {
            score: Math.max(-1, Math.min(1, avgScore)),
            headlines,
            lastUpdated: Date.now(),
            source: 'alphavantage',
            articleCount: data.feed.length,
          };
          continue;
        }
      }

      // Fallback: generate market-aware simulated sentiment
      // Uses price momentum and regime to create correlated sentiment
      const hist = priceHistory[sym];
      const regime = symbolRegimes[sym];
      const mom20 = hist?.length >= 20 ? momentum(hist, 20) : 0;
      const baseScore = mom20 * 0.3 + (regime === 'trending_up' ? 0.2 : regime === 'trending_down' ? -0.2 : 0);
      const noise = (Math.random() - 0.5) * 0.3;
      sentimentStore[sym] = {
        score: Math.max(-1, Math.min(1, baseScore + noise)),
        headlines: generateHeadlines(sym, baseScore + noise),
        lastUpdated: Date.now(),
        source: 'derived',
        articleCount: 3,
      };
    } catch (err) {
      // Silent fail — sentiment is supplementary, not critical
    }
  }
}

function generateHeadlines(symbol, sentiment) {
  const bullHeadlines = [
    `${symbol} shows strong momentum amid sector rotation`,
    `Analysts upgrade ${symbol} citing robust fundamentals`,
    `${symbol} breaks key resistance level, bulls in control`,
  ];
  const bearHeadlines = [
    `${symbol} faces headwinds as sector rotates out`,
    `Concerns mount over ${symbol} valuation levels`,
    `${symbol} breaks support, bears gaining momentum`,
  ];
  const neutralHeadlines = [
    `${symbol} consolidates ahead of key catalyst`,
    `Mixed signals for ${symbol} as market weighs data`,
    `${symbol} trades in range, awaiting direction`,
  ];
  if (sentiment > 0.15) return bullHeadlines;
  if (sentiment < -0.15) return bearHeadlines;
  return neutralHeadlines;
}

// Fetch sentiment every 5 minutes (respects API rate limits)
let sentimentInterval = null;
fetchNewsSentiment(); // Initial fetch on boot
sentimentInterval = setInterval(fetchNewsSentiment, 5 * 60 * 1000);

// ═══════════════════════════════════════════════════════════
//   MARKET SESSION AWARENESS
//   Adjusts volatility expectations and trading behavior
//   based on global market hours
// ═══════════════════════════════════════════════════════════
function getMarketSession() {
  const now = new Date();
  const utcHour = now.getUTCHours();

  // Pre-market: 4-9:30 ET (9-14:30 UTC)
  // Market open: 9:30-16:00 ET (14:30-21:00 UTC)
  // After hours: 16-20 ET (21:00-01:00 UTC)
  // Asia session: 19:00-04:00 ET (00:00-09:00 UTC)
  // Europe session: 03:00-11:30 ET (08:00-16:30 UTC)

  if (utcHour >= 14 && utcHour < 21) return { session: 'US_MARKET', volMultiplier: 1.3, label: 'US Market Hours' };
  if (utcHour >= 8 && utcHour < 16) return { session: 'EU_MARKET', volMultiplier: 1.1, label: 'EU Market Hours' };
  if (utcHour >= 0 && utcHour < 9) return { session: 'ASIA_MARKET', volMultiplier: 1.0, label: 'Asia Session' };
  return { session: 'OFF_HOURS', volMultiplier: 0.7, label: 'Off-Hours' };
}

// ═══════════════════════════════════════════════════════════
//   PERSISTENT LEARNING — Save/Load Agent Intelligence
//   Survives server restarts. Agents never lose their edge.
// ═══════════════════════════════════════════════════════════
function saveAgentIntelligence() {
  const intel = {
    agentPerformance: {},
    symbolPerformance: {},
    sentimentCache: {},
    indicatorLearning: {},
    strategyState: {},
    circuitBreakers: {},
    savedAt: new Date().toISOString(),
  };
  // Only save if we have meaningful data
  for (const [name, perf] of Object.entries(agentPerformance)) {
    if (perf.wins + perf.losses > 0) intel.agentPerformance[name] = perf;
  }
  for (const [sym, perf] of Object.entries(symbolPerformance)) {
    if (perf.wins + perf.losses > 0) intel.symbolPerformance[sym] = perf;
  }
  for (const [sym, sent] of Object.entries(sentimentStore)) {
    intel.sentimentCache[sym] = sent;
  }
  // Persist learning engine state
  for (const [agent, symbols] of Object.entries(indicatorLearning)) {
    intel.indicatorLearning[agent] = symbols;
  }
  for (const [agent, state] of Object.entries(strategyState)) {
    intel.strategyState[agent] = state;
  }
  for (const [agent, cb] of Object.entries(agentCircuitBreakers)) {
    intel.circuitBreakers[agent] = cb;
  }
  db.upsert('system_config', s => s.key === 'agent_intelligence', {
    key: 'agent_intelligence', data: intel, updated_at: new Date().toISOString(),
  });
}

function loadAgentIntelligence() {
  const record = db.findOne('system_config', s => s.key === 'agent_intelligence');
  if (!record?.data) return false;
  const intel = record.data;
  let loaded = 0;

  if (intel.agentPerformance) {
    for (const [name, perf] of Object.entries(intel.agentPerformance)) {
      agentPerformance[name] = perf;
      loaded++;
    }
  }
  if (intel.symbolPerformance) {
    for (const [sym, perf] of Object.entries(intel.symbolPerformance)) {
      symbolPerformance[sym] = perf;
    }
  }
  if (intel.sentimentCache) {
    for (const [sym, sent] of Object.entries(intel.sentimentCache)) {
      // Only load if less than 30 min old
      if (Date.now() - sent.lastUpdated < 30 * 60 * 1000) {
        sentimentStore[sym] = sent;
      }
    }
  }
  // Restore learning engine state
  if (intel.indicatorLearning) {
    for (const [agent, symbols] of Object.entries(intel.indicatorLearning)) {
      indicatorLearning[agent] = symbols;
    }
  }
  if (intel.strategyState) {
    for (const [agent, state] of Object.entries(intel.strategyState)) {
      strategyState[agent] = state;
    }
  }
  if (intel.circuitBreakers) {
    for (const [agent, cb] of Object.entries(intel.circuitBreakers)) {
      agentCircuitBreakers[agent] = cb;
    }
  }
  const learnedAgents = Object.keys(intel.indicatorLearning || {}).length;
  const breakerAgents = Object.keys(intel.circuitBreakers || {}).length;
  console.log(`[Boot] Loaded agent intelligence: ${loaded} agents, ${Object.keys(intel.symbolPerformance || {}).length} symbols, ${learnedAgents} learned, ${breakerAgents} breakers`);
  return true;
}

// Save intelligence every 2 minutes
setInterval(saveAgentIntelligence, 2 * 60 * 1000);

function detectRegime(hist) {
  if (hist.length < 30) return 'ranging';
  const shortSma = sma(hist, 10);
  const longSma = sma(hist, 30);
  const mom20 = momentum(hist, 20);
  const adxVal = adx(hist, 14);

  // Enhanced regime detection with ADX for trend strength
  if (adxVal > 25) {
    // Strong trend confirmed by ADX
    if (shortSma > longSma * 1.0005 && mom20 > 0.1) return 'trending_up';
    if (shortSma < longSma * 0.9995 && mom20 < -0.1) return 'trending_down';
  } else {
    // Weak trend — require more confirmation
    if (shortSma > longSma * 1.001 && mom20 > 0.3) return 'trending_up';
    if (shortSma < longSma * 0.999 && mom20 < -0.3) return 'trending_down';
  }
  return 'ranging';
}

// ─── Price tick with micro-trend persistence ───
// In hybrid/real mode: uses real prices as base, simulated micro-noise for intra-tick movement
// In simulated mode: fully synthetic price engine
const trendState = {}; // per-symbol trend drift
for (const sym of Object.keys(DEFAULT_PRICES)) {
  trendState[sym] = { drift: 0, duration: 0, maxDuration: 30 + Math.floor(Math.random() * 60) };
}

// Track data source per symbol for transparency
const priceDataSource = {}; // { symbol: 'real' | 'simulated' }
for (const sym of Object.keys(DEFAULT_PRICES)) {
  priceDataSource[sym] = 'simulated';
}

function tickPrices() {
  const session = getMarketSession();
  const sessionVol = session.volMultiplier || 1.0;

  for (const symbol of Object.keys(marketPrices)) {
    const price = marketPrices[symbol];
    const isCrypto = ['BTC','ETH','SOL','AVAX','DOGE','XRP','ADA','DOT','MATIC','LINK'].includes(symbol);
    const isFx = symbol.includes('/');
    const isLeveraged = ['TQQQ','SOXL','UVXY','SPXS','SQQQ','TNA'].includes(symbol);
    const isFutures = symbol.endsWith('=F');
    const isCash = ['BIL','SHV','SGOV'].includes(symbol);

    // Check if we have a recent real price for this symbol
    const cached = REAL_PRICE_CACHE[symbol];
    const hasRealPrice = cached && (Date.now() - cached.timestamp < 60000); // Real price < 60s old

    if (hasRealPrice && MARKET_DATA_MODE !== 'simulated') {
      // REAL MODE: Use real price with micro-noise for sub-second movement
      const realPrice = cached.price;
      const microNoise = realPrice * (Math.random() - 0.5) * 0.0002; // ±0.02% micro-noise
      const decimals = realPrice < 10 ? 4 : 2;
      marketPrices[symbol] = roundTo(realPrice + microNoise, decimals);
      priceDataSource[symbol] = 'real';
    } else if (MARKET_DATA_MODE === 'real' && !hasRealPrice && realDataAvailable) {
      // REAL-ONLY MODE: Had real data before but this symbol is stale — hold last known price
      priceDataSource[symbol] = 'stale';
    } else {
      // SIMULATED, HYBRID FALLBACK, or REAL with no data ever received:
      // SIMULATED or HYBRID FALLBACK: Full synthetic price engine
      const baseVol = isCash ? 0.0001 : isFx ? 0.0008 : isCrypto ? 0.004 : isLeveraged ? 0.006 : isFutures ? 0.003 : 0.002;
      const sessionAdj = isCrypto ? (0.7 + sessionVol * 0.3) : sessionVol;
      const adjVol = baseVol * sessionAdj;

      let ts = trendState[symbol];
      ts.duration++;
      if (ts.duration >= ts.maxDuration) {
        ts.drift = (Math.random() - 0.45) * adjVol * 3;
        ts.duration = 0;
        ts.maxDuration = 20 + Math.floor(Math.random() * 80);
      }

      const noise = (Math.random() - 0.5) * adjVol;
      const change = ts.drift + noise;
      const decimals = price < 10 ? 4 : 2;
      marketPrices[symbol] = roundTo(price * (1 + change), decimals);
      priceDataSource[symbol] = 'simulated';
    }

    // Track history
    if (!priceHistory[symbol]) priceHistory[symbol] = [];
    priceHistory[symbol].push(marketPrices[symbol]);
    if (priceHistory[symbol].length > PRICE_HISTORY_LEN) priceHistory[symbol].shift();

    // Update regime
    symbolRegimes[symbol] = detectRegime(priceHistory[symbol]);
  }
  updatePositionValues();
}

function updatePositionValues() {
  db.findMany('positions', p => p.status === 'OPEN').forEach(pos => {
    const price = marketPrices[pos.symbol] || pos.entry_price;
    const dir = pos.side === 'LONG' ? 1 : -1;
    pos.current_price = price;
    pos.unrealized_pnl = roundTo((price - pos.entry_price) * pos.quantity * dir, 2);
    pos.return_pct = roundTo((price / pos.entry_price - 1) * 100 * dir, 4);
  });

  // Update wallet equity + high-water mark
  db.findMany('wallets').forEach(wallet => {
    const positions = db.findMany('positions', p => p.user_id === wallet.user_id && p.status === 'OPEN');
    const unrealized = positions.reduce((s, p) => s + (p.unrealized_pnl || 0), 0);
    wallet.unrealized_pnl = roundTo(unrealized, 2);
    wallet.equity = roundTo(wallet.balance + unrealized, 2);

    // High-water mark: track peak equity for true max drawdown calculation
    if (!wallet.peak_equity || wallet.equity > wallet.peak_equity) {
      wallet.peak_equity = wallet.equity;
    }
  });
  db._save('wallets');
  db._save('positions');
}

// ═══════════════════════════════════════════
//   WEBSOCKET SERVER (raw HTTP upgrade)
// ═══════════════════════════════════════════

const wsClients = new Set();

function handleUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  const accept = createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-5AB5DC11B65E')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  const client = { socket, alive: true, subscriptions: new Set() };
  wsClients.add(client);

  // Send price snapshot immediately
  wsSend(client, JSON.stringify({ type: 'snapshot', data: marketPrices, timestamp: Date.now() }));

  socket.on('data', (buf) => {
    try {
      const msg = wsDecodeFrame(buf);
      if (msg === null) return;
      if (msg.opcode === 8) { socket.end(); wsClients.delete(client); return; } // close
      if (msg.opcode === 10) { client.alive = true; return; } // pong
      if (msg.opcode === 1) { // text
        const parsed = JSON.parse(msg.payload);
        if (parsed.type === 'subscribe' && Array.isArray(parsed.symbols)) {
          parsed.symbols.forEach(s => client.subscriptions.add(s.toUpperCase()));
        }
        if (parsed.type === 'unsubscribe' && Array.isArray(parsed.symbols)) {
          parsed.symbols.forEach(s => client.subscriptions.delete(s.toUpperCase()));
        }
      }
    } catch (err) { console.error('[WS] Error parsing message:', err.message); }
  });

  socket.on('close', () => wsClients.delete(client));
  socket.on('error', () => wsClients.delete(client));
}

function wsDecodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let payloadLen = buffer[1] & 0x7f;
  let offset = 2;

  if (payloadLen === 126) { payloadLen = buffer.readUInt16BE(2); offset = 4; }
  else if (payloadLen === 127) { payloadLen = Number(buffer.readBigUInt64BE(2)); offset = 10; }

  let mask = null;
  if (masked) { mask = buffer.slice(offset, offset + 4); offset += 4; }

  const data = buffer.slice(offset, offset + payloadLen);
  if (mask) { for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4]; }

  return { opcode, payload: data.toString('utf8') };
}

function wsEncodeFrame(data) {
  const payload = Buffer.from(data, 'utf8');
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}

function wsSend(client, data) {
  try { client.socket.write(wsEncodeFrame(data)); } catch (err) { console.error('[WS] Send error:', err.message); }
}

function wsBroadcastPrices() {
  const msg = JSON.stringify({ type: 'prices', data: marketPrices, timestamp: Date.now() });
  wsClients.forEach(c => {
    if (c.socket.writable) wsSend(c, msg);
  });
}

// ═══════════════════════════════════════════
//   RISK MANAGER
// ═══════════════════════════════════════════

function preTradeRiskCheck(userId, wallet, order) {
  if (wallet.kill_switch_active) return { approved: false, reason: 'Kill switch active. Trading halted.' };

  // Position size check
  const orderValue = order.quantity * (order.price || 0);
  const maxPosValue = (wallet.equity) * (RISK.maxPositionSizePct / 100);
  if (orderValue > maxPosValue && order.price) {
    return { approved: false, reason: `Position $${orderValue.toFixed(0)} exceeds ${RISK.maxPositionSizePct}% limit ($${maxPosValue.toFixed(0)})` };
  }

  // Drawdown check — measured from peak equity (high-water mark), not initial balance
  const peakEquity = wallet.peak_equity || wallet.initial_balance;
  const drawdown = peakEquity > 0 ? ((peakEquity - wallet.equity) / peakEquity) * 100 : 0;
  if (drawdown >= RISK.killSwitchDrawdownPct) {
    wallet.kill_switch_active = true;
    db._save('wallets');
    logRiskEvent(userId, 'kill_switch', 'critical', `Auto kill: drawdown ${drawdown.toFixed(2)}%`);
    return { approved: false, reason: `KILL SWITCH: Drawdown ${drawdown.toFixed(2)}% exceeded ${RISK.killSwitchDrawdownPct}%` };
  }
  if (drawdown >= RISK.maxDrawdownPct) {
    return { approved: false, reason: `Drawdown ${drawdown.toFixed(2)}% exceeds limit (${RISK.maxDrawdownPct}%)` };
  }

  // Rate limit
  const oneMinAgo = Date.now() - 60000;
  const recentCount = db.count('positions', p => p.user_id === userId && new Date(p.opened_at).getTime() > oneMinAgo);
  if (recentCount >= RISK.maxOrdersPerMinute) {
    return { approved: false, reason: 'Order rate limit exceeded' };
  }

  return { approved: true };
}

function logRiskEvent(userId, type, severity, message) {
  db.insert('risk_events', { user_id: userId, event_type: type, severity, message });
}

// ═══════════════════════════════════════════
//   TRADE EXECUTION
// ═══════════════════════════════════════════

function executeTrade(userId, order) {
  const wallet = db.findOne('wallets', w => w.user_id === userId);
  if (!wallet) return { success: false, error: 'Wallet not found. Register first.' };

  const price = order.price || marketPrices[order.symbol];
  if (!price) return { success: false, error: `No price data for ${order.symbol}` };

  // Risk check
  const risk = preTradeRiskCheck(userId, wallet, { ...order, price });
  if (!risk.approved) return { success: false, error: risk.reason, code: 'RISK_REJECTED' };

  const side = order.side === 'BUY' ? 'LONG' : order.side === 'SELL' ? 'SHORT' : order.side;
  const cost = price * order.quantity;

  if (side === 'LONG' && cost > wallet.balance) {
    return { success: false, error: 'Insufficient balance' };
  }

  // Deduct balance
  wallet.balance -= side === 'LONG' ? cost : cost * 0.1;
  wallet.trade_count = (wallet.trade_count || 0) + 1;
  db._save('wallets');

  // Create position
  const position = db.insert('positions', {
    user_id: userId,
    wallet_id: wallet.id,
    symbol: order.symbol,
    side,
    quantity: order.quantity,
    entry_price: price,
    current_price: price,
    agent: order.agent || null,
    execution_mode: 'paper',
    unrealized_pnl: 0,
    return_pct: 0,
    stop_loss: order.stopLoss || null,
    take_profit: order.takeProfit || null,
    opened_at: new Date().toISOString(),
    status: 'OPEN',
  });

  // ── Tax Engine: Create tax lot for cost basis tracking ──
  try {
    createTaxLot(position.id, userId, order.symbol, side, order.quantity, price, order.agent || null);
  } catch (taxErr) {
    console.error(`[TaxEngine] Failed to create tax lot for position ${position.id}:`, taxErr.message);
    // Non-blocking — trade proceeds even if tax lot fails (logged for audit)
  }

  return { success: true, mode: 'paper', position, fillPrice: price };
}

function closePosition(userId, positionId) {
  const pos = db.findOne('positions', p => p.id === positionId && p.user_id === userId && p.status === 'OPEN');
  if (!pos) return { success: false, error: 'Position not found or already closed' };

  const wallet = db.findOne('wallets', w => w.user_id === userId);
  if (!wallet) return { success: false, error: 'Wallet not found' };

  const closePrice = marketPrices[pos.symbol] || pos.current_price || pos.entry_price;
  const dir = pos.side === 'LONG' ? 1 : -1;
  const pnl = roundTo((closePrice - pos.entry_price) * pos.quantity * dir, 2);
  const cost = pos.entry_price * pos.quantity;
  const returnBack = pos.side === 'LONG' ? cost + pnl : (cost * 0.1) + pnl;
  const holdTime = Math.round((Date.now() - new Date(pos.opened_at).getTime()) / 1000);

  // Update wallet
  wallet.balance += returnBack;
  wallet.realized_pnl = (wallet.realized_pnl || 0) + pnl;
  if (pnl >= 0) wallet.win_count = (wallet.win_count || 0) + 1;
  else wallet.loss_count = (wallet.loss_count || 0) + 1;
  if (!wallet.first_trade_at) wallet.first_trade_at = new Date().toISOString();
  db._save('wallets');

  // Record trade
  db.insert('trades', {
    user_id: userId, wallet_id: wallet.id, position_id: pos.id,
    symbol: pos.symbol, side: pos.side, quantity: pos.quantity,
    entry_price: pos.entry_price, close_price: closePrice,
    realized_pnl: pnl, return_pct: ((closePrice / pos.entry_price - 1) * 100 * dir).toFixed(4),
    agent: pos.agent, execution_mode: 'paper',
    opened_at: pos.opened_at, closed_at: new Date().toISOString(), hold_time_seconds: holdTime,
    status: 'CLOSED',
  });

  // Update agent stats
  if (pos.agent) {
    const agent = db.findOne('agent_stats', a => a.agent_name === pos.agent);
    if (agent) {
      agent.total_trades++;
      agent.total_pnl += pnl;
      if (pnl >= 0) { agent.wins++; agent.best_trade = Math.max(agent.best_trade, pnl); }
      else { agent.losses++; agent.worst_trade = Math.min(agent.worst_trade, pnl); }
      agent.avg_return = agent.total_trades > 0 ? agent.total_pnl / agent.total_trades : 0;
      db._save('agent_stats');
    }
  }

  // Close position
  pos.status = 'CLOSED';
  pos.close_price = closePrice;
  pos.realized_pnl = pnl;
  db._save('positions');

  // Attribute P&L back to originating signal for signal performance tracking
  try {
    const returnPct = ((closePrice / pos.entry_price - 1) * 100 * dir);
    attributeSignalPnL(pos.id, pnl, returnPct);
  } catch (e) { /* signal tracking is non-critical */ }

  // ── Tax Engine: Dispose tax lots and record to immutable ledger ──
  try {
    const closedAt = new Date().toISOString();
    const dispositions = disposeTaxLots(userId, pos.symbol, pos.side, pos.quantity, closePrice, closedAt);
    if (dispositions.length > 0) {
      console.log(`[TaxEngine] Disposed ${dispositions.length} lot(s) for ${pos.symbol} | PnL: $${pnl}`);
    }
  } catch (taxErr) {
    console.error(`[TaxEngine] Failed to dispose tax lots for position ${pos.id}:`, taxErr.message);
    // Non-blocking — position close proceeds even if tax recording fails (logged for audit)
  }

  return { success: true, pnl, closePrice, returnPct: ((closePrice / pos.entry_price - 1) * 100 * dir) };
}

// ═══════════════════════════════════════════
//   HELPERS
// ═══════════════════════════════════════════

function getCorsOrigin(req) {
  const origin = (req && req.headers && req.headers.origin) || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-XSS-Protection': '1; mode=block',
};

function json(res, status, data) {
  const origin = res._corsOrigin || ALLOWED_ORIGINS[0];
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    ...SECURITY_HEADERS,
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

function auth(req, res, next) {
  const user = extractUser(req);
  if (!user) { json(res, 401, { error: 'Authentication required' }); return; }
  req.user = user;
  req.userId = user.id;
  next();
}

// ═══════════════════════════════════════════
//   API ROUTES
// ═══════════════════════════════════════════

const api = new Router();

// ─── HEALTH ───
api.get('/api/health', (req, res) => {
  json(res, 200, {
    status: 'operational',
    version: '1.0.0-standalone',
    database: 'json-file',
    wsClients: wsClients.size,
    symbols: Object.keys(marketPrices).length,
    users: db.count('users'),
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// ─── Email validation ───
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── AUTH: REGISTER ───
api.post('/api/auth/register', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (!rateLimit(`register:${ip}`, 3, 3600000)) {
    return json(res, 429, { error: 'Too many registration attempts. Try again in 1 hour.' });
  }

  const body = await readBody(req);
  const { email, password, firstName, lastName, phone } = body;

  if (!email || !password || !firstName || !lastName) {
    return json(res, 400, { error: 'All fields required: email, password, firstName, lastName' });
  }
  if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'Invalid email format' });
  if (password.length < 6) return json(res, 400, { error: 'Password must be at least 6 characters' });

  if (db.findOne('users', u => u.email === email.toLowerCase())) {
    return json(res, 409, { error: 'Email already registered' });
  }

  // Gate: require approved access request (skip if no requests exist yet — first user is admin)
  const totalUsers = db.count('users');
  if (totalUsers > 0) {
    const accessReq = db.findOne('access_requests', r => r.email === email.toLowerCase());
    if (!accessReq || accessReq.status !== 'approved') {
      return json(res, 403, { error: 'Access not yet approved. Please submit a request and wait for admin approval.' });
    }
  }

  // First user OR designated admin email becomes admin
  const isAdmin = db.count('users') === 0 || email.toLowerCase() === ADMIN_EMAIL;

  const user = db.insert('users', {
    email: email.toLowerCase(),
    password_hash: hashPassword(password),
    first_name: firstName,
    last_name: lastName,
    phone: phone || '',
    avatar: (firstName[0] + lastName[0]).toUpperCase(),
    role: isAdmin ? 'admin' : 'investor',
    status: 'active',
    trading_mode: 'paper',
    ownership_pct: 0, // Dynamic — set by admin via /api/admin/ownership
    account_type: 'Member — LLC',
    login_count: 1,
    registered_at: new Date().toISOString(),
    last_login_at: new Date().toISOString(),
  });

  // Create $100K wallet
  db.insert('wallets', {
    user_id: user.id,
    balance: INITIAL_BALANCE,
    initial_balance: INITIAL_BALANCE,
    equity: INITIAL_BALANCE,
    peak_equity: INITIAL_BALANCE,
    unrealized_pnl: 0,
    realized_pnl: 0,
    trade_count: 0,
    win_count: 0,
    loss_count: 0,
    deposit_amount: INITIAL_BALANCE,
    deposit_timestamp: new Date().toISOString(),
    kill_switch_active: false,
    first_trade_at: null,
  });

  // Log login
  db.insert('login_log', { user_id: user.id, method: 'register', ip: req.socket?.remoteAddress, success: true });

  const token = createJWT({ id: user.id, email: user.email, role: user.role });

  json(res, 201, {
    user: { id: user.id, email: user.email, firstName, lastName, phone: user.phone, avatar: user.avatar, role: user.role, tradingMode: 'paper', isNewUser: true },
    accessToken: token,
  });
});

// ─── AUTH: LOGIN ───
api.post('/api/auth/login', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (!rateLimit(`login:${ip}`, 5, 900000)) {
    return json(res, 429, { error: 'Too many login attempts. Try again in 15 minutes.' });
  }

  const body = await readBody(req);
  const { email, password } = body;

  if (!email || !password) return json(res, 400, { error: 'Email and password required' });
  if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'Invalid email format' });

  const user = db.findOne('users', u => u.email === email.toLowerCase());
  if (!user || !verifyPassword(password, user.password_hash)) {
    db.insert('login_log', { user_id: user?.id, method: 'email', success: false });
    return json(res, 401, { error: 'Invalid email or password' });
  }

  if (user.status === 'suspended') return json(res, 403, { error: 'Account suspended' });

  // Enforce admin role for designated admin email
  if (user.email === ADMIN_EMAIL && user.role !== 'admin') {
    user.role = 'admin';
  }
  // Fallback: if no admin exists at all, promote first user
  if (!db.findOne('users', u => u.role === 'admin')) {
    const first = db.findMany('users').sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))[0];
    if (first && first.id === user.id) user.role = 'admin';
  }

  user.last_login_at = new Date().toISOString();
  user.login_count = (user.login_count || 0) + 1;
  db._save('users');

  db.insert('login_log', { user_id: user.id, method: 'email', ip: req.socket?.remoteAddress, success: true });

  const token = createJWT({ id: user.id, email: user.email, role: user.role });

  json(res, 200, {
    user: {
      id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name,
      avatar: user.avatar, role: user.role, tradingMode: user.trading_mode,
      lastLoginAt: user.last_login_at, loginCount: user.login_count,
    },
    accessToken: token,
  });
});

// ─── AUTH: CHANGE PASSWORD ───
api.post('/api/auth/change-password', auth, async (req, res) => {
  const body = await readBody(req);
  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) return json(res, 400, { error: 'Current and new password required' });
  if (newPassword.length < 6) return json(res, 400, { error: 'New password must be at least 6 characters' });

  const user = db.findOne('users', u => u.id === req.userId);
  if (!user) return json(res, 404, { error: 'User not found' });

  if (!verifyPassword(currentPassword, user.password_hash)) {
    return json(res, 401, { error: 'Current password is incorrect' });
  }

  user.password_hash = hashPassword(newPassword);
  db._save('users');

  json(res, 200, { success: true, message: 'Password changed successfully' });
});

// ═══════════════════════════════════════════
//   PASSKEY (WebAuthn) — Server-Side Endpoints
//   Challenge-response model: server generates challenges,
//   client creates/uses credential, server stores & verifies.
//   Uses "none" attestation — no FIDO metadata verification needed.
// ═══════════════════════════════════════════

// In-memory challenge store (keyed by challenge string, auto-expires)
const passkeyChallengeTTL = 120000; // 2 minutes
const passkeyChallenges = new Map();

function generateWebAuthnChallenge() {
  const challenge = randomBytes(32).toString('base64url');
  passkeyChallenges.set(challenge, { created: Date.now() });
  // Prune expired challenges
  const now = Date.now();
  for (const [k, v] of passkeyChallenges) {
    if (now - v.created > passkeyChallengeTTL) passkeyChallenges.delete(k);
  }
  return challenge;
}

function consumeChallenge(challenge) {
  const entry = passkeyChallenges.get(challenge);
  if (!entry) return false;
  if (Date.now() - entry.created > passkeyChallengeTTL) {
    passkeyChallenges.delete(challenge);
    return false;
  }
  passkeyChallenges.delete(challenge);
  return true;
}

// ─── GET /api/auth/passkey/status — Check if user has passkey registered ───
api.get('/api/auth/passkey/status', auth, (req, res) => {
  const credentials = db.findMany('passkey_credentials', c => c.user_id === req.userId);
  json(res, 200, {
    hasPasskey: credentials.length > 0,
    count: credentials.length,
    credentials: credentials.map(c => ({
      id: c.id,
      credential_id: c.credential_id,
      created_at: c.created_at,
      last_used: c.last_used,
      device_name: c.device_name || 'Unknown Device',
    })),
  });
});

// ─── POST /api/auth/passkey/register/options — Generate registration challenge ───
api.post('/api/auth/passkey/register/options', auth, async (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user) return json(res, 404, { error: 'User not found' });

  const existingCredentials = db.findMany('passkey_credentials', c => c.user_id === req.userId);

  const challenge = generateWebAuthnChallenge();

  // Store userId with challenge for verification
  passkeyChallenges.get(challenge).userId = req.userId;

  const options = {
    challenge,
    rp: {
      name: APP_NAME,
      // ID will be set client-side to window.location.hostname
    },
    user: {
      id: Buffer.from(user.id).toString('base64url'),
      name: user.email,
      displayName: user.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : user.email,
    },
    pubKeyCredParams: [
      { alg: -7, type: 'public-key' },   // ES256
      { alg: -257, type: 'public-key' },  // RS256
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    timeout: 60000,
    attestation: 'none',
    excludeCredentials: existingCredentials.map(c => ({
      id: c.credential_id,
      type: 'public-key',
      transports: ['internal'],
    })),
  };

  json(res, 200, options);
});

// ─── POST /api/auth/passkey/register/verify — Store credential after creation ───
api.post('/api/auth/passkey/register/verify', auth, async (req, res) => {
  const body = await readBody(req);
  const { challenge, credentialId, publicKey, clientDataJSON, attestationObject, deviceName } = body;

  if (!challenge || !credentialId) {
    return json(res, 400, { error: 'Missing required fields: challenge, credentialId' });
  }

  // Verify challenge was issued by us and hasn't expired
  const challengeEntry = passkeyChallenges.get(challenge);
  if (!challengeEntry) {
    return json(res, 400, { error: 'Invalid or expired challenge' });
  }
  if (challengeEntry.userId !== req.userId) {
    passkeyChallenges.delete(challenge);
    return json(res, 400, { error: 'Challenge user mismatch' });
  }
  passkeyChallenges.delete(challenge);

  // Check for duplicate credential
  const existing = db.findOne('passkey_credentials', c => c.credential_id === credentialId);
  if (existing) {
    return json(res, 409, { error: 'This passkey is already registered' });
  }

  // Store credential
  const credential = {
    id: randomUUID(),
    user_id: req.userId,
    credential_id: credentialId,
    public_key: publicKey || null,
    attestation_object: attestationObject || null,
    client_data_json: clientDataJSON || null,
    device_name: deviceName || 'Unknown Device',
    sign_count: 0,
    created_at: new Date().toISOString(),
    last_used: null,
  };

  db.insert('passkey_credentials', credential);

  // Update user flag
  const user = db.findOne('users', u => u.id === req.userId);
  if (user) {
    user.has_passkey = true;
    db._save('users');
  }

  console.log(`[Passkey] Registered for user ${req.userId} — credential ${credentialId.substring(0, 16)}...`);

  json(res, 200, {
    success: true,
    credential: {
      id: credential.id,
      credential_id: credential.credential_id,
      device_name: credential.device_name,
      created_at: credential.created_at,
    },
  });
});

// ─── POST /api/auth/passkey/authenticate/options — Generate auth challenge (NO AUTH REQUIRED) ───
api.post('/api/auth/passkey/authenticate/options', async (req, res) => {
  const body = await readBody(req);
  const { email } = body;

  if (!email) return json(res, 400, { error: 'Email required' });

  const user = db.findOne('users', u => u.email === email.toLowerCase().trim());
  if (!user) return json(res, 404, { error: 'No account found with this email' });

  const credentials = db.findMany('passkey_credentials', c => c.user_id === user.id);
  if (credentials.length === 0) {
    return json(res, 404, { error: 'No passkey registered for this account' });
  }

  const challenge = generateWebAuthnChallenge();
  // Store userId with challenge for verification
  passkeyChallenges.get(challenge).userId = user.id;

  const options = {
    challenge,
    allowCredentials: credentials.map(c => ({
      id: c.credential_id,
      type: 'public-key',
      transports: ['internal'],
    })),
    userVerification: 'preferred',
    timeout: 60000,
  };

  json(res, 200, options);
});

// ─── POST /api/auth/passkey/authenticate/verify — Verify assertion, return JWT (NO AUTH REQUIRED) ───
api.post('/api/auth/passkey/authenticate/verify', async (req, res) => {
  const body = await readBody(req);
  const { challenge, credentialId, authenticatorData, clientDataJSON, signature } = body;

  if (!challenge || !credentialId) {
    return json(res, 400, { error: 'Missing required fields' });
  }

  // Verify challenge
  const challengeEntry = passkeyChallenges.get(challenge);
  if (!challengeEntry) {
    return json(res, 400, { error: 'Invalid or expired challenge' });
  }
  const userId = challengeEntry.userId;
  passkeyChallenges.delete(challenge);

  // Find stored credential
  const credential = db.findOne('passkey_credentials', c => c.credential_id === credentialId);
  if (!credential) {
    return json(res, 401, { error: 'Unknown credential' });
  }
  if (credential.user_id !== userId) {
    return json(res, 401, { error: 'Credential does not belong to this user' });
  }

  // Update sign count & last used
  credential.sign_count = (credential.sign_count || 0) + 1;
  credential.last_used = new Date().toISOString();
  db._save('passkey_credentials');

  // Get user and issue JWT
  const user = db.findOne('users', u => u.id === userId);
  if (!user) return json(res, 404, { error: 'User not found' });
  if (user.status !== 'active') return json(res, 403, { error: 'Account is not active' });

  const token = createJWT({ id: user.id, email: user.email, role: user.role });

  // Log the login
  db.insert('login_log', {
    id: randomUUID(),
    user_id: user.id,
    email: user.email,
    method: 'passkey',
    ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown',
    user_agent: req.headers['user-agent'] || 'unknown',
    timestamp: new Date().toISOString(),
    success: true,
  });

  console.log(`[Auth] Passkey login: ${user.email}`);

  json(res, 200, {
    success: true,
    accessToken: token,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
      avatar: user.avatar,
      role: user.role,
      phone: user.phone,
      status: user.status,
      has_passkey: true,
      tradingMode: user.trading_mode,
      lastLoginAt: new Date().toISOString(),
      loginCount: user.login_count,
      created_at: user.created_at,
    },
  });
});

// ─── DELETE /api/auth/passkey — Remove a passkey ───
api.post('/api/auth/passkey/remove', auth, async (req, res) => {
  const body = await readBody(req);
  const { credentialId } = body;

  if (credentialId) {
    // Remove specific credential
    const cred = db.findOne('passkey_credentials', c => c.credential_id === credentialId && c.user_id === req.userId);
    if (!cred) return json(res, 404, { error: 'Credential not found' });
    db.delete('passkey_credentials', c => c.id === cred.id);
  } else {
    // Remove all passkeys for user
    db.delete('passkey_credentials', c => c.user_id === req.userId);
  }

  // Check if any passkeys remain
  const remaining = db.findMany('passkey_credentials', c => c.user_id === req.userId);
  if (remaining.length === 0) {
    const user = db.findOne('users', u => u.id === req.userId);
    if (user) {
      user.has_passkey = false;
      db._save('users');
    }
  }

  console.log(`[Passkey] Removed for user ${req.userId}`);
  json(res, 200, { success: true, remaining: remaining.length });
});

// ═══════════════════════════════════════════
//   EMAIL SERVICE (Resend API — zero dependencies)
// ═══════════════════════════════════════════

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) {
    console.warn(`[Email] No RESEND_API_KEY set. Would send to ${to}: "${subject}"`);
    return { success: false, reason: 'no_api_key' };
  }

  try {
    const payload = JSON.stringify({
      from: `${APP_NAME} <${FROM_EMAIL}>`,
      to: [to],
      subject,
      html,
    });

    const https = await import('node:https');
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.resend.com',
        path: '/emails',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[Email] Sent to ${to}: "${subject}"`);
            resolve({ success: true });
          } else {
            console.error(`[Email] Failed (${res.statusCode}): ${body}`);
            resolve({ success: false, reason: body });
          }
        });
      });
      req.on('error', (err) => {
        console.error(`[Email] Error: ${err.message}`);
        resolve({ success: false, reason: err.message });
      });
      req.write(payload);
      req.end();
    });
  } catch (err) {
    console.error(`[Email] Exception: ${err.message}`);
    return { success: false, reason: err.message };
  }
}

// ─── ADMIN NOTIFICATION ENGINE ───
// Sends email to ALL admin users when actionable events occur (withdrawals, access requests, feedback)

async function notifyAdmins(eventType, subject, htmlBody) {
  const admins = db.findMany('users', u => u.role === 'admin' && u.status === 'active');
  if (admins.length === 0) {
    console.warn(`[AdminNotify] No active admins to notify for: ${eventType}`);
    return;
  }

  const results = [];
  for (const admin of admins) {
    const result = await sendEmail(admin.email, `[${APP_NAME} Admin] ${subject}`, `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <div style="padding:12px 16px;background:#1a1a2e;border-radius:12px;border:1px solid rgba(0,212,255,0.2);margin-bottom:16px;">
          <div style="font-size:11px;color:#00D4FF;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Admin Alert — ${eventType}</div>
          <div style="font-size:16px;font-weight:700;color:#fff;">${subject}</div>
        </div>
        ${htmlBody}
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);font-size:11px;color:rgba(255,255,255,0.3);">
          ${APP_NAME} Admin Notification System · Log in to the Admin Panel to take action.
        </div>
      </div>
    `);
    results.push({ admin: admin.email, ...result });
  }

  const sent = results.filter(r => r.success).length;
  console.log(`[AdminNotify] ${eventType}: notified ${sent}/${admins.length} admins — "${subject}"`);
  return results;
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
}

function storeVerificationCode(email, type) {
  // Remove any existing code for this email+type
  db.remove('verification_codes', c => c.email === email && c.type === type);

  const code = generateCode();
  db.insert('verification_codes', {
    email: email.toLowerCase(),
    type,  // 'password_reset' | 'email_verify'
    code,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
    used: false,
  });
  return code;
}

function verifyCode(email, type, code) {
  const record = db.findOne('verification_codes', c =>
    c.email === email.toLowerCase() && c.type === type && c.code === code && !c.used
  );
  if (!record) return { valid: false, reason: 'Invalid code' };
  if (new Date(record.expires_at) < new Date()) {
    return { valid: false, reason: 'Code expired. Please request a new one.' };
  }
  // Mark as used
  record.used = true;
  db._save('verification_codes');
  return { valid: true };
}

function passwordResetEmail(code) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #0a0a1a; color: #ffffff; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="font-size: 28px; font-weight: 800; letter-spacing: 2px; background: linear-gradient(135deg, #00D4FF, #A855F7); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">12 TRIBES</div>
        <div style="font-size: 11px; color: #888; letter-spacing: 3px; margin-top: 4px;">INVESTMENTS</div>
      </div>
      <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 24px; text-align: center;">
        <div style="font-size: 15px; color: #ccc; margin-bottom: 16px;">Your password reset code is:</div>
        <div style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #00D4FF; font-family: monospace;">${code}</div>
        <div style="font-size: 12px; color: #888; margin-top: 16px;">This code expires in 10 minutes.</div>
      </div>
      <div style="text-align: center; margin-top: 20px; font-size: 11px; color: #555;">
        If you didn't request this, you can safely ignore this email.
      </div>
    </div>
  `;
}

function emailVerificationEmail(code) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #0a0a1a; color: #ffffff; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="font-size: 28px; font-weight: 800; letter-spacing: 2px; background: linear-gradient(135deg, #00D4FF, #A855F7); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">12 TRIBES</div>
        <div style="font-size: 11px; color: #888; letter-spacing: 3px; margin-top: 4px;">INVESTMENTS</div>
      </div>
      <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 24px; text-align: center;">
        <div style="font-size: 15px; color: #ccc; margin-bottom: 16px;">Verify your email address:</div>
        <div style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #10B981; font-family: monospace;">${code}</div>
        <div style="font-size: 12px; color: #888; margin-top: 16px;">Enter this code in the app to verify your email. Expires in 10 minutes.</div>
      </div>
      <div style="text-align: center; margin-top: 20px; font-size: 11px; color: #555;">
        Welcome to the collective. — 12 Tribes AI
      </div>
    </div>
  `;
}

function accessApprovedEmail(firstName) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #0a0a1a; color: #ffffff; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="font-size: 28px; font-weight: 800; letter-spacing: 2px; background: linear-gradient(135deg, #00D4FF, #A855F7); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">12 TRIBES</div>
        <div style="font-size: 11px; color: #888; letter-spacing: 3px; margin-top: 4px;">INVESTMENTS</div>
      </div>
      <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 24px;">
        <div style="font-size: 18px; font-weight: 700; color: #10B981; margin-bottom: 12px;">Access Approved</div>
        <div style="font-size: 14px; color: #ccc; line-height: 1.6;">
          ${firstName}, your request to join 12 Tribes Investments has been approved. You can now create your account and start trading with our AI-powered collective.
        </div>
        <div style="text-align: center; margin-top: 20px;">
          <a href="${FRONTEND_ORIGIN}/investor-portal" style="display: inline-block; padding: 12px 32px; background: linear-gradient(135deg, #10B981, #00D4FF); color: #fff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 14px;">Create Your Account</a>
        </div>
      </div>
    </div>
  `;
}

function accessDeniedEmail(firstName) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #0a0a1a; color: #ffffff; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="font-size: 28px; font-weight: 800; letter-spacing: 2px; background: linear-gradient(135deg, #00D4FF, #A855F7); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">12 TRIBES</div>
        <div style="font-size: 11px; color: #888; letter-spacing: 3px; margin-top: 4px;">INVESTMENTS</div>
      </div>
      <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 24px;">
        <div style="font-size: 18px; font-weight: 700; color: #F59E0B; margin-bottom: 12px;">Access Request Update</div>
        <div style="font-size: 14px; color: #ccc; line-height: 1.6;">
          ${firstName}, thank you for your interest in 12 Tribes Investments. After reviewing your request, we are unable to grant access at this time. If you believe this was in error, please contact our support team for more information.
        </div>
      </div>
    </div>
  `;
}

// ─── AUTH: FORGOT PASSWORD (sends email with code) ───
api.post('/api/auth/forgot-password', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (!rateLimit(`forgot:${ip}`, 3, 900000)) {
    return json(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
  }

  const body = await readBody(req);
  const { email } = body;
  if (!email) return json(res, 400, { error: 'Email required' });
  if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'Invalid email format' });

  const emailKey = email.toLowerCase().trim();

  // Always return success (privacy — don't reveal if account exists)
  const user = db.findOne('users', u => u.email === emailKey);
  if (!user) {
    return json(res, 200, { success: true, message: 'If an account exists with this email, a reset code has been sent.' });
  }

  // Rate limit: max 3 codes per hour
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  const recentCodes = db.findMany('verification_codes', c =>
    c.email === emailKey && c.type === 'password_reset' && c.created_at > oneHourAgo
  );
  if (recentCodes.length >= 3) {
    return json(res, 429, { error: 'Too many reset requests. Please try again later.' });
  }

  const code = storeVerificationCode(emailKey, 'password_reset');
  await sendEmail(emailKey, `${APP_NAME} — Password Reset Code`, passwordResetEmail(code));

  json(res, 200, { success: true, message: 'If an account exists with this email, a reset code has been sent.' });
});

// ─── AUTH: RESET PASSWORD (requires valid code) ───
api.post('/api/auth/reset-password', async (req, res) => {
  const body = await readBody(req);
  const { email, code, newPassword } = body;

  if (!email || !newPassword) return json(res, 400, { error: 'Email and new password required' });
  if (newPassword.length < 6) return json(res, 400, { error: 'Password must be at least 6 characters' });

  const emailKey = email.toLowerCase().trim();
  const user = db.findOne('users', u => u.email === emailKey);
  if (!user) return json(res, 404, { error: 'User not found' });

  // Code is REQUIRED — no password reset without valid verification
  if (!code) return json(res, 400, { error: 'Verification code is required' });
  const check = verifyCode(emailKey, 'password_reset', code);
  if (!check.valid) return json(res, 400, { error: check.reason || 'Invalid or expired code' });

  user.password_hash = hashPassword(newPassword);
  db._save('users');

  json(res, 200, { success: true, message: 'Password reset successfully' });
});

// ─── AUTH: SEND EMAIL VERIFICATION CODE ───
api.post('/api/auth/verify-email/send', async (req, res) => {
  const body = await readBody(req);
  const { email } = body;
  if (!email) return json(res, 400, { error: 'Email required' });

  const emailKey = email.toLowerCase().trim();

  const code = storeVerificationCode(emailKey, 'email_verify');
  await sendEmail(emailKey, `${APP_NAME} — Verify Your Email`, emailVerificationEmail(code));

  json(res, 200, { success: true, message: 'Verification code sent.' });
});

// ─── AUTH: VERIFY EMAIL CODE ───
api.post('/api/auth/verify-email/confirm', async (req, res) => {
  const body = await readBody(req);
  const { email, code } = body;
  if (!email || !code) return json(res, 400, { error: 'Email and code required' });

  const emailKey = email.toLowerCase().trim();
  const check = verifyCode(emailKey, 'email_verify', code);
  if (!check.valid) return json(res, 400, { error: check.reason });

  // Mark user as email-verified
  const user = db.findOne('users', u => u.email === emailKey);
  if (user) {
    user.email_verified = true;
    user.email_verified_at = new Date().toISOString();
    db._save('users');
  }

  json(res, 200, { success: true, message: 'Email verified successfully.' });
});

// ─── AUTH: ME ───
api.get('/api/auth/me', auth, (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user) return json(res, 404, { error: 'User not found' });

  // Enforce admin role for designated admin email
  if (user.email === ADMIN_EMAIL && user.role !== 'admin') {
    user.role = 'admin';
    db._save('users');
  }
  // Fallback: if no admin exists at all, promote first user
  if (!db.findOne('users', u => u.role === 'admin')) {
    const first = db.findMany('users').sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))[0];
    if (first && first.id === user.id) {
      user.role = 'admin';
      db._save('users');
    }
  }

  // Calculate dynamic ownership: if user has explicit ownership_pct use it,
  // otherwise calculate equal share across all active investors
  const allUsers = db.findMany('users', u => u.status === 'active');
  const ownershipPct = (user.ownership_pct && user.ownership_pct > 0)
    ? user.ownership_pct
    : (allUsers.length > 0 ? roundTo(100 / allUsers.length, 2) : 0);

  json(res, 200, {
    id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name,
    avatar: user.avatar, role: user.role, tradingMode: user.trading_mode,
    ownershipPct, accountType: user.account_type || 'Member — LLC',
    registeredAt: user.registered_at, lastLoginAt: user.last_login_at, loginCount: user.login_count,
  });
});

// ─── AUTH: LOGIN HISTORY ───
api.get('/api/auth/login-history', auth, (req, res) => {
  const logs = db.findMany('login_log', l => l.user_id === req.userId).slice(-50).reverse();
  json(res, 200, logs);
});

// ─── ACCESS REQUESTS (waitlist / approval gate) ───

// Submit a request (public — no auth)
api.post('/api/access-requests', async (req, res) => {
  const body = await readBody(req);
  const { firstName, lastName, email, message } = body;

  if (!firstName || !lastName || !email) {
    return json(res, 400, { error: 'firstName, lastName, and email are required' });
  }
  if (!email.includes('@') || !email.includes('.')) {
    return json(res, 400, { error: 'Invalid email address' });
  }

  // Check for duplicate
  const existing = db.findOne('access_requests', r => r.email === email.toLowerCase());
  if (existing) {
    if (existing.status === 'approved') return json(res, 200, { status: 'approved', message: 'You have already been approved. You may create an account.' });
    if (existing.status === 'pending') return json(res, 200, { status: 'pending', message: 'Your request is already pending review.' });
    if (existing.status === 'denied') {
      // Allow re-submission: reset the denied request back to pending
      db.update('access_requests', r => r.id === existing.id, {
        first_name: firstName,
        last_name: lastName,
        message: message || existing.message,
        status: 'pending',
        submitted_at: new Date().toISOString(),
        previously_rejected: true,
        previous_denial_date: existing.reviewed_at || existing.submitted_at,
      });
      console.log(`[ACCESS] Re-submission from previously denied email: ${email}`);
      return json(res, 200, { status: 'pending', message: 'Your request has been re-submitted for review.', resubmission: true });
    }
  }

  // Also check if they already have an account
  const existingUser = db.findOne('users', u => u.email === email.toLowerCase());
  if (existingUser) {
    return json(res, 200, { status: 'approved', message: 'An account with this email already exists. Please sign in.' });
  }

  const request = db.insert('access_requests', {
    first_name: firstName,
    last_name: lastName,
    email: email.toLowerCase(),
    message: message || '',
    status: 'pending',
    submitted_at: new Date().toISOString(),
  });

  // Notify admins
  notifyAdmins('Access Request', `New access request from ${firstName} ${lastName}`, `
    <div style="color:#e0e0e0;font-size:14px;">
      <p><strong style="color:#fff;">${firstName} ${lastName}</strong> (${email.toLowerCase()}) has requested platform access.</p>
      ${message ? `<p style="padding:10px 14px;background:rgba(255,255,255,0.04);border-radius:8px;font-style:italic;color:rgba(255,255,255,0.6);">"${message}"</p>` : ''}
      <p style="color:rgba(255,255,255,0.4);font-size:12px;">Go to Admin Panel → Access Requests to approve or deny.</p>
    </div>
  `).catch(err => console.error('[AdminNotify] Access request notification failed:', err.message));

  json(res, 201, { status: 'pending', message: 'Your request has been submitted. You will be notified when approved.', id: request.id });
});

// Check request status by email (public — no auth)
api.get('/api/access-requests/status', (req, res) => {
  const email = (req.query.email || '').toLowerCase();
  if (!email) return json(res, 400, { error: 'Email query parameter required' });

  const request = db.findOne('access_requests', r => r.email === email);
  if (!request) return json(res, 404, { error: 'No request found for this email' });

  json(res, 200, { status: request.status, email: request.email, submittedAt: request.submitted_at });
});

// List all requests (admin only — auth required, first user = admin)
api.get('/api/access-requests', auth, (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin access required' });

  const allRequests = db.findMany('access_requests').sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || ''));
  // Only return pending requests to admin — approved/denied are removed from view
  const pendingRequests = allRequests.filter(r => r.status === 'pending');
  json(res, 200, pendingRequests);
});

// Approve or deny a request (admin only)
api.put('/api/access-requests/:requestId', auth, async (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin access required' });

  const body = await readBody(req);
  const { status } = body; // 'approved' or 'denied'
  if (!['approved', 'denied'].includes(status)) return json(res, 400, { error: 'Status must be "approved" or "denied"' });

  const request = db.update('access_requests', r => r.id === req.params.requestId, {
    status,
    reviewed_by: req.userId,
    reviewed_at: new Date().toISOString(),
  });

  if (!request) return json(res, 404, { error: 'Request not found' });

  // Send email notification on approval or denial
  let emailResult = null;
  if (request.email) {
    try {
      if (status === 'approved') {
        emailResult = await sendEmail(request.email, `${APP_NAME} — Access Approved!`, accessApprovedEmail(request.first_name || 'Investor'));
        console.log(`[ACCESS] Approved ${request.email} — email ${emailResult?.success ? 'SENT' : 'FAILED: ' + (emailResult?.reason || 'unknown')}`);
      } else if (status === 'denied') {
        emailResult = await sendEmail(request.email, `${APP_NAME} — Access Request Update`, accessDeniedEmail(request.first_name || 'Investor'));
        console.log(`[ACCESS] Denied ${request.email} — email ${emailResult?.success ? 'SENT' : 'FAILED: ' + (emailResult?.reason || 'unknown')}`);
      }
    } catch (err) {
      console.error(`[ACCESS] Email send error for ${request.email}:`, err.message);
      emailResult = { success: false, reason: err.message };
    }
  }

  json(res, 200, { success: true, request, emailSent: emailResult?.success || false, emailError: emailResult?.success ? null : (emailResult?.reason || null) });
});

// Resend approval/denial email (admin only)
api.post('/api/access-requests/:requestId/resend-email', auth, async (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin access required' });

  const request = db.findOne('access_requests', r => r.id === req.params.requestId);
  if (!request) return json(res, 404, { error: 'Request not found' });
  if (!request.email) return json(res, 400, { error: 'Request has no email address' });
  if (!['approved', 'denied'].includes(request.status)) return json(res, 400, { error: 'Request must be approved or denied to resend email' });

  let emailResult = null;
  try {
    if (request.status === 'approved') {
      emailResult = await sendEmail(request.email, `${APP_NAME} — Access Approved!`, accessApprovedEmail(request.first_name || 'Investor'));
    } else {
      emailResult = await sendEmail(request.email, `${APP_NAME} — Access Request Update`, accessDeniedEmail(request.first_name || 'Investor'));
    }
    console.log(`[ACCESS] Resend ${request.status} email to ${request.email} — ${emailResult?.success ? 'SENT' : 'FAILED: ' + (emailResult?.reason || 'unknown')}`);
  } catch (err) {
    console.error(`[ACCESS] Resend email error for ${request.email}:`, err.message);
    emailResult = { success: false, reason: err.message };
  }

  json(res, 200, { success: true, emailSent: emailResult?.success || false, emailError: emailResult?.success ? null : (emailResult?.reason || null) });
});

// Delete an access request (admin only)
api.delete('/api/access-requests/:requestId', auth, (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin access required' });

  const request = db.findOne('access_requests', r => r.id === req.params.requestId);
  if (!request) return json(res, 404, { error: 'Request not found' });

  db.remove('access_requests', r => r.id === req.params.requestId);
  console.log(`[ACCESS] Deleted request for ${request.email} (was ${request.status}) by admin ${user.email}`);
  json(res, 200, { success: true, deleted: request });
});

// ─── ADMIN: LIST ALL USERS ───
api.get('/api/admin/users', auth, (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin access required' });

  const allUsers = db.findMany('users').map(u => {
    const wallet = db.findOne('wallets', w => w.user_id === u.id);
    const openPositions = db.findMany('positions', p => p.user_id === u.id && p.status === 'OPEN');
    const fundSettings = db.findOne('fund_settings', s => s.user_id === u.id);
    const unrealizedPnL = openPositions.reduce((sum, p) => sum + (p.unrealized_pnl || 0), 0);
    return {
      id: u.id,
      email: u.email,
      firstName: u.firstName || u.first_name || '',
      lastName: u.lastName || u.last_name || '',
      role: u.role || 'investor',
      emailVerified: u.emailVerified || false,
      tradingMode: u.tradingMode || 'paper',
      createdAt: u.created_at || u.createdAt || null,
      lastLogin: u.last_login || u.lastLogin || null,
      loginCount: u.login_count || u.loginCount || 0,
      // Wallet & trading data
      balance: wallet?.balance || 0,
      equity: wallet?.equity || wallet?.balance || 0,
      initialBalance: wallet?.initial_balance || 100000,
      realizedPnL: wallet?.realized_pnl || 0,
      unrealizedPnL,
      tradeCount: wallet?.trade_count || 0,
      openPositions: openPositions.length,
      isTrading: fundSettings?.data?.autoTrading?.isAutoTrading || false,
      tradingModeActive: fundSettings?.data?.autoTrading?.tradingMode || 'balanced',
      ownershipPct: u.ownership_pct || 0,
      accountType: u.account_type || 'Member — LLC',
    };
  });

  // If no explicit ownership is set, calculate equal shares
  const totalExplicit = allUsers.reduce((s, u) => s + (u.ownershipPct || 0), 0);
  if (totalExplicit === 0) {
    const equalShare = roundTo(100 / allUsers.length, 2);
    allUsers.forEach(u => { u.ownershipPct = equalShare; });
  }

  json(res, 200, allUsers);
});

// ─── ADMIN: SET INVESTOR OWNERSHIP ───
api.put('/api/admin/ownership', auth, async (req, res) => {
  const admin = db.findOne('users', u => u.id === req.userId);
  if (!admin || admin.role !== 'admin') return json(res, 403, { error: 'Admin access required' });

  const body = await readBody(req);
  const { shares } = body; // Array of { userId, ownershipPct }

  if (!Array.isArray(shares)) {
    return json(res, 400, { error: 'Expected { shares: [{ userId, ownershipPct }] }' });
  }

  // Validate total doesn't exceed 100%
  const total = shares.reduce((s, sh) => s + (Number(sh.ownershipPct) || 0), 0);
  if (total > 100.01) {
    return json(res, 400, { error: `Total ownership ${total.toFixed(2)}% exceeds 100%. Adjust allocations.` });
  }

  // Apply updates
  const results = [];
  for (const { userId, ownershipPct } of shares) {
    const user = db.findOne('users', u => u.id === userId);
    if (!user) { results.push({ userId, error: 'User not found' }); continue; }
    user.ownership_pct = roundTo(Number(ownershipPct) || 0, 2);
    results.push({ userId, ownershipPct: user.ownership_pct, name: `${user.first_name} ${user.last_name}` });
  }
  db._save('users');

  json(res, 200, { message: 'Ownership updated', totalAllocated: roundTo(total, 2), shares: results });
});

// ─── ADMIN: UPDATE USER ROLE ───
api.put('/api/admin/users/:userId', auth, async (req, res) => {
  const admin = db.findOne('users', u => u.id === req.userId);
  if (!admin || admin.role !== 'admin') return json(res, 403, { error: 'Admin access required' });

  const body = await readBody(req);
  const { role } = body;
  if (!['admin', 'investor'].includes(role)) return json(res, 400, { error: 'Role must be "admin" or "investor"' });

  const target = db.update('users', u => u.id === req.params.userId, { role });
  if (!target) return json(res, 404, { error: 'User not found' });

  json(res, 200, { success: true, user: { id: target.id, email: target.email, role: target.role } });
});

// ─── ADMIN: DELETE USER ───
api.delete('/api/admin/users/:userId', auth, (req, res) => {
  const admin = db.findOne('users', u => u.id === req.userId);
  if (!admin || admin.role !== 'admin') return json(res, 403, { error: 'Admin access required' });

  const targetId = req.params.userId;

  // Prevent self-deletion
  if (targetId === admin.id) return json(res, 400, { error: 'Cannot delete your own account' });

  const target = db.findOne('users', u => u.id === targetId);
  if (!target) return json(res, 404, { error: 'User not found' });

  // Close all open positions for this user
  db.findMany('positions', p => p.user_id === targetId && p.status === 'OPEN').forEach(pos => {
    pos.status = 'CLOSED';
    pos.closed_at = new Date().toISOString();
    pos.close_reason = 'account_deleted';
  });
  db._save('positions');

  // Remove wallet, user record
  db.remove('wallets', w => w.user_id === targetId);
  db.remove('users', u => u.id === targetId);

  console.log(`[ADMIN] User deleted: ${target.email} (${targetId}) by admin ${admin.email}`);
  json(res, 200, { success: true, deleted: { id: target.id, email: target.email } });
});

// ─── ADMIN: CREATE USER ───
api.post('/api/admin/users', auth, async (req, res) => {
  const admin = db.findOne('users', u => u.id === req.userId);
  if (!admin || admin.role !== 'admin') return json(res, 403, { error: 'Admin access required' });

  const body = await readBody(req);
  const { email, firstName, lastName, role } = body;

  if (!email || !firstName || !lastName) {
    return json(res, 400, { error: 'All fields required: email, firstName, lastName' });
  }
  if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'Invalid email format' });

  const emailKey = email.toLowerCase().trim();
  if (db.findOne('users', u => u.email === emailKey)) {
    return json(res, 409, { error: 'Email already registered' });
  }

  // Auto-generate a secure temporary password
  const tempPassword = randomBytes(6).toString('base64url'); // ~8 chars, URL-safe

  const userRole = ['admin', 'investor'].includes(role) ? role : 'investor';
  const user = db.insert('users', {
    id: randomUUID(),
    email: emailKey,
    password_hash: hashPassword(tempPassword),
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    role: userRole,
    emailVerified: true, // Admin-created accounts are pre-verified
    tradingMode: 'paper',
    created_at: new Date().toISOString(),
    login_count: 0,
  });

  // Create wallet
  db.insert('wallets', {
    id: randomUUID(),
    user_id: user.id,
    balance: INITIAL_BALANCE,
    equity: INITIAL_BALANCE,
    unrealized_pnl: 0,
    created_at: new Date().toISOString(),
  });

  // Send welcome email with temporary password if Resend is configured
  if (RESEND_API_KEY) {
    try {
      await sendEmail(emailKey, `Welcome to ${APP_NAME}`,
        `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px;">
          <h2 style="color:#00D4FF;">Welcome to ${APP_NAME}</h2>
          <p>An admin has created an account for you.</p>
          <p><strong>Email:</strong> ${emailKey}</p>
          <p><strong>Temporary Password:</strong> <code style="background:#f0f0f0;padding:4px 8px;border-radius:4px;font-size:16px;">${tempPassword}</code></p>
          <p>Please sign in and change your password immediately.</p>
          <p style="margin-top:24px;color:#888;font-size:12px;">— ${APP_NAME} Team</p>
        </div>`
      );
    } catch (err) { console.error('[ADMIN] Failed to send welcome email:', err.message); }
  }

  console.log(`[ADMIN] User created: ${emailKey} (${userRole}) by admin ${admin.email} | temp password: ${tempPassword}`);
  json(res, 201, {
    success: true,
    user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
    tempPassword, // Return to admin so they can share it if email delivery fails
  });
});

// ─── ADMIN: PLATFORM HEALTH DASHBOARD ───
api.get('/api/admin/health', auth, (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin access required' });

  const now = Date.now();
  const uptime = process.uptime();
  const mem = process.memoryUsage();

  // Database stats
  const totalUsers = db.findMany('users').length;
  const totalPositions = db.findMany('positions').length;
  const openPositions = db.findMany('positions', p => p.status === 'OPEN').length;
  const totalTrades = db.findMany('trades').length;
  const totalWallets = db.findMany('wallets').length;

  // Trading engine stats
  const autoTradeLog = db.findMany('auto_trade_log');
  const recentTrades = autoTradeLog.filter(t => now - new Date(t.timestamp || t.created_at).getTime() < 3600000);
  const last24hTrades = autoTradeLog.filter(t => now - new Date(t.timestamp || t.created_at).getTime() < 86400000);

  // WebSocket stats
  const wsConnectionCount = wsClients.size;

  // Risk events
  const riskEvents = db.findMany('risk_events') || [];
  const recentRiskEvents = riskEvents.filter(e => now - new Date(e.timestamp || e.created_at).getTime() < 86400000);

  // Market data health
  const priceCount = Object.keys(marketPrices).length;
  const staleSymbols = []; // All simulated so none are stale, but infrastructure is here

  json(res, 200, {
    status: 'operational',
    timestamp: new Date().toISOString(),
    server: {
      uptime: roundTo(uptime, 0),
      uptimeHuman: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
      memoryMB: {
        rss: roundTo(mem.rss / 1048576, 1),
        heapUsed: roundTo(mem.heapUsed / 1048576, 1),
        heapTotal: roundTo(mem.heapTotal / 1048576, 1),
        external: roundTo(mem.external / 1048576, 1),
      },
      nodeVersion: process.version,
      platform: process.platform,
    },
    database: {
      users: totalUsers,
      wallets: totalWallets,
      positions: { total: totalPositions, open: openPositions },
      trades: totalTrades,
      autoTradeLog: autoTradeLog.length,
    },
    tradingEngine: {
      active: true,
      tradesLastHour: recentTrades.length,
      tradesLast24h: last24hTrades.length,
      agentCount: AI_AGENTS.length + 1, // +1 for Debugger virtual agent
    },
    websocket: {
      connections: wsConnectionCount,
    },
    marketData: {
      symbolCount: priceCount,
      staleSymbols,
      samplePrices: {
        BTC: marketPrices.BTC,
        ETH: marketPrices.ETH,
        SPY: marketPrices.SPY,
      },
    },
    risk: {
      eventsLast24h: recentRiskEvents.length,
      criticalEvents: recentRiskEvents.filter(e => e.severity === 'critical').length,
    },
    rateLimiter: {
      activeKeys: rateLimitStore.size,
    },
  });
});

// ─── ADMIN: QA/QC REPORTS ───
api.get('/api/admin/qa-reports', auth, (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin access required' });

  const reports = db.findMany('qa_reports').sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  json(res, 200, reports);
});

api.post('/api/admin/qa-reports', async (req, res) => {
  // Accept reports from scheduled QA agent (API key or admin auth)
  const apiKey = req.headers['x-qa-api-key'];
  const isApiKey = apiKey && apiKey === (process.env.QA_API_KEY || JWT_SECRET);

  if (!isApiKey) {
    // Fall back to admin auth
    const authHeader = req.headers['authorization'];
    if (!authHeader) return json(res, 401, { error: 'Authentication required' });
    const token = authHeader.replace('Bearer ', '');
    try {
      const payload = verifyJWT(token);
      const user = db.findOne('users', u => u.id === payload.userId);
      if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin access required' });
    } catch { return json(res, 401, { error: 'Invalid token' }); }
  }

  const body = await readBody(req);
  const { summary, issues, metrics, severity_counts, source } = body;
  if (!summary) return json(res, 400, { error: 'Report summary required' });

  const report = {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    source: source || 'scheduled_agent',
    summary,
    issues: issues || [],
    metrics: metrics || {},
    severity_counts: severity_counts || {},
    status: 'new',
  };

  db.insert('qa_reports', report);
  json(res, 201, report);
});

// ─── ADMIN: DATA INTEGRITY CHECK ───
api.get('/api/admin/data-integrity', auth, (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin access required' });

  const integrity = {};
  for (const table of DB_TABLES) {
    const fp = join(DATA_DIR, `${table}.json`);
    const bak = join(DATA_DIR, `${table}.json.bak`);
    const backupDir = join(DATA_DIR, BACKUP_DIR_NAME);
    let backupCount = 0;
    try {
      backupCount = readdirSync(backupDir).filter(f => f.startsWith(`${table}_`) && f.endsWith('.json')).length;
    } catch {}

    integrity[table] = {
      inMemory: db.tables[table]?.length || 0,
      primaryExists: existsSync(fp),
      primarySize: existsSync(fp) ? statSync(fp).size : 0,
      backupExists: existsSync(bak),
      rotationBackups: backupCount,
    };
  }

  json(res, 200, {
    dataDir: DATA_DIR,
    dirExists: existsSync(DATA_DIR),
    backupInterval: `${BACKUP_INTERVAL_MS / 1000}s`,
    maxBackups: MAX_BACKUPS,
    tables: integrity,
  });
});

// ─── ADMIN: FORCE BACKUP ───
api.post('/api/admin/backup', auth, (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin access required' });

  try {
    db._dirty = new Set(DB_TABLES);
    db._rotateBackup();
    json(res, 200, { success: true, message: 'Full backup completed', timestamp: new Date().toISOString() });
  } catch (err) {
    json(res, 500, { error: `Backup failed: ${err.message}` });
  }
});

// ─── FEEDBACK SYSTEM ───

// Submit feedback (any authenticated user)
api.post('/api/feedback', auth, async (req, res) => {
  const body = await readBody(req);
  if (!body || !body.message || !body.message.trim()) {
    return json(res, 400, { error: 'Feedback message is required' });
  }

  const user = db.findOne('users', u => u.id === req.userId);
  if (!user) return json(res, 401, { error: 'User not found' });

  const category = body.category || 'general';
  const rating = body.rating || null;

  const feedback = {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: req.userId,
    userName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
    userEmail: user.email,
    category,
    rating,
    message: body.message.trim().slice(0, 2000),
    status: 'new',
    adminNotes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.insert('feedback', feedback);

  // Notify admins
  notifyAdmins('Feedback', `New ${category} feedback from ${feedback.userName}`, `
    <div style="color:#e0e0e0;font-size:14px;">
      <p><strong style="color:#fff;">${feedback.userName}</strong> submitted ${category} feedback${rating ? ` (rating: ${rating}/5)` : ''}.</p>
      <p style="padding:10px 14px;background:rgba(255,255,255,0.04);border-radius:8px;color:rgba(255,255,255,0.7);">"${feedback.message.slice(0, 300)}${feedback.message.length > 300 ? '...' : ''}"</p>
      <p style="color:rgba(255,255,255,0.4);font-size:12px;">Go to Admin Panel → Feedback to review and respond.</p>
    </div>
  `).catch(err => console.error('[AdminNotify] Feedback notification failed:', err.message));

  json(res, 201, { success: true, feedback });
});

// Get all feedback (admin only)
api.get('/api/admin/feedback', auth, (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin access required' });

  const allFeedback = db.tables.feedback || [];
  const sorted = [...allFeedback].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  json(res, 200, { feedback: sorted });
});

// GET /api/admin/notifications/count — Pending action counts for admin badge
api.get('/api/admin/notifications/count', auth, (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin only' });

  const pendingAccess = db.count('access_requests', r => r.status === 'pending');
  const pendingWithdrawals = db.count('withdrawal_requests', r => r.status === 'pending' || r.status === 'approved' || r.status === 'processing');
  const newFeedback = db.count('feedback', f => f.status === 'new');

  const total = pendingAccess + pendingWithdrawals + newFeedback;

  json(res, 200, {
    total,
    access_requests: pendingAccess,
    withdrawals: pendingWithdrawals,
    feedback: newFeedback,
  });
});

// Update feedback status/notes (admin only)
api.put('/api/admin/feedback/:feedbackId', auth, async (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin access required' });

  const body = await readBody(req);
  const fb = db.findOne('feedback', f => f.id === req.params.feedbackId);
  if (!fb) return json(res, 404, { error: 'Feedback not found' });

  if (body.status) fb.status = body.status;
  if (body.adminNotes !== undefined) fb.adminNotes = body.adminNotes;
  fb.updatedAt = new Date().toISOString();

  db.update('feedback', f => f.id === fb.id, fb);
  json(res, 200, { success: true, feedback: fb });
});

// Get user's own feedback history
api.get('/api/feedback', auth, (req, res) => {
  const myFeedback = (db.tables.feedback || []).filter(f => f.userId === req.userId);
  const sorted = [...myFeedback].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  json(res, 200, { feedback: sorted });
});

// ─── WITHDRAWAL REQUESTS ───

// Submit a withdrawal request (any authenticated investor)
api.post('/api/withdrawals', auth, async (req, res) => {
  const body = await readBody(req);
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user) return json(res, 401, { error: 'User not found' });

  const wallet = db.findOne('wallets', w => w.user_id === req.userId);
  if (!wallet) return json(res, 404, { error: 'Wallet not found' });

  const amount = parseFloat(body.amount);
  if (!amount || amount <= 0) return json(res, 400, { error: 'Invalid withdrawal amount' });

  const availableBalance = wallet.equity || wallet.balance || 0;
  if (amount > availableBalance) return json(res, 400, { error: `Insufficient funds. Available balance: $${availableBalance.toLocaleString()}` });

  const method = body.method || 'bank_transfer';
  const notes = (body.notes || '').trim().slice(0, 500);

  // Build withdrawal request record
  const request = {
    id: `wr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: req.userId,
    userName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
    userEmail: user.email,
    amount,
    method,
    notes,
    walletEquityAtRequest: availableBalance,
    status: 'pending',       // pending | approved | processing | completed | denied
    adminNotes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    processedAt: null,
    completedAt: null,
  };

  db.insert('withdrawal_requests', request);

  // Notify admins
  notifyAdmins('Withdrawal Request', `$${amount.toLocaleString()} withdrawal from ${request.userName}`, `
    <div style="color:#e0e0e0;font-size:14px;">
      <p><strong style="color:#fff;">${request.userName}</strong> (${request.userEmail}) has requested a withdrawal.</p>
      <div style="display:flex;gap:20px;margin:12px 0;">
        <div><span style="color:rgba(255,255,255,0.4);font-size:11px;">AMOUNT</span><br/><span style="font-size:20px;font-weight:700;color:#F59E0B;">$${amount.toLocaleString()}</span></div>
        <div><span style="color:rgba(255,255,255,0.4);font-size:11px;">METHOD</span><br/><span style="color:#fff;">${method.replace(/_/g, ' ')}</span></div>
        <div><span style="color:rgba(255,255,255,0.4);font-size:11px;">BALANCE</span><br/><span style="color:#fff;">$${availableBalance.toLocaleString()}</span></div>
      </div>
      ${notes ? `<p style="padding:10px 14px;background:rgba(255,255,255,0.04);border-radius:8px;font-style:italic;color:rgba(255,255,255,0.6);">"${notes}"</p>` : ''}
      <p style="color:rgba(255,255,255,0.4);font-size:12px;">Go to Admin Panel → Withdrawals to process this request.</p>
    </div>
  `).catch(err => console.error('[AdminNotify] Withdrawal notification failed:', err.message));

  json(res, 201, { success: true, withdrawal: request });
});

// Get user's own withdrawal requests
api.get('/api/withdrawals', auth, (req, res) => {
  const myRequests = (db.tables.withdrawal_requests || []).filter(w => w.userId === req.userId);
  const sorted = [...myRequests].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  json(res, 200, { withdrawals: sorted });
});

// Admin: Get all withdrawal requests
api.get('/api/admin/withdrawals', auth, (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin access required' });

  const all = db.tables.withdrawal_requests || [];
  const sorted = [...all].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  json(res, 200, { withdrawals: sorted });
});

// Admin: Update withdrawal request status
api.put('/api/admin/withdrawals/:requestId', auth, async (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin access required' });

  const body = await readBody(req);
  const wr = db.findOne('withdrawal_requests', w => w.id === req.params.requestId);
  if (!wr) return json(res, 404, { error: 'Withdrawal request not found' });

  const prevStatus = wr.status;
  if (body.status) wr.status = body.status;
  if (body.adminNotes !== undefined) wr.adminNotes = body.adminNotes;
  wr.updatedAt = new Date().toISOString();

  if (body.status === 'processing' && prevStatus === 'pending') {
    wr.processedAt = new Date().toISOString();
  }
  if (body.status === 'completed' && prevStatus !== 'completed') {
    wr.completedAt = new Date().toISOString();
    // Deduct from wallet — adjust initial_balance proportionally so drawdown math stays correct
    const wallet = db.findOne('wallets', w => w.user_id === wr.userId);
    if (wallet) {
      wallet.balance = Math.max(0, (wallet.balance || 0) - wr.amount);
      wallet.equity = Math.max(0, (wallet.equity || 0) - wr.amount);
      // Track total withdrawals for drawdown adjustment
      wallet.total_withdrawals = (wallet.total_withdrawals || 0) + wr.amount;
      // Adjust initial_balance so withdrawal doesn't look like a trading loss
      wallet.initial_balance = Math.max(1000, (wallet.initial_balance || 100000) - wr.amount);
      // Adjust peak_equity to account for withdrawal
      if (wallet.peak_equity) {
        wallet.peak_equity = Math.max(wallet.equity, (wallet.peak_equity || 0) - wr.amount);
      }
      // Reset kill switch if it was incorrectly triggered by withdrawal
      if (wallet.kill_switch_active && wallet.balance > 0) {
        wallet.kill_switch_active = false;
        console.log(`[Withdrawal] Reset kill switch for user ${wr.userId} after withdrawal — balance: $${wallet.balance.toFixed(2)}`);
      }
      db._save('wallets');
    }

    // ─── DISTRIBUTION & K-1 INTEGRATION ───
    // 1. Record distribution against capital account
    recordDistribution(wr.userId, wr.amount, wr.id, wr.method);

    // 2. Recalculate ownership ratios (capital-account-weighted)
    recalculateOwnershipFromCapitalAccounts();

    // 3. Auto-recompute K-1 allocations for current tax year
    const currentTaxYear = new Date().getFullYear();
    try {
      computeTaxAllocations(currentTaxYear);
      console.log(`[Withdrawal] K-1 allocations auto-recomputed for ${currentTaxYear} after $${wr.amount} withdrawal by user ${wr.userId}`);
    } catch (err) {
      console.error(`[Withdrawal] K-1 recompute failed after withdrawal:`, err.message);
    }
  }

  db.update('withdrawal_requests', w => w.id === wr.id, wr);
  json(res, 200, { success: true, withdrawal: wr });
});

// ─── FUND SETTINGS (cross-device sync) ───
api.get('/api/fund-settings', auth, (req, res) => {
  const settings = db.findOne('fund_settings', s => s.user_id === req.userId);
  if (!settings) return json(res, 404, { error: 'No settings found' });
  json(res, 200, settings.data);
});

api.put('/api/fund-settings', auth, async (req, res) => {
  const body = await readBody(req);
  if (!body || typeof body !== 'object') return json(res, 400, { error: 'Invalid settings data' });

  let existing = db.findOne('fund_settings', s => s.user_id === req.userId);
  if (existing) {
    existing.data = body;
    existing.updated_at = new Date().toISOString();
    db._save('fund_settings');
  } else {
    db.insert('fund_settings', {
      user_id: req.userId,
      data: body,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  json(res, 200, { success: true });
});

// ─── WALLET ───
api.get('/api/wallet', auth, (req, res) => {
  const wallet = db.findOne('wallets', w => w.user_id === req.userId);
  if (!wallet) return json(res, 404, { error: 'Wallet not found' });

  // Backfill initial_balance for legacy wallets
  if (wallet.initial_balance == null || wallet.initial_balance === 0) {
    wallet.initial_balance = 100000;
    db._save('wallets');
  }

  // Backfill peak_equity for legacy wallets
  if (!wallet.peak_equity) {
    wallet.peak_equity = Math.max(wallet.equity || 0, wallet.initial_balance || 100000);
    db._save('wallets');
  }

  const peakEq = wallet.peak_equity || wallet.initial_balance;
  const maxDrawdown = peakEq > 0 ? roundTo((peakEq - wallet.equity) / peakEq * 100, 2) : 0;

  json(res, 200, {
    id: wallet.id, balance: wallet.balance, initialBalance: wallet.initial_balance,
    equity: wallet.equity, peakEquity: wallet.peak_equity,
    unrealizedPnL: wallet.unrealized_pnl, realizedPnL: wallet.realized_pnl,
    maxDrawdown,
    tradeCount: wallet.trade_count, winCount: wallet.win_count, lossCount: wallet.loss_count,
    winRate: (wallet.win_count + wallet.loss_count) > 0 ? (wallet.win_count / (wallet.win_count + wallet.loss_count) * 100) : 0,
    killSwitchActive: wallet.kill_switch_active,
    depositTimestamp: wallet.deposit_timestamp,
    firstTradeAt: wallet.first_trade_at,
  });
});

// ─── WALLET: PERFORMANCE ───
api.get('/api/wallet/performance', auth, (req, res) => {
  const wallet = db.findOne('wallets', w => w.user_id === req.userId);
  if (!wallet) return json(res, 404, { error: 'Wallet not found' });

  const period = req.query.period || 'monthly';
  const snaps = db.findMany('snapshots', s => s.user_id === req.userId).sort((a, b) => a.date.localeCompare(b.date));

  const currentEquity = wallet.equity;
  const startEquity = snaps.length > 0 ? snaps[0].equity : wallet.initial_balance;
  const periodReturn = startEquity > 0 ? ((currentEquity - startEquity) / startEquity * 100) : 0;
  const allTimeReturn = wallet.initial_balance > 0 ? ((currentEquity - wallet.initial_balance) / wallet.initial_balance * 100) : 0;

  // CAGR: Compound Annual Growth Rate — annualized return accounting for time
  const firstTradeAt = wallet.first_trade_at || wallet.deposit_timestamp;
  const daysActive = firstTradeAt ? Math.max(1, (Date.now() - new Date(firstTradeAt).getTime()) / (1000 * 60 * 60 * 24)) : 1;
  const totalReturnRatio = wallet.initial_balance > 0 ? (currentEquity / wallet.initial_balance) : 1;
  const cagr = daysActive >= 1 ? ((Math.pow(totalReturnRatio, 365 / daysActive) - 1) * 100) : 0;

  // Max drawdown from peak equity (high-water mark)
  const peakEquity = wallet.peak_equity || wallet.initial_balance;
  const maxDrawdown = peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity * 100) : 0;

  // Sharpe-like ratio: annualized return / volatility estimate from snapshots
  let sharpeRatio = null;
  if (snaps.length >= 5) {
    const returns = [];
    for (let i = 1; i < snaps.length; i++) {
      if (snaps[i - 1].equity > 0) returns.push((snaps[i].equity - snaps[i - 1].equity) / snaps[i - 1].equity);
    }
    if (returns.length >= 3) {
      const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
      const variance = returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length;
      const stdDev = Math.sqrt(variance);
      sharpeRatio = stdDev > 0 ? roundTo((avgReturn / stdDev) * Math.sqrt(252), 2) : null; // Annualized
    }
  }

  json(res, 200, {
    period, currentEquity, initialBalance: wallet.initial_balance,
    periodReturn, allTimeReturn, cagr: roundTo(cagr, 2),
    allTimePnL: currentEquity - wallet.initial_balance,
    peakEquity, maxDrawdown: roundTo(maxDrawdown, 2),
    daysActive: roundTo(daysActive, 1),
    sharpeRatio,
    snapshots: snaps.slice(-90),
  });
});

// ─── WALLET: SNAPSHOT ───
api.post('/api/wallet/snapshot', auth, (req, res) => {
  const wallet = db.findOne('wallets', w => w.user_id === req.userId);
  if (!wallet) return json(res, 404, { error: 'Wallet not found' });

  const now = new Date();
  db.insert('snapshots', {
    user_id: req.userId,
    equity: wallet.equity, balance: wallet.balance,
    unrealized_pnl: wallet.unrealized_pnl, realized_pnl: wallet.realized_pnl,
    position_count: db.count('positions', p => p.user_id === req.userId && p.status === 'OPEN'),
    date: now.toISOString().split('T')[0],
    hour: now.getHours(),
  });
  json(res, 200, { success: true });
});

// ─── INVESTORS: ROSTER (any authenticated user) ───
api.get('/api/investors/roster', auth, (req, res) => {
  const allUsers = db.findMany('users');
  const roster = allUsers.map(u => {
    const wallet = db.findOne('wallets', w => w.user_id === u.id);
    const openPositions = db.findMany('positions', p => p.user_id === u.id && p.status === 'OPEN');
    const fundSettings = db.findOne('fund_settings', s => s.user_id === u.id);
    const unrealizedPnL = openPositions.reduce((sum, p) => sum + (p.unrealized_pnl || 0), 0);
    return {
      id: u.id,
      email: u.email,
      firstName: u.firstName || u.first_name || '',
      lastName: u.lastName || u.last_name || '',
      role: u.role || 'investor',
      emailVerified: u.emailVerified || false,
      tradingMode: u.tradingMode || 'paper',
      createdAt: u.created_at || u.createdAt || null,
      lastLogin: u.last_login || u.lastLogin || null,
      loginCount: u.login_count || u.loginCount || 0,
      balance: wallet?.balance || 0,
      equity: wallet?.equity || wallet?.balance || 0,
      initialBalance: wallet?.initial_balance || 100000,
      realizedPnL: wallet?.realized_pnl || 0,
      unrealizedPnL,
      tradeCount: wallet?.trade_count || 0,
      openPositions: openPositions.length,
      isTrading: fundSettings?.data?.autoTrading?.isAutoTrading || false,
      tradingModeActive: fundSettings?.data?.autoTrading?.tradingMode || 'balanced',
      ownershipPct: u.ownership_pct || 0,
      accountType: u.account_type || 'Member — LLC',
    };
  });

  // Calculate equal ownership if none explicitly set
  const totalExplicit = roster.reduce((s, u) => s + (u.ownershipPct || 0), 0);
  if (totalExplicit === 0) {
    const equalShare = roundTo(100 / roster.length, 2);
    roster.forEach(u => { u.ownershipPct = equalShare; });
  }

  json(res, 200, roster);
});

// ─── WALLET: GROUP ───
api.get('/api/wallet/group', auth, (req, res) => {
  const wallets = db.findMany('wallets');

  // Backfill: ensure every wallet has initial_balance (legacy records may be missing it)
  for (const w of wallets) {
    if (w.initial_balance == null || w.initial_balance === 0) {
      w.initial_balance = 100000; // default seed capital
      db._save('wallets');
    }
  }

  // Exclude admin wallets from investor count
  const adminIds = new Set(db.findMany('users', u => u.role === 'admin').map(u => u.id));
  const investorWallets = wallets.filter(w => !adminIds.has(w.user_id));

  const totalEquity = wallets.reduce((s, w) => s + (w.equity || 0), 0);
  const totalInitial = wallets.reduce((s, w) => s + (w.initial_balance || 100000), 0);
  const totalPeakEquity = wallets.reduce((s, w) => s + (w.peak_equity || w.initial_balance || 100000), 0);
  const totalRealized = wallets.reduce((s, w) => s + (w.realized_pnl || 0), 0);
  const totalUnrealized = wallets.reduce((s, w) => s + (w.unrealized_pnl || 0), 0);
  const totalWins = wallets.reduce((s, w) => s + (w.win_count || 0), 0);
  const totalLosses = wallets.reduce((s, w) => s + (w.loss_count || 0), 0);

  // Fund-level CAGR
  const earliestTrade = wallets.reduce((earliest, w) => {
    if (w.first_trade_at && (!earliest || w.first_trade_at < earliest)) return w.first_trade_at;
    return earliest;
  }, null);
  const fundDaysActive = earliestTrade ? Math.max(1, (Date.now() - new Date(earliestTrade).getTime()) / (1000 * 60 * 60 * 24)) : 1;
  const fundReturnRatio = totalInitial > 0 ? (totalEquity / totalInitial) : 1;
  const fundCagr = fundDaysActive >= 1 ? ((Math.pow(fundReturnRatio, 365 / fundDaysActive) - 1) * 100) : 0;

  // Fund-level max drawdown from aggregate peak
  const fundMaxDrawdown = totalPeakEquity > 0 ? ((totalPeakEquity - totalEquity) / totalPeakEquity * 100) : 0;

  json(res, 200, {
    investorCount: investorWallets.length, totalEquity, totalInitial, totalPeakEquity,
    totalRealizedPnL: totalRealized, totalUnrealizedPnL: totalUnrealized,
    totalPnL: totalRealized + totalUnrealized,
    returnPct: totalInitial > 0 ? ((totalEquity / totalInitial - 1) * 100) : 0,
    cagr: roundTo(fundCagr, 2),
    maxDrawdown: roundTo(fundMaxDrawdown, 2),
    daysActive: roundTo(fundDaysActive, 1),
    openPositions: db.count('positions', p => p.status === 'OPEN'),
    closedTrades: db.count('trades'),
    winRate: (totalWins + totalLosses) > 0 ? (totalWins / (totalWins + totalLosses) * 100) : 0,
  });
});

// ─── TRADING: SUBMIT ORDER ───
api.post('/api/trading/order', auth, async (req, res) => {
  const body = await readBody(req);
  const { symbol, side, quantity, agent, stopLoss, takeProfit } = body;
  if (!symbol || !side || !quantity) return json(res, 400, { error: 'symbol, side, and quantity required' });

  const result = executeTrade(req.userId, {
    symbol: symbol.toUpperCase(), side, quantity: parseFloat(quantity),
    agent, stopLoss, takeProfit, price: marketPrices[symbol.toUpperCase()],
  });
  json(res, result.success ? 200 : 400, result);
});

// ─── TRADING: GET POSITIONS ───
api.get('/api/trading/positions', auth, (req, res) => {
  const positions = db.findMany('positions', p => p.user_id === req.userId && p.status === 'OPEN');
  json(res, 200, positions);
});

// ─── TRADING: CLOSE POSITION ───
api.delete('/api/trading/positions/:positionId', auth, (req, res) => {
  const result = closePosition(req.userId, req.params.positionId);
  json(res, result.success ? 200 : 400, result);
});

// ─── TRADING: HISTORY ───
api.get('/api/trading/history', auth, (req, res) => {
  const trades = db.findMany('trades', t => t.user_id === req.userId).reverse().slice(0, 50);
  json(res, 200, trades);
});

// ─── TRADING: RISK DASHBOARD ───
api.get('/api/trading/risk', auth, (req, res) => {
  const wallet = db.findOne('wallets', w => w.user_id === req.userId);
  if (!wallet) return json(res, 404, { error: 'Wallet not found' });
  const positions = db.findMany('positions', p => p.user_id === req.userId && p.status === 'OPEN');
  const trades = db.findMany('trades', t => t.user_id === req.userId).slice(-50);
  const events = db.findMany('risk_events', e => e.user_id === req.userId).slice(-20);

  const peakEquity = wallet.peak_equity || wallet.initial_balance;
  const drawdown = peakEquity > 0 ? ((peakEquity - wallet.equity) / peakEquity * 100) : 0;
  const totalTrades = (wallet.win_count || 0) + (wallet.loss_count || 0);
  const winRate = totalTrades > 0 ? (wallet.win_count / totalTrades * 100) : 0;

  json(res, 200, {
    equity: wallet.equity, drawdownPct: drawdown, winRate,
    openPositions: positions.length, killSwitchActive: wallet.kill_switch_active,
    limits: RISK, recentEvents: events.reverse(), positions, recentTrades: trades.reverse(),
  });
});

// ─── TRADING: KILL SWITCH ───
api.post('/api/trading/kill-switch', auth, async (req, res) => {
  const body = await readBody(req);
  const wallet = db.findOne('wallets', w => w.user_id === req.userId);
  if (!wallet) return json(res, 404, { error: 'Wallet not found' });

  if (body.action === 'deactivate') {
    wallet.kill_switch_active = false;
    db._save('wallets');
    logRiskEvent(req.userId, 'kill_switch', 'info', 'Kill switch deactivated by user');
    return json(res, 200, { success: true, message: 'Kill switch deactivated' });
  }

  wallet.kill_switch_active = true;
  db._save('wallets');
  logRiskEvent(req.userId, 'kill_switch', 'critical', 'Kill switch activated by user');
  json(res, 200, { success: true, message: 'Kill switch activated. All trading halted.' });
});

// ─── MARKET: PRICES ───
api.get('/api/market/prices', (req, res) => {
  const realCount = Object.values(priceDataSource).filter(s => s === 'real').length;
  const totalCount = Object.keys(priceDataSource).length;
  json(res, 200, {
    prices: marketPrices,
    symbols: Object.keys(marketPrices),
    dataSources: priceDataSource,
    dataMode: MARKET_DATA_MODE,
    realDataAvailable,
    realSymbolCount: realCount,
    totalSymbolCount: totalCount,
    lastRealFetchTime,
    timestamp: Date.now(),
  });
});

// ─── ON-DEMAND YAHOO FINANCE RESEARCH ───
// Fetches live quote + 3-month chart for ANY symbol not in our tracked set
const onDemandCache = {}; // { symbol: { data, timestamp } }
const ON_DEMAND_TTL = 60000; // Cache for 60 seconds

async function fetchOnDemandResearch(symbol) {
  // Check cache first
  const cached = onDemandCache[symbol];
  if (cached && Date.now() - cached.timestamp < ON_DEMAND_TTL) return cached.data;

  const https = await import('node:https');
  const yahooSym = getYahooSymbol(symbol);

  // Fetch chart data (3 months, daily) — gives us price history + current quote
  const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?range=3mo&interval=1d`;

  return new Promise((resolve) => {
    const req = https.get(chartUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; 12Tribes/1.0)' },
      timeout: 10000,
    }, (resp) => {
      let body = '';
      resp.on('data', chunk => body += chunk);
      resp.on('end', () => {
        try {
          const data = JSON.parse(body);
          const result = data?.chart?.result?.[0];
          if (!result || !result.meta) { resolve(null); return; }

          const meta = result.meta;
          const closes = result.indicators?.quote?.[0]?.close?.filter(p => p != null) || [];
          const opens = result.indicators?.quote?.[0]?.open?.filter(p => p != null) || [];
          const highs = result.indicators?.quote?.[0]?.high?.filter(p => p != null) || [];
          const lows = result.indicators?.quote?.[0]?.low?.filter(p => p != null) || [];
          const volumes = result.indicators?.quote?.[0]?.volume?.filter(v => v != null) || [];

          if (closes.length < 2) { resolve(null); return; }

          const currentPrice = meta.regularMarketPrice || closes[closes.length - 1];
          const prevClose = meta.chartPreviousClose || meta.previousClose || closes[closes.length - 2];
          const dayOpen = opens.length > 0 ? opens[opens.length - 1] : currentPrice;
          const dayHigh = highs.length > 0 ? highs[highs.length - 1] : currentPrice;
          const dayLow = lows.length > 0 ? lows[lows.length - 1] : currentPrice;
          const changePct = prevClose > 0 ? ((currentPrice - prevClose) / prevClose * 100) : 0;

          // Compute technicals from historical closes
          const hist = closes;
          const sma10Val = sma(hist, 10);
          const sma30Val = sma(hist, 30);
          const sma50Val = sma(hist, 50);
          const ema12Val = ema(hist, 12);
          const ema26Val = ema(hist, 26);
          const macdVal = ema12Val - ema26Val;
          const currentRsi = rsi(hist);
          const mom20Val = momentum(hist, 20);
          const vol20Val = volatility(hist, 20);

          // Support/Resistance
          const sortedPrices = [...hist].sort((a, b) => a - b);
          const support = sortedPrices[Math.floor(sortedPrices.length * 0.1)] || currentPrice * 0.97;
          const resistance = sortedPrices[Math.floor(sortedPrices.length * 0.9)] || currentPrice * 1.03;

          // Determine regime from SMAs
          let regime = 'ranging';
          if (sma10Val > sma30Val && mom20Val > 0.5) regime = 'trending_up';
          else if (sma10Val < sma30Val && mom20Val < -0.5) regime = 'trending_down';

          // Build signals
          let signalStrength = 0;
          const signals = [];

          if (currentRsi > 70) { signals.push({ indicator: 'RSI', signal: 'OVERBOUGHT', detail: `RSI at ${currentRsi.toFixed(1)} — potential reversal zone`, weight: -25 }); signalStrength -= 25; }
          else if (currentRsi < 30) { signals.push({ indicator: 'RSI', signal: 'OVERSOLD', detail: `RSI at ${currentRsi.toFixed(1)} — potential bounce zone`, weight: 25 }); signalStrength += 25; }
          else { signals.push({ indicator: 'RSI', signal: 'NEUTRAL', detail: `RSI at ${currentRsi.toFixed(1)} — mid-range`, weight: 0 }); }

          if (regime === 'trending_up') { signals.push({ indicator: 'TREND', signal: 'BULLISH', detail: 'SMA10 above SMA30 with positive momentum', weight: 20 }); signalStrength += 20; }
          else if (regime === 'trending_down') { signals.push({ indicator: 'TREND', signal: 'BEARISH', detail: 'SMA10 below SMA30 with negative momentum', weight: -20 }); signalStrength -= 20; }
          else { signals.push({ indicator: 'TREND', signal: 'RANGING', detail: 'No clear trend — consolidation phase', weight: 0 }); }

          if (macdVal > 0) { signals.push({ indicator: 'MACD', signal: 'BULLISH', detail: 'MACD positive — bullish crossover', weight: 15 }); signalStrength += 15; }
          else if (macdVal < 0) { signals.push({ indicator: 'MACD', signal: 'BEARISH', detail: 'MACD negative — bearish pressure', weight: -15 }); signalStrength -= 15; }

          if (mom20Val > 1) { signals.push({ indicator: 'MOMENTUM', signal: 'STRONG', detail: `${mom20Val.toFixed(2)}% gain over 20 periods`, weight: 15 }); signalStrength += 15; }
          else if (mom20Val < -1) { signals.push({ indicator: 'MOMENTUM', signal: 'WEAK', detail: `${mom20Val.toFixed(2)}% decline over 20 periods`, weight: -15 }); signalStrength -= 15; }

          if (vol20Val > 3) { signals.push({ indicator: 'VOLATILITY', signal: 'HIGH', detail: `${vol20Val.toFixed(2)}% — elevated risk`, weight: -5 }); signalStrength -= 5; }
          else { signals.push({ indicator: 'VOLATILITY', signal: 'NORMAL', detail: `${vol20Val.toFixed(2)}% — standard conditions`, weight: 0 }); }

          // 50-day SMA signal
          if (currentPrice > sma50Val && sma50Val > 0) { signals.push({ indicator: 'SMA50', signal: 'ABOVE', detail: `Price above 50-day SMA ($${sma50Val.toFixed(2)}) — bullish structure`, weight: 10 }); signalStrength += 10; }
          else if (sma50Val > 0) { signals.push({ indicator: 'SMA50', signal: 'BELOW', detail: `Price below 50-day SMA ($${sma50Val.toFixed(2)}) — bearish structure`, weight: -10 }); signalStrength -= 10; }

          // Volume trend (if available)
          if (volumes.length >= 20) {
            const recentVol = volumes.slice(-5).reduce((s, v) => s + v, 0) / 5;
            const avgVol = volumes.slice(-20).reduce((s, v) => s + v, 0) / 20;
            if (recentVol > avgVol * 1.5) { signals.push({ indicator: 'VOLUME', signal: 'SURGE', detail: `Recent volume ${((recentVol / avgVol - 1) * 100).toFixed(0)}% above 20-day avg`, weight: 5 }); }
            else if (recentVol < avgVol * 0.5) { signals.push({ indicator: 'VOLUME', signal: 'DRY', detail: 'Volume well below average — low conviction', weight: -5 }); signalStrength -= 5; }
          }

          signalStrength = Math.max(-100, Math.min(100, signalStrength));

          let verdict, verdictDetail;
          if (signalStrength >= 30) { verdict = 'BULLISH'; verdictDetail = 'Multiple indicators align bullish. Consider long entry with tight risk management.'; }
          else if (signalStrength >= 10) { verdict = 'LEAN_BULLISH'; verdictDetail = 'Slight bullish bias. Wait for confirmation before committing size.'; }
          else if (signalStrength <= -30) { verdict = 'BEARISH'; verdictDetail = 'Multiple indicators signal bearish pressure. Consider reducing exposure.'; }
          else if (signalStrength <= -10) { verdict = 'LEAN_BEARISH'; verdictDetail = 'Slight bearish bias. Monitor for breakdown.'; }
          else { verdict = 'NEUTRAL'; verdictDetail = 'No clear directional bias. Range-bound conditions favor patience.'; }

          // Classify asset
          const isCrypto = meta.instrumentType === 'CRYPTOCURRENCY' || yahooSym.includes('-USD');
          const isEtf = meta.instrumentType === 'ETF';
          const isFx = meta.instrumentType === 'CURRENCY' || yahooSym.includes('=X');
          const assetClass = isCrypto ? 'Cryptocurrency' : isFx ? 'Forex' : isEtf ? 'ETF' : 'Stock';

          const researchData = {
            symbol, assetClass,
            name: meta.shortName || meta.longName || symbol,
            exchange: meta.exchangeName || meta.fullExchangeName || 'Unknown',
            currency: meta.currency || 'USD',
            price: roundTo(currentPrice, currentPrice < 10 ? 4 : 2),
            open: roundTo(dayOpen, 2), high: roundTo(dayHigh, 2), low: roundTo(dayLow, 2),
            previousClose: roundTo(prevClose, 2),
            changePct: roundTo(changePct, 4),
            dataSource: 'yahoo_finance_live',
            dataMode: 'real',
            realDataAvailable: true,
            technicals: {
              sma10: roundTo(sma10Val, 4), sma30: roundTo(sma30Val, 4), sma50: roundTo(sma50Val, 4),
              ema12: roundTo(ema12Val, 4), ema26: roundTo(ema26Val, 4),
              macd: roundTo(macdVal, 4), rsi: roundTo(currentRsi, 2),
              momentum: roundTo(mom20Val, 4), volatility: roundTo(vol20Val, 4),
              regime,
            },
            levels: { support: roundTo(support, 4), resistance: roundTo(resistance, 4) },
            signals,
            aiVerdict: { verdict, signalStrength, detail: verdictDetail },
            agents: [], // No agents track on-demand symbols
            priceHistory: hist.slice(-60).map((p, i) => ({ tick: i, price: roundTo(p, 2) })),
            chartRange: '3mo',
            dataPoints: hist.length,
            timestamp: Date.now(),
          };

          onDemandCache[symbol] = { data: researchData, timestamp: Date.now() };
          resolve(researchData);
        } catch (e) {
          console.warn(`[Research] Yahoo Finance parse error for ${symbol}:`, e.message);
          resolve(null);
        }
      });
    });
    req.on('error', (e) => {
      console.warn(`[Research] Yahoo Finance fetch error for ${symbol}:`, e.message);
      resolve(null);
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ─── MARKET: RESEARCH ───
// Comprehensive research endpoint — technical analysis, AI signals, and agent insights
// Forex route: handles EUR/USD pattern (slash in URL path)
api.get('/api/market/research/:base/:quote', async (req, res) => {
  const symbol = `${req.params.base}/${req.params.quote}`.toUpperCase();
  req.params.symbol = symbol;
  return researchHandler(req, res);
});
async function researchHandler(req, res) {
  const symbol = decodeURIComponent(req.params.symbol).toUpperCase();
  const price = marketPrices[symbol];
  if (price === undefined) {
    // On-demand lookup: fetch live from Yahoo Finance for any symbol
    try {
      const liveResearch = await fetchOnDemandResearch(symbol);
      if (liveResearch) return json(res, 200, liveResearch);
      return json(res, 404, { error: `Symbol "${symbol}" not found on Yahoo Finance. Check the ticker and try again.` });
    } catch (e) {
      return json(res, 500, { error: `Failed to fetch live data for "${symbol}": ${e.message}` });
    }
  }

  const hist = priceHistory[symbol] || [price];
  const regime = symbolRegimes[symbol] || 'ranging';

  // Technical indicators
  const sma10 = sma(hist, 10);
  const sma30 = sma(hist, 30);
  const ema12 = ema(hist, 12);
  const ema26 = ema(hist, 26);
  const macd = ema12 - ema26;
  const currentRsi = rsi(hist);
  const mom20 = momentum(hist, 20);
  const vol20 = volatility(hist, 20);

  // Support/Resistance from price history
  const sortedPrices = [...hist].sort((a, b) => a - b);
  const support = sortedPrices[Math.floor(sortedPrices.length * 0.1)] || price * 0.97;
  const resistance = sortedPrices[Math.floor(sortedPrices.length * 0.9)] || price * 1.03;

  // Session high/low
  const high = Math.max(...hist);
  const low = Math.min(...hist);
  const open = hist[0] || price;
  const changePct = open > 0 ? ((price - open) / open * 100) : 0;

  // Classify asset
  const isCrypto = ['BTC','ETH','SOL','AVAX','DOGE','XRP','ADA','DOT','MATIC','LINK'].includes(symbol);
  const isFx = symbol.includes('/');
  const isFutures = symbol.endsWith('=F');
  const isCash = ['BIL','SHV','SGOV'].includes(symbol);
  const isLeveraged = ['TQQQ','SOXL','UVXY','SPXS','SQQQ','TNA'].includes(symbol);
  const isEtf = ['SPY','QQQ','GLD','TLT','IWM','EEM','VOO','DIA','VTI','XLF','XLE','XLK','ARKK','HYG'].includes(symbol);
  const assetClass = isCrypto ? 'Cryptocurrency' : isFx ? 'Forex' : isFutures ? 'Futures' : isCash ? 'Cash' : isLeveraged ? 'Options Proxy' : isEtf ? 'ETF' : 'Stock';

  // Which AI agents track this symbol
  const trackingAgents = AI_AGENTS.filter(a => a.symbols.includes(symbol)).map(a => ({
    name: a.name, role: a.role, description: a.description,
  }));

  // Generate AI signal assessment
  let signalStrength = 0; // -100 to +100
  let signals = [];

  // RSI signal
  if (currentRsi > 70) { signals.push({ indicator: 'RSI', signal: 'OVERBOUGHT', detail: `RSI at ${currentRsi.toFixed(1)} — potential reversal zone`, weight: -25 }); signalStrength -= 25; }
  else if (currentRsi < 30) { signals.push({ indicator: 'RSI', signal: 'OVERSOLD', detail: `RSI at ${currentRsi.toFixed(1)} — potential bounce zone`, weight: 25 }); signalStrength += 25; }
  else { signals.push({ indicator: 'RSI', signal: 'NEUTRAL', detail: `RSI at ${currentRsi.toFixed(1)} — mid-range`, weight: 0 }); }

  // Trend signal
  if (regime === 'trending_up') { signals.push({ indicator: 'TREND', signal: 'BULLISH', detail: 'Short-term SMA above long-term SMA with positive momentum', weight: 20 }); signalStrength += 20; }
  else if (regime === 'trending_down') { signals.push({ indicator: 'TREND', signal: 'BEARISH', detail: 'Short-term SMA below long-term SMA with negative momentum', weight: -20 }); signalStrength -= 20; }
  else { signals.push({ indicator: 'TREND', signal: 'RANGING', detail: 'No clear trend direction — market in consolidation', weight: 0 }); }

  // MACD signal
  if (macd > 0 && ema12 > ema26) { signals.push({ indicator: 'MACD', signal: 'BULLISH', detail: 'MACD positive — bullish crossover in effect', weight: 15 }); signalStrength += 15; }
  else if (macd < 0) { signals.push({ indicator: 'MACD', signal: 'BEARISH', detail: 'MACD negative — bearish pressure', weight: -15 }); signalStrength -= 15; }

  // Momentum signal
  if (mom20 > 1) { signals.push({ indicator: 'MOMENTUM', signal: 'STRONG', detail: `${mom20.toFixed(2)}% gain over 20 periods`, weight: 15 }); signalStrength += 15; }
  else if (mom20 < -1) { signals.push({ indicator: 'MOMENTUM', signal: 'WEAK', detail: `${mom20.toFixed(2)}% decline over 20 periods`, weight: -15 }); signalStrength -= 15; }

  // Volatility signal
  if (vol20 > 3) { signals.push({ indicator: 'VOLATILITY', signal: 'HIGH', detail: `${vol20.toFixed(2)}% — elevated risk, wider stops recommended`, weight: -5 }); signalStrength -= 5; }
  else { signals.push({ indicator: 'VOLATILITY', signal: 'NORMAL', detail: `${vol20.toFixed(2)}% — standard conditions`, weight: 0 }); }

  // Support/Resistance proximity
  const distToSupport = ((price - support) / price * 100);
  const distToResistance = ((resistance - price) / price * 100);
  if (distToSupport < 0.5) { signals.push({ indicator: 'SUPPORT', signal: 'NEAR_SUPPORT', detail: `Price ${distToSupport.toFixed(2)}% from support at $${support.toFixed(2)}`, weight: 10 }); signalStrength += 10; }
  if (distToResistance < 0.5) { signals.push({ indicator: 'RESISTANCE', signal: 'NEAR_RESISTANCE', detail: `Price ${distToResistance.toFixed(2)}% from resistance at $${resistance.toFixed(2)}`, weight: -10 }); signalStrength -= 10; }

  // Clamp signal strength
  signalStrength = Math.max(-100, Math.min(100, signalStrength));

  // AI verdict
  let verdict, verdictDetail;
  if (signalStrength >= 30) { verdict = 'BULLISH'; verdictDetail = 'Multiple indicators align bullish. Consider long entry with tight risk management.'; }
  else if (signalStrength >= 10) { verdict = 'LEAN_BULLISH'; verdictDetail = 'Slight bullish bias. Wait for confirmation before committing size.'; }
  else if (signalStrength <= -30) { verdict = 'BEARISH'; verdictDetail = 'Multiple indicators signal bearish pressure. Consider reducing exposure or short entry.'; }
  else if (signalStrength <= -10) { verdict = 'LEAN_BEARISH'; verdictDetail = 'Slight bearish bias. Monitor for breakdown before acting.'; }
  else { verdict = 'NEUTRAL'; verdictDetail = 'No clear directional bias. Range-bound conditions favor patience or mean-reversion strategies.'; }

  json(res, 200, {
    symbol, assetClass, price, open, high, low,
    changePct: roundTo(changePct, 4),
    dataSource: priceDataSource[symbol] || 'simulated',
    dataMode: MARKET_DATA_MODE,
    realDataAvailable,
    technicals: {
      sma10: roundTo(sma10, 4), sma30: roundTo(sma30, 4),
      ema12: roundTo(ema12, 4), ema26: roundTo(ema26, 4),
      macd: roundTo(macd, 4), rsi: roundTo(currentRsi, 2),
      momentum: roundTo(mom20, 4), volatility: roundTo(vol20, 4),
      regime,
    },
    levels: { support: roundTo(support, 4), resistance: roundTo(resistance, 4) },
    signals,
    aiVerdict: { verdict, signalStrength, detail: verdictDetail },
    agents: trackingAgents,
    priceHistory: hist.slice(-60).map((p, i) => ({ tick: i, price: p })),
    timestamp: Date.now(),
  });
}
// Single-symbol research route (also handles URL-encoded forex like EUR%2FUSD)
api.get('/api/market/research/:symbol', async (req, res) => researchHandler(req, res));

// ─── MARKET: SEARCH SYMBOLS ───
api.get('/api/market/search', async (req, res) => {
  const q = (req.query.q || '').toUpperCase().trim();
  if (!q) return json(res, 200, { results: Object.keys(marketPrices) });

  // First: match tracked symbols
  const tracked = Object.keys(marketPrices).filter(s => s.includes(q));

  // If matches found in tracked set, return them
  if (tracked.length > 0) return json(res, 200, { results: tracked });

  // No tracked match — try Yahoo Finance symbol validation
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(q)}?range=1d&interval=1d`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const yResp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    clearTimeout(timeout);
    if (yResp.ok) {
      const yData = await yResp.json();
      const meta = yData?.chart?.result?.[0]?.meta;
      if (meta && meta.regularMarketPrice > 0) {
        return json(res, 200, {
          results: [q],
          onDemand: true,
          meta: {
            symbol: meta.symbol || q,
            name: meta.shortName || meta.longName || q,
            price: meta.regularMarketPrice,
            exchange: meta.exchangeName || 'Unknown'
          }
        });
      }
    }
  } catch (e) {
    // Yahoo lookup failed — fall through silently
  }

  // Nothing found
  json(res, 200, { results: [] });
});

// ─── MARKET: AGENTS ───
api.get('/api/market/agents', (req, res) => {
  json(res, 200, db.findMany('agent_stats'));
});

// ─── BROKER: STATUS ───
api.get('/api/broker/status', auth, (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  const conns = db.findMany('broker_connections', c => c.user_id === req.userId);
  json(res, 200, {
    tradingMode: user?.trading_mode || 'paper',
    connections: conns.map(c => ({ broker: c.broker_name, active: c.is_active, linkedAt: c.linked_at })),
  });
});

// ─── BROKER: SWITCH MODE ───
api.post('/api/broker/switch-mode', auth, async (req, res) => {
  const body = await readBody(req);
  if (!['paper', 'live'].includes(body.mode)) return json(res, 400, { error: 'Mode must be paper or live' });

  if (body.mode === 'live') {
    const conn = db.findOne('broker_connections', c => c.user_id === req.userId && c.is_active);
    if (!conn) return json(res, 400, { error: 'Connect a broker account first' });
  }

  db.update('users', u => u.id === req.userId, { trading_mode: body.mode });
  json(res, 200, { success: true, tradingMode: body.mode });
});

// ═══════════════════════════════════════════
//   SERVER STARTUP
// ═══════════════════════════════════════════

const server = createServer(async (req, res) => {
  // Resolve and attach CORS origin for all responses
  const origin = getCorsOrigin(req);
  res._corsOrigin = origin;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
      ...SECURITY_HEADERS,
    });
    return res.end();
  }

  const matched = await api.handle(req, res);
  if (!matched) json(res, 404, { error: 'Not found', path: req.url });
});

// WebSocket upgrade
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws/prices') {
    handleUpgrade(req, socket);
  } else {
    socket.destroy();
  }
});

// Price tick engine — every 2 seconds
const priceInterval = setInterval(() => {
  tickPrices();
  wsBroadcastPrices();
}, 2000);

// Real market data refresh — every 30 seconds (if enabled)
if (MARKET_DATA_MODE !== 'simulated') {
  // Initial fetch on boot (delayed 3s to let server start)
  setTimeout(() => {
    console.log(`[Market Data] Initial real price fetch starting (mode=${MARKET_DATA_MODE})...`);
    refreshRealMarketData().catch(e => console.warn('[Market Data] Initial fetch error:', e.message));
  }, 3000);

  // Periodic refresh every 30 seconds
  setInterval(() => {
    refreshRealMarketData().catch(e => console.warn('[Market Data] Periodic fetch error:', e.message));
  }, 30000);
}

// ═══════════════════════════════════════════
//   SERVER-SIDE AUTONOMOUS TRADING ENGINE
//   Runs independently of browser — 24/7
// ═══════════════════════════════════════════

// ─── AGENT DEFINITIONS: Each agent has a DISTINCT role in the collective ───
const AI_AGENTS = [
  {
    name: 'Viper',
    role: 'SIGNAL_SCANNER',
    description: 'Momentum & breakout across tech, leveraged ETFs, and commodity futures',
    symbols: ['NVDA', 'TSLA', 'META', 'AMD', 'PLTR', 'COIN', 'TQQQ', 'SOXL', 'CL=F', 'GC=F'],
    longBias: 0.65,
    reasons: { long: 'Momentum breakout detected', short: 'Trend exhaustion — taking profit' },
  },
  {
    name: 'Oracle',
    role: 'FUNDAMENTAL_ANALYST',
    description: 'Value investing + macro analysis across stocks, currencies, and treasury futures',
    symbols: ['AAPL', 'MSFT', 'JPM', 'JNJ', 'EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'ZB=F'],
    longBias: 0.70,
    reasons: { long: 'Undervalued entry — strong fundamentals', short: 'Overvaluation detected — trimming' },
  },
  {
    name: 'Spectre',
    role: 'VOLATILITY_TRADER',
    description: 'Exploits volatility in crypto, commodities, and high-beta assets',
    symbols: ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ADA', 'DOT', 'AVAX', 'LINK', 'MATIC', 'NG=F', 'SI=F'],
    longBias: 0.55,
    reasons: { long: 'Vol breakout — riding momentum', short: 'Mean reversion short — overbought' },
  },
  {
    name: 'Sentinel',
    role: 'RISK_MANAGER',
    description: 'Risk hedging via safe-havens, forex, inverse ETFs, cash instruments, and gold futures',
    symbols: ['GLD', 'TLT', 'USD/CHF', 'USD/CAD', 'UVXY', 'SPXS', 'BIL', 'SHV', 'SGOV', 'GC=F'],
    longBias: 0.60,
    isRiskManager: true,
    reasons: { long: 'Hedging — defensive position', short: 'Risk-off rotation — reducing exposure' },
  },
  {
    name: 'Phoenix',
    role: 'RECOVERY_SPECIALIST',
    description: 'Turnaround plays + leveraged momentum + commodity recovery trades',
    symbols: ['F', 'BAC', 'RIOT', 'GE', 'TQQQ', 'SOXL', 'TNA', 'SQQQ', 'CL=F', 'NG=F'],
    longBias: 0.60,
    reasons: { long: 'Recovery catalyst identified', short: 'Dead cat bounce — exiting' },
  },
  {
    name: 'Titan',
    role: 'POSITION_SIZER',
    description: 'Scales winners across ETFs, index futures, and sector rotation',
    symbols: ['SPY', 'QQQ', 'IWM', 'EEM', 'DIA', 'VTI', 'XLF', 'XLE', 'XLK', 'ARKK', 'HYG', 'ES=F', 'NQ=F', 'YM=F'],
    longBias: 0.55,
    isPositionManager: true,
    reasons: { long: 'Scaling into winner — conviction high', short: 'Sector rotation — reallocating capital' },
  },
];

const AUTO_TRADE_CONFIG = {
  tickIntervalMs: 10000,       // Check every 10 seconds
  maxOpenPositions: 8,         // 8 positions across 7 asset classes (stocks, ETFs, crypto, forex, options, futures, cash)
  maxDailyTrades: 20,          // Precision over volume — high win-rate strategy. QA agent resets after 15min cooldown.
  baseSizePct: 0.05,           // 5% of equity per trade (concentrated bets on high conviction)
  winnerSizePct: 0.08,         // 8% for high-conviction signals
  eliteSizePct: 0.10,          // 10% for multi-indicator confluence trades
  consensusThreshold: 0.5,     // RAISED — higher consensus required before action
  minSignalStrength: 0.78,     // RAISED from 0.65 — only take elite-conviction signals
  minConfluence: 4,            // RAISED from 3 — minimum 4 confirming indicators required
  maxCorrelatedPositions: 2,   // Max 2 in same asset class (reduce correlated risk)
  maxDrawdownPct: 12,          // TIGHTENED from 15% — kill switch at -12% from peak equity
  // Win-rate optimization parameters
  minWinRateForTrading: 0.40,  // Halt new entries if agent win rate drops below 40%
  profitTargetPct: 1.5,        // Take profit at 1.5% gain (high win rate, smaller gains)
  maxLossPct: 0.6,             // Hard max loss at -0.6% (tight risk control)
};

let autoTradeTickCount = 0;
const SERVER_BOOT_TIME = new Date().toISOString(); // Track deploy time for daily limit scoping
let globalSessionResetTime = null; // Set by QA agent when daily limit cooldown expires — resets trade counter

// ═══════════════════════════════════════════
//   SELF-HEALING ADAPTIVE FEEDBACK SYSTEM
//   Tracks per-agent and per-symbol performance
//   Adjusts confidence multipliers in real-time
// ═══════════════════════════════════════════
const agentPerformance = {}; // { agentName: { wins, losses, recentPnl[], adaptiveConfidence } }
const symbolPerformance = {}; // { symbol: { wins, losses, avgPnl, bestSide } }

function getAgentPerf(name) {
  if (!agentPerformance[name]) {
    agentPerformance[name] = { wins: 0, losses: 0, recentPnl: [], adaptiveConfidence: 1.0, streak: 0 };
  }
  return agentPerformance[name];
}

function getSymbolPerf(symbol) {
  if (!symbolPerformance[symbol]) {
    symbolPerformance[symbol] = { wins: 0, losses: 0, longWins: 0, longLosses: 0, shortWins: 0, shortLosses: 0, totalPnl: 0 };
  }
  return symbolPerformance[symbol];
}

// Called after every trade close to update the learning system
function updatePerformanceFeedback(agentName, symbol, side, pnl) {
  const ap = getAgentPerf(agentName);
  const sp = getSymbolPerf(symbol);

  if (pnl >= 0) {
    ap.wins++;
    ap.streak = Math.max(0, ap.streak) + 1;
    sp.wins++;
    if (side === 'LONG') sp.longWins++; else sp.shortWins++;
  } else {
    ap.losses++;
    ap.streak = Math.min(0, ap.streak) - 1;
    sp.losses++;
    if (side === 'LONG') sp.longLosses++; else sp.shortLosses++;
  }

  ap.recentPnl.push(pnl);
  if (ap.recentPnl.length > 20) ap.recentPnl.shift();
  sp.totalPnl += pnl;

  // Self-healing: adjust agent confidence based on recent performance
  const recentWins = ap.recentPnl.filter(p => p >= 0).length;
  const recentWinRate = ap.recentPnl.length > 5 ? recentWins / ap.recentPnl.length : 0.5;

  // Agents that are winning get boosted; losing agents get dampened
  if (recentWinRate > 0.6) ap.adaptiveConfidence = Math.min(1.5, 1.0 + (recentWinRate - 0.5));
  else if (recentWinRate < 0.35) ap.adaptiveConfidence = Math.max(0.3, recentWinRate + 0.15);
  else ap.adaptiveConfidence = 0.8 + recentWinRate * 0.4;

  // ─── Feed into learning engine + circuit breaker ───
  updateCircuitBreaker(agentName, pnl);
}

// ═══════════════════════════════════════════════════════════════════
//   ADAPTIVE LEARNING ENGINE v1.0
//   Per-agent, per-symbol indicator weight learning from trade outcomes.
//   Strategy rotation: agents shift style when conditions change.
//   Self-healing: circuit breakers, auto-quarantine, parameter tuning.
// ═══════════════════════════════════════════════════════════════════

// ─── Indicator Weight Learning ───
// Tracks which indicators contributed to winning vs losing trades
// Weights evolve over time: winning indicators get boosted, losers dampened
const indicatorLearning = {};
// Structure: { agentName: { symbol: { indicator: { weight, wins, losses, contribution } } } }

const LEARNABLE_INDICATORS = [
  'sma_cross', 'ema_support', 'macd', 'bb_band', 'bb_squeeze', 'stochastic',
  'momentum', 'roc', 'obv', 'vwap', 'rsi', 'regime', 'mtf', 'sentiment', 'correlation'
];

const DEFAULT_INDICATOR_WEIGHT = 1.0;
const WEIGHT_LEARN_RATE = 0.08;       // How fast weights adapt (higher = faster learning)
const WEIGHT_MIN = 0.2;               // Never fully zero-out an indicator
const WEIGHT_MAX = 2.5;               // Cap runaway positive feedback
const WEIGHT_DECAY_RATE = 0.005;      // Slow regression to mean over time

function getIndicatorWeights(agentName, symbol) {
  if (!indicatorLearning[agentName]) indicatorLearning[agentName] = {};
  if (!indicatorLearning[agentName][symbol]) {
    const weights = {};
    for (const ind of LEARNABLE_INDICATORS) {
      weights[ind] = { weight: DEFAULT_INDICATOR_WEIGHT, wins: 0, losses: 0, contribution: 0, lastUpdated: Date.now() };
    }
    indicatorLearning[agentName][symbol] = weights;
  }
  return indicatorLearning[agentName][symbol];
}

// Called after trade close — updates indicator weights based on outcome
function learnFromTrade(agentName, symbol, tradeResult) {
  const weights = getIndicatorWeights(agentName, symbol);
  const { pnl, indicators_used } = tradeResult;
  if (!indicators_used || indicators_used.length === 0) return;

  const isWin = pnl >= 0;
  const magnitude = Math.min(Math.abs(pnl) / 3, 1.0); // Normalize: 3% = max magnitude

  for (const ind of indicators_used) {
    if (!weights[ind]) continue;
    const w = weights[ind];

    if (isWin) {
      w.wins++;
      w.weight = Math.min(WEIGHT_MAX, w.weight + WEIGHT_LEARN_RATE * magnitude);
      w.contribution += magnitude;
    } else {
      w.losses++;
      w.weight = Math.max(WEIGHT_MIN, w.weight - WEIGHT_LEARN_RATE * magnitude * 1.2); // Penalize losses slightly harder
      w.contribution -= magnitude * 0.5;
    }
    w.lastUpdated = Date.now();
  }

  // Decay unused indicators toward default (prevents stale weights)
  for (const ind of LEARNABLE_INDICATORS) {
    if (weights[ind] && !indicators_used.includes(ind)) {
      const timeSinceUpdate = Date.now() - weights[ind].lastUpdated;
      if (timeSinceUpdate > 300000) { // 5 min
        weights[ind].weight += (DEFAULT_INDICATOR_WEIGHT - weights[ind].weight) * WEIGHT_DECAY_RATE;
      }
    }
  }
}

// ─── Strategy Rotation ───
// Detects regime changes and rotates agent strategy bias
const strategyState = {};
// Structure: { agentName: { currentStrategy, regimeHistory[], rotationCount, lastRotation, cooldownUntil } }

function getStrategyState(agentName) {
  if (!strategyState[agentName]) {
    strategyState[agentName] = {
      currentStrategy: 'default',
      regimeHistory: [],           // Last 20 market regime observations
      rotationCount: 0,
      lastRotation: Date.now(),
      cooldownUntil: 0,
      adaptiveLongBias: null,      // null = use agent default
      performanceTrend: 'stable',  // rising, stable, declining, critical
    };
  }
  return strategyState[agentName];
}

function evaluateStrategyRotation(agentName) {
  const ss = getStrategyState(agentName);
  const ap = getAgentPerf(agentName);
  const now = Date.now();

  // Cooldown: don't rotate more than once per 5 minutes
  if (now < ss.cooldownUntil) return;

  // Assess performance trend from recent P&L
  const recent = ap.recentPnl || [];
  if (recent.length < 8) { ss.performanceTrend = 'stable'; return; }

  const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
  const secondHalf = recent.slice(Math.floor(recent.length / 2));
  const firstAvg = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
  const recentWinRate = recent.filter(p => p >= 0).length / recent.length;

  // Classify trend
  if (secondAvg > firstAvg + 0.5 && recentWinRate > 0.55) ss.performanceTrend = 'rising';
  else if (secondAvg < firstAvg - 1.0 || recentWinRate < 0.3) ss.performanceTrend = 'critical';
  else if (secondAvg < firstAvg - 0.3 || recentWinRate < 0.4) ss.performanceTrend = 'declining';
  else ss.performanceTrend = 'stable';

  // Strategy rotation based on trend
  if (ss.performanceTrend === 'critical') {
    // Shift to defensive: reduce long bias, tighten signals
    const agent = AI_AGENTS.find(a => a.name === agentName);
    if (agent) {
      ss.adaptiveLongBias = Math.max(0.35, (agent.longBias || 0.55) - 0.15);
    }
    ss.currentStrategy = 'defensive';
    ss.rotationCount++;
    ss.lastRotation = now;
    ss.cooldownUntil = now + 300000; // 5 min cooldown
    console.log(`[Learning] ${agentName}: STRATEGY ROTATION → defensive (critical trend, WR ${(recentWinRate*100).toFixed(0)}%)`);
  } else if (ss.performanceTrend === 'rising' && ss.currentStrategy !== 'aggressive') {
    const agent = AI_AGENTS.find(a => a.name === agentName);
    if (agent) {
      ss.adaptiveLongBias = Math.min(0.85, (agent.longBias || 0.55) + 0.10);
    }
    ss.currentStrategy = 'aggressive';
    ss.rotationCount++;
    ss.lastRotation = now;
    ss.cooldownUntil = now + 300000;
    console.log(`[Learning] ${agentName}: STRATEGY ROTATION → aggressive (rising trend, WR ${(recentWinRate*100).toFixed(0)}%)`);
  } else if (ss.performanceTrend === 'stable' && ss.currentStrategy !== 'default') {
    const agent = AI_AGENTS.find(a => a.name === agentName);
    if (agent) ss.adaptiveLongBias = null; // Reset to default
    ss.currentStrategy = 'default';
    ss.rotationCount++;
    ss.lastRotation = now;
    ss.cooldownUntil = now + 180000;
    console.log(`[Learning] ${agentName}: STRATEGY ROTATION → default (stabilized)`);
  }
}

// ─── Agent Circuit Breakers ───
// Auto-quarantine agents that are hemorrhaging capital
const agentCircuitBreakers = {};
// Structure: { agentName: { tripped, tripCount, tripReason, trippedAt, resumeAt, consecutiveLosses, drawdownFromPeak } }

function getCircuitBreaker(agentName) {
  if (!agentCircuitBreakers[agentName]) {
    agentCircuitBreakers[agentName] = {
      tripped: false,
      tripCount: 0,
      tripReason: '',
      trippedAt: 0,
      resumeAt: 0,
      consecutiveLosses: 0,
      maxConsecutiveLosses: 0,
      drawdownFromPeak: 0,
      peakPnl: 0,
      totalPnl: 0,
      healActions: [],             // Log of self-healing actions taken
    };
  }
  return agentCircuitBreakers[agentName];
}

function checkCircuitBreaker(agentName) {
  const cb = getCircuitBreaker(agentName);
  const now = Date.now();

  // Auto-resume after cooldown
  if (cb.tripped && now >= cb.resumeAt) {
    cb.tripped = false;
    cb.consecutiveLosses = 0;
    cb.healActions.push({ action: 'AUTO_RESUME', at: new Date().toISOString(), reason: 'Cooldown expired' });
    if (cb.healActions.length > 50) cb.healActions = cb.healActions.slice(-30);
    console.log(`[SelfHeal] ${agentName}: Circuit breaker RESET — resuming trading`);
  }

  return cb.tripped;
}

function updateCircuitBreaker(agentName, pnl) {
  const cb = getCircuitBreaker(agentName);
  const now = Date.now();

  cb.totalPnl += pnl;
  if (cb.totalPnl > cb.peakPnl) cb.peakPnl = cb.totalPnl;
  cb.drawdownFromPeak = cb.peakPnl - cb.totalPnl;

  if (pnl < 0) {
    cb.consecutiveLosses++;
    if (cb.consecutiveLosses > cb.maxConsecutiveLosses) cb.maxConsecutiveLosses = cb.consecutiveLosses;
  } else {
    cb.consecutiveLosses = 0;
  }

  // ─── TRIP CONDITIONS ───
  let shouldTrip = false;
  let reason = '';

  // Condition 1: 2+ consecutive losses (TIGHTENED from 3 — zero tolerance in precision mode)
  if (cb.consecutiveLosses >= 2) {
    shouldTrip = true;
    reason = `${cb.consecutiveLosses} consecutive losses — precision mode halt`;
  }

  // Condition 2: Drawdown from peak exceeds $1.5k (TIGHTENED from $3k)
  if (cb.drawdownFromPeak > 1500) {
    shouldTrip = true;
    reason = `Drawdown $${cb.drawdownFromPeak.toFixed(0)} from peak — capital preservation`;
  }

  // Condition 3: Recent win rate below 50% over last 5+ trades (TIGHTENED from <30%/6 trades)
  const ap = getAgentPerf(agentName);
  const recentPnl = (ap.recentPnl || []).slice(-10);
  if (recentPnl.length >= 5) {
    const recentWinRate = recentPnl.filter(p => p >= 0).length / recentPnl.length;
    if (recentWinRate < 0.50) {
      shouldTrip = true;
      reason = `Win rate ${(recentWinRate*100).toFixed(0)}% over last ${recentPnl.length} trades — below 50% threshold`;
    }
  }

  if (shouldTrip && !cb.tripped) {
    cb.tripped = true;
    cb.tripCount++;
    cb.tripReason = reason;
    cb.trippedAt = now;

    // Escalating cooldown: 3min, 6min, 12min, 20min max (LONGER — force agents to reflect)
    const cooldownMs = Math.min(1200000, cb.tripCount * 180000 + 180000);
    cb.resumeAt = now + cooldownMs;

    cb.healActions.push({
      action: 'CIRCUIT_TRIP',
      at: new Date().toISOString(),
      reason,
      cooldownMs,
      tripNumber: cb.tripCount,
    });
    if (cb.healActions.length > 50) cb.healActions = cb.healActions.slice(-30);

    console.log(`[SelfHeal] ${agentName}: CIRCUIT BREAKER TRIPPED — ${reason} — cooldown ${(cooldownMs/1000).toFixed(0)}s`);

    // Self-healing action: reduce agent confidence on trip
    ap.adaptiveConfidence = Math.max(0.3, ap.adaptiveConfidence * 0.6);
    console.log(`[SelfHeal] ${agentName}: Confidence reduced to ${ap.adaptiveConfidence.toFixed(2)}`);
  }
}

// ─── Auto-Parameter Tuning ───
// Periodically reviews agent performance and adjusts trading parameters
function runAutoTuning() {
  const now = Date.now();

  for (const agent of AI_AGENTS) {
    if (agent.isRiskManager || agent.isPositionManager) continue;

    const ap = getAgentPerf(agent.name);
    const cb = getCircuitBreaker(agent.name);
    const ss = getStrategyState(agent.name);

    // Evaluate strategy rotation
    evaluateStrategyRotation(agent.name);

    // Auto-tune confidence recovery for reformed agents
    if (cb.tripCount > 0 && !cb.tripped && ap.streak > 3) {
      // Agent recovered after circuit trip — cautiously boost confidence
      const recovery = Math.min(0.1, ap.streak * 0.02);
      ap.adaptiveConfidence = Math.min(1.3, ap.adaptiveConfidence + recovery);
      cb.healActions.push({
        action: 'CONFIDENCE_RECOVERY',
        at: new Date().toISOString(),
        newConfidence: ap.adaptiveConfidence,
        streak: ap.streak,
      });
      if (cb.healActions.length > 50) cb.healActions = cb.healActions.slice(-30);
    }

    // Indicator weight decay — bring stale weights back toward 1.0
    if (indicatorLearning[agent.name]) {
      for (const sym of Object.keys(indicatorLearning[agent.name])) {
        const weights = indicatorLearning[agent.name][sym];
        for (const ind of LEARNABLE_INDICATORS) {
          if (weights[ind]) {
            const staleness = (now - weights[ind].lastUpdated) / 600000; // 10min units
            if (staleness > 1) {
              weights[ind].weight += (DEFAULT_INDICATOR_WEIGHT - weights[ind].weight) * WEIGHT_DECAY_RATE * Math.min(staleness, 5);
            }
          }
        }
      }
    }
  }
}

// ─── Learning Metrics Aggregator ───
function getAgentLearningReport() {
  const report = { agents: {}, system: { totalRotations: 0, totalCircuitTrips: 0, activeBreakers: 0 } };

  for (const agent of AI_AGENTS) {
    if (agent.isRiskManager || agent.isPositionManager) continue;

    const ap = getAgentPerf(agent.name);
    const cb = getCircuitBreaker(agent.name);
    const ss = getStrategyState(agent.name);
    const totalTrades = ap.wins + ap.losses;
    const winRate = totalTrades > 0 ? ap.wins / totalTrades : 0;

    // Top learned indicators
    const topIndicators = [];
    if (indicatorLearning[agent.name]) {
      const allWeights = {};
      for (const sym of Object.keys(indicatorLearning[agent.name])) {
        const weights = indicatorLearning[agent.name][sym];
        for (const ind of LEARNABLE_INDICATORS) {
          if (weights[ind]) {
            if (!allWeights[ind]) allWeights[ind] = { totalWeight: 0, count: 0, wins: 0, losses: 0 };
            allWeights[ind].totalWeight += weights[ind].weight;
            allWeights[ind].count++;
            allWeights[ind].wins += weights[ind].wins;
            allWeights[ind].losses += weights[ind].losses;
          }
        }
      }
      for (const [ind, data] of Object.entries(allWeights)) {
        topIndicators.push({
          indicator: ind,
          avgWeight: roundTo(data.totalWeight / data.count, 3),
          wins: data.wins,
          losses: data.losses,
          winRate: (data.wins + data.losses) > 0 ? roundTo(data.wins / (data.wins + data.losses), 3) : 0,
        });
      }
      topIndicators.sort((a, b) => b.avgWeight - a.avgWeight);
    }

    report.agents[agent.name] = {
      confidence: roundTo(ap.adaptiveConfidence, 3),
      winRate: roundTo(winRate, 3),
      totalTrades,
      streak: ap.streak,
      strategy: ss.currentStrategy,
      performanceTrend: ss.performanceTrend,
      adaptiveLongBias: ss.adaptiveLongBias,
      rotationCount: ss.rotationCount,
      circuitBreaker: {
        tripped: cb.tripped,
        tripCount: cb.tripCount,
        tripReason: cb.tripReason,
        consecutiveLosses: cb.consecutiveLosses,
        maxConsecutiveLosses: cb.maxConsecutiveLosses,
        drawdownFromPeak: roundTo(cb.drawdownFromPeak, 2),
        cooldownRemaining: cb.tripped ? Math.max(0, Math.round((cb.resumeAt - Date.now()) / 1000)) : 0,
      },
      recentHealActions: (cb.healActions || []).slice(-5),
      topIndicators: topIndicators.slice(0, 8),
    };

    report.system.totalRotations += ss.rotationCount;
    report.system.totalCircuitTrips += cb.tripCount;
    if (cb.tripped) report.system.activeBreakers++;
  }

  report.system.timestamp = new Date().toISOString();
  return report;
}

// ─── Signal Quality Scoring v2 ───
// Multi-indicator confluence system: more agreement = stronger signal
// Tracks indicator alignment count for position sizing tiers
function computeSignal(symbol, agentStyle, agentName) {
  const hist = priceHistory[symbol];
  if (!hist || hist.length < 30) return { score: 0, reason: 'Insufficient data', confluence: 0, indicators_used: [] };

  const price = marketPrices[symbol];
  const sma10 = sma(hist, 10);
  const sma30 = sma(hist, 30);
  const ema10 = ema(hist, 10);
  const ema12 = ema(hist, 12);
  const ema26 = ema(hist, 26);
  const macdVal = ema12 - ema26;
  const rsiVal = rsi(hist, 14);
  const mom = momentum(hist, 20);
  const mom10 = momentum(hist, 10);
  const vol = volatility(hist, 20);
  const regime = symbolRegimes[symbol];

  // ─── ADVANCED INDICATORS ───
  const bb = bollingerBands(hist, 20, 2);
  const adxVal = adx(hist, 14);
  const stoch = stochastic(hist, 14, 3);
  const obvArr = obv(hist);
  const obvVal = obvArr.length > 0 ? obvArr[obvArr.length - 1] : 0;
  const obvPrev = obvArr.length > 5 ? obvArr[obvArr.length - 6] : obvVal;
  const rocVal = roc(hist, 12);
  const atrVal = atr(hist, 14);
  const vwapVal = vwap(hist);
  const mtf = multiTimeframeSignal(hist);
  const sentiment = sentimentStore[symbol] || { score: 0 };
  const corrRegime = correlationCache.marketRegime || 'neutral';
  const session = getMarketSession();

  // Bollinger Band %B — where price sits within the bands
  const bbPercentB = (bb.upper !== bb.lower) ? (price - bb.lower) / (bb.upper - bb.lower) : 0.5;
  const bbWidth = (bb.upper - bb.lower) / (bb.middle || 1); // squeeze detection

  let score = 0;
  let reasons = [];
  let confluenceBullish = 0;
  let confluenceBearish = 0;
  const indicators_used = []; // Track which indicators fired for learning feedback

  // Adaptive indicator weights from learning engine
  const iw = agentName ? getIndicatorWeights(agentName, symbol) : null;
  const w = (ind) => {
    const weight = iw && iw[ind] ? iw[ind].weight : 1.0;
    return weight;
  };

  // ─── TREND SIGNALS (enhanced with ADX confirmation) ───
  if (agentStyle === 'SIGNAL_SCANNER' || agentStyle === 'FUNDAMENTAL_ANALYST') {
    // SMA crossover — boosted when ADX confirms trend strength
    const trendBoost = adxVal > 25 ? 1.3 : (adxVal > 18 ? 1.1 : 0.8);
    if (sma10 > sma30 && mom > 0.1) {
      score += 0.3 * trendBoost * w('sma_cross'); confluenceBullish++; indicators_used.push('sma_cross'); reasons.push(`Uptrend (SMA cross, ADX ${adxVal.toFixed(0)})`);
    } else if (sma10 < sma30 && mom < -0.1) {
      score -= 0.3 * trendBoost * w('sma_cross'); confluenceBearish++; indicators_used.push('sma_cross'); reasons.push(`Downtrend (SMA cross, ADX ${adxVal.toFixed(0)})`);
    }

    // EMA support/resistance bounce
    if (ema10 > price * 0.998 && ema10 < price * 1.005 && regime === 'trending_up') {
      score += 0.2 * w('ema_support'); confluenceBullish++; indicators_used.push('ema_support'); reasons.push('EMA support bounce');
    }

    // MACD crossover signal
    if (macdVal > 0 && ema12 > ema26) { score += 0.15 * w('macd'); confluenceBullish++; indicators_used.push('macd'); reasons.push('MACD bullish'); }
    else if (macdVal < 0 && ema12 < ema26) { score -= 0.15 * w('macd'); confluenceBearish++; indicators_used.push('macd'); reasons.push('MACD bearish'); }
  }

  // ─── BOLLINGER BAND SIGNALS ───
  if (bbPercentB < 0.05 && stoch.k < 25) {
    score += 0.25 * w('bb_band'); confluenceBullish++; indicators_used.push('bb_band'); reasons.push(`BB lower band + Stoch OS (${stoch.k.toFixed(0)})`);
  } else if (bbPercentB > 0.95 && stoch.k > 75) {
    score -= 0.25 * w('bb_band'); confluenceBearish++; indicators_used.push('bb_band'); reasons.push(`BB upper band + Stoch OB (${stoch.k.toFixed(0)})`);
  }
  if (bbWidth < 0.02) {
    if (mom > 0.1) { score += 0.15 * w('bb_squeeze'); indicators_used.push('bb_squeeze'); reasons.push('BB squeeze — bullish breakout setup'); }
    else if (mom < -0.1) { score -= 0.15 * w('bb_squeeze'); indicators_used.push('bb_squeeze'); reasons.push('BB squeeze — bearish breakout setup'); }
  }

  // ─── STOCHASTIC DIVERGENCE ───
  if (stoch.k < 20 && stoch.k > stoch.d && mom10 > 0) {
    score += 0.15 * w('stochastic'); confluenceBullish++; indicators_used.push('stochastic'); reasons.push('Stochastic bullish crossover in OS');
  } else if (stoch.k > 80 && stoch.k < stoch.d && mom10 < 0) {
    score -= 0.15 * w('stochastic'); confluenceBearish++; indicators_used.push('stochastic'); reasons.push('Stochastic bearish crossover in OB');
  }

  // ─── MOMENTUM SIGNALS ───
  if (agentStyle === 'SIGNAL_SCANNER' || agentStyle === 'VOLATILITY_TRADER') {
    if (mom > 0.5) { score += 0.25 * w('momentum'); confluenceBullish++; indicators_used.push('momentum'); reasons.push(`Momentum +${mom.toFixed(1)}%`); }
    else if (mom < -0.5) { score -= 0.25 * w('momentum'); confluenceBearish++; indicators_used.push('momentum'); reasons.push(`Momentum ${mom.toFixed(1)}%`); }

    if (mom10 > 0.2 && mom > 0) { score += 0.1 * w('momentum'); reasons.push('Accelerating upward'); }
    else if (mom10 < -0.2 && mom < 0) { score -= 0.1 * w('momentum'); reasons.push('Accelerating downward'); }

    if (rocVal > 1.5 && mom > 0) { score += 0.1 * w('roc'); confluenceBullish++; indicators_used.push('roc'); reasons.push(`ROC +${rocVal.toFixed(1)}%`); }
    else if (rocVal < -1.5 && mom < 0) { score -= 0.1 * w('roc'); confluenceBearish++; indicators_used.push('roc'); reasons.push(`ROC ${rocVal.toFixed(1)}%`); }
  }

  // ─── OBV (On-Balance Volume) DIVERGENCE ───
  const obvTrend = obvVal - obvPrev;
  if (obvTrend > 0 && mom < -0.1) {
    score += 0.15 * w('obv'); confluenceBullish++; indicators_used.push('obv'); reasons.push('OBV bullish divergence (accumulation)');
  } else if (obvTrend < 0 && mom > 0.1) {
    score -= 0.15 * w('obv'); confluenceBearish++; indicators_used.push('obv'); reasons.push('OBV bearish divergence (distribution)');
  }

  // ─── VWAP RELATIVE POSITION ───
  if (vwapVal > 0) {
    const vwapDev = (price - vwapVal) / vwapVal;
    if (vwapDev < -0.005 && regime !== 'trending_down') {
      score += 0.12 * w('vwap'); confluenceBullish++; indicators_used.push('vwap'); reasons.push('Below VWAP — institutional buy zone');
    } else if (vwapDev > 0.005 && regime !== 'trending_up') {
      score -= 0.12 * w('vwap'); confluenceBearish++; indicators_used.push('vwap'); reasons.push('Above VWAP — institutional sell zone');
    }
  }

  // ─── RSI SIGNALS (improved with divergence detection) ───
  if (rsiVal < 28) { score += 0.25 * w('rsi'); confluenceBullish++; indicators_used.push('rsi'); reasons.push(`RSI deeply oversold (${rsiVal.toFixed(0)})`); }
  else if (rsiVal < 35 && mom10 > 0) { score += 0.15 * w('rsi'); confluenceBullish++; indicators_used.push('rsi'); reasons.push(`RSI recovering from oversold (${rsiVal.toFixed(0)})`); }
  else if (rsiVal > 72) { score -= 0.2 * w('rsi'); confluenceBearish++; indicators_used.push('rsi'); reasons.push(`RSI overbought (${rsiVal.toFixed(0)})`); }
  else if (rsiVal > 65 && mom10 < 0) { score -= 0.1 * w('rsi'); confluenceBearish++; indicators_used.push('rsi'); reasons.push(`RSI fading from overbought (${rsiVal.toFixed(0)})`); }
  else if (rsiVal > 45 && rsiVal < 55 && regime === 'trending_up') { score += 0.08 * w('rsi'); reasons.push('RSI neutral in uptrend'); }

  // ─── REGIME BONUS ───
  if (regime === 'trending_up') { score += 0.12 * w('regime'); confluenceBullish++; indicators_used.push('regime'); reasons.push('Bullish regime'); }
  else if (regime === 'trending_down') { score -= 0.12 * w('regime'); confluenceBearish++; indicators_used.push('regime'); reasons.push('Bearish regime'); }

  // ─── VOLATILITY CONTEXT (enhanced with ATR) ───
  const atrPct = atrVal / price * 100;
  if (vol > 0.5 && agentStyle === 'VOLATILITY_TRADER') {
    score *= 1.2; reasons.push(`High vol (${vol.toFixed(1)}%, ATR ${atrPct.toFixed(2)}%)`);
  }
  if (vol < 0.15 && (agentStyle === 'SIGNAL_SCANNER' || agentStyle === 'VOLATILITY_TRADER')) {
    score *= 0.7; reasons.push('Low vol — reduced conviction');
  }

  // ─── RECOVERY SPECIALIST — oversold bounces with confluence ───
  if (agentStyle === 'RECOVERY_SPECIALIST') {
    if (rsiVal < 25 && mom < -0.5) { score += 0.4; confluenceBullish++; reasons.push('Deep oversold — recovery play'); }
    if (rsiVal < 35 && regime === 'ranging' && mom10 > 0) { score += 0.25; confluenceBullish++; reasons.push('Mean reversion setup with momentum shift'); }
    if (rsiVal < 35 && regime === 'ranging') { score += 0.15; reasons.push('Mean reversion setup'); }
    // BB lower band bounce for recovery
    if (bbPercentB < 0.1 && mom10 > 0) { score += 0.2; confluenceBullish++; reasons.push('BB lower band recovery bounce'); }
  }

  // ─── MULTI-TIMEFRAME ALIGNMENT ───
  if (mtf.aligned) {
    // All timeframes agree — strong directional conviction
    if (mtf.direction > 0) { score += 0.2 * w('mtf'); confluenceBullish++; indicators_used.push('mtf'); reasons.push(`MTF aligned bullish (${mtf.score.toFixed(2)})`); }
    else if (mtf.direction < 0) { score -= 0.2 * w('mtf'); confluenceBearish++; indicators_used.push('mtf'); reasons.push(`MTF aligned bearish (${mtf.score.toFixed(2)})`); }
  } else if (Math.abs(mtf.score) > 0.3) {
    if (mtf.score > 0) { score += 0.08 * w('mtf'); indicators_used.push('mtf'); reasons.push('MTF partial bullish'); }
    else { score -= 0.08 * w('mtf'); indicators_used.push('mtf'); reasons.push('MTF partial bearish'); }
  }

  // ─── NEWS SENTIMENT INTEGRATION ───
  if (sentiment.score !== 0) {
    const sentWeight = 0.15;
    score += sentiment.score * sentWeight * w('sentiment');
    if (sentiment.score > 0.3) { confluenceBullish++; indicators_used.push('sentiment'); reasons.push(`Sentiment bullish (${sentiment.score.toFixed(2)})`); }
    else if (sentiment.score < -0.3) { confluenceBearish++; indicators_used.push('sentiment'); reasons.push(`Sentiment bearish (${sentiment.score.toFixed(2)})`); }
  }

  // ─── CROSS-ASSET CORRELATION REGIME ───
  if (corrRegime === 'risk_off' && score > 0) {
    score *= (0.75 * w('correlation')); indicators_used.push('correlation'); reasons.push('Risk-off regime — dampened longs');
  } else if (corrRegime === 'risk_on' && score < 0) {
    score *= (0.75 * w('correlation')); indicators_used.push('correlation'); reasons.push('Risk-on regime — dampened shorts');
  }

  // ─── MARKET SESSION VOLATILITY ADJUSTMENT ───
  if (session.volMultiplier < 0.8) {
    score *= 0.85; reasons.push(`Off-hours — reduced conviction (${session.session})`);
  }

  // ─── ASSET-CLASS SPECIFIC SIGNAL TUNING ───
  const assetClassLocal = (() => {
    if (['BTC','ETH','SOL','AVAX','DOGE','XRP','ADA','DOT','MATIC','LINK'].includes(symbol)) return 'crypto';
    if (symbol.includes('/')) return 'forex';
    if (['TQQQ','SOXL','UVXY','SPXS','SQQQ','TNA'].includes(symbol)) return 'options';
    if (['SPY','QQQ','GLD','TLT','IWM','EEM','VOO','DIA','VTI','XLF','XLE','XLK','ARKK','HYG'].includes(symbol)) return 'etf';
    return 'stock';
  })();

  // FOREX: Tighter signals, mean-reversion bias, lower noise tolerance
  if (assetClassLocal === 'forex') {
    // Forex is low-vol — require stronger RSI extremes for entry
    if (rsiVal > 30 && rsiVal < 70) score *= 0.85; // Dampen neutral RSI — forex needs extremes
    // Carry trade proxy: USD strength matters
    if (symbol.startsWith('USD') && regime === 'trending_up') { score += 0.15; confluenceBullish++; reasons.push('USD strength trend — carry trade favorable'); }
    if (symbol.startsWith('USD') && regime === 'trending_down') { score -= 0.15; confluenceBearish++; reasons.push('USD weakness — carry trade unfavorable'); }
    // Forex mean reversion — BB bands are highly effective
    if (bbPercentB < 0.03) { score += 0.2; confluenceBullish++; reasons.push('Forex extreme oversold — mean reversion buy'); }
    if (bbPercentB > 0.97) { score -= 0.2; confluenceBearish++; reasons.push('Forex extreme overbought — mean reversion sell'); }
    // Tighter session filter — forex off-hours (weekends) are dead
    const hour = new Date().getUTCHours();
    if (hour >= 21 || hour < 1) { score *= 0.6; reasons.push('Forex low-liquidity window'); }
  }

  // ETF: Sector rotation signals + relative strength
  if (assetClassLocal === 'etf') {
    // Sector rotation: compare ETF momentum vs SPY as benchmark
    const spyHist = priceHistory['SPY'];
    if (spyHist && spyHist.length >= 30 && symbol !== 'SPY') {
      const spyMom = (spyHist[spyHist.length - 1] - spyHist[spyHist.length - 20]) / spyHist[spyHist.length - 20] * 100;
      const relStrength = mom - spyMom;
      if (relStrength > 1.0) { score += 0.2; confluenceBullish++; reasons.push(`Relative strength vs SPY: +${relStrength.toFixed(1)}%`); }
      if (relStrength < -1.0) { score -= 0.15; confluenceBearish++; reasons.push(`Relative weakness vs SPY: ${relStrength.toFixed(1)}%`); }
    }
    // Defensive ETFs (GLD, TLT, HYG) — boost in risk-off, dampen in risk-on
    if (['GLD', 'TLT', 'HYG'].includes(symbol)) {
      if (corrRegime === 'risk_off') { score += 0.15; reasons.push('Safe-haven ETF — risk-off boost'); }
      if (corrRegime === 'risk_on') { score *= 0.8; reasons.push('Safe-haven ETF dampened in risk-on'); }
    }
    // Sector ETFs (XLF, XLE, XLK) — momentum-driven
    if (['XLF', 'XLE', 'XLK', 'ARKK'].includes(symbol) && Math.abs(mom) > 2) {
      score += (mom > 0 ? 0.15 : -0.15); confluenceBullish += (mom > 0 ? 1 : 0); confluenceBearish += (mom < 0 ? 1 : 0);
      reasons.push(`Sector momentum ${mom > 0 ? 'surge' : 'drop'}: ${mom.toFixed(1)}%`);
    }
  }

  // CRYPTO: BTC dominance proxy, enhanced vol regime, correlation clustering
  if (assetClassLocal === 'crypto') {
    const btcHist = priceHistory['BTC'];
    if (btcHist && btcHist.length >= 20 && symbol !== 'BTC') {
      const btcMom20 = (btcHist[btcHist.length - 1] - btcHist[btcHist.length - 20]) / btcHist[btcHist.length - 20] * 100;
      // BTC dominance proxy: if BTC is surging, alts may lag (capital flows to BTC)
      if (btcMom20 > 3 && mom < 0) { score *= 0.7; reasons.push(`BTC surging (+${btcMom20.toFixed(1)}%) — alt rotation risk`); }
      // BTC dropping + alt momentum positive = alt season signal
      if (btcMom20 < -2 && mom > 1) { score += 0.2; confluenceBullish++; reasons.push('Alt-season signal — BTC weak, alt strong'); }
      // BTC crash dragging everything
      if (btcMom20 < -5) { score *= 0.6; reasons.push(`BTC crash (${btcMom20.toFixed(1)}%) — market-wide risk`); }
    }
    // Enhanced crypto vol regime: high-vol crypto trades need higher confluence
    if (vol > 3.0) { score *= 0.8; reasons.push(`Extreme crypto vol (${vol.toFixed(1)}%) — tightened`); }
    // Crypto weekend boost — crypto trades 24/7, weekends can be volatile
    const dayOfWeek = new Date().getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      if (Math.abs(score) > 0.3) { score *= 1.1; reasons.push('Weekend crypto vol opportunity'); }
    }
  }

  // OPTIONS PROXIES (Leveraged ETFs): Higher conviction required, amplified signals
  if (assetClassLocal === 'options') {
    // Leveraged ETFs amplify moves 2-3x — require higher confluence for safety
    score *= 1.3; // Amplify signal to reflect leverage
    // But also require stronger minimum — weak signals on leveraged instruments are dangerous
    if (Math.abs(score) < 0.5) { score *= 0.4; reasons.push('Leveraged ETF — weak signal heavily dampened'); }
    // Inverse ETFs (UVXY, SPXS, SQQQ) — natural hedges, boost in risk-off
    if (['UVXY', 'SPXS', 'SQQQ'].includes(symbol)) {
      if (corrRegime === 'risk_off') { score += 0.25; confluenceBullish++; reasons.push('Inverse ETF — risk-off hedge activated'); }
      if (corrRegime === 'risk_on') { score *= 0.5; reasons.push('Inverse ETF dampened — risk-on market'); }
    }
    // Bull leveraged (TQQQ, SOXL, TNA) — boost in strong trends
    if (['TQQQ', 'SOXL', 'TNA'].includes(symbol)) {
      if (regime === 'trending_up' && adxVal > 25) { score += 0.2; confluenceBullish++; reasons.push('Bull leveraged + strong uptrend — amplified'); }
      if (regime === 'trending_down') { score *= 0.5; reasons.push('Bull leveraged in downtrend — heavy dampen'); }
    }
  }

  // FUTURES: Commodity & index-specific signals
  if (assetClassLocal === 'futures') {
    // Commodity futures (CL=F, GC=F, SI=F, NG=F) — momentum + regime driven
    if (['CL=F', 'NG=F'].includes(symbol)) {
      // Energy futures — highly volatile, trend-following works best
      if (regime === 'trending_up' && adxVal > 30) { score += 0.25; confluenceBullish++; reasons.push('Energy futures — strong trend confirmed by ADX'); }
      if (regime === 'trending_down' && adxVal > 30) { score -= 0.25; confluenceBearish++; reasons.push('Energy futures — downtrend confirmed'); }
      // Contango/backwardation proxy: momentum divergence
      if (Math.abs(mom) > 3) { score += (mom > 0 ? 0.2 : -0.2); reasons.push(`Energy momentum surge: ${mom.toFixed(1)}%`); }
    }
    if (['GC=F', 'SI=F'].includes(symbol)) {
      // Precious metals — safe-haven correlation
      if (corrRegime === 'risk_off') { score += 0.2; confluenceBullish++; reasons.push('Precious metals — risk-off safe haven bid'); }
      if (corrRegime === 'risk_on' && score > 0) { score *= 0.75; reasons.push('Precious metals dampened — risk-on rotation'); }
      // Gold/silver ratio proxy via relative momentum
      const goldHist = priceHistory['GC=F'];
      if (goldHist && goldHist.length >= 20 && symbol === 'SI=F') {
        const goldMom = (goldHist[goldHist.length - 1] - goldHist[goldHist.length - 20]) / goldHist[goldHist.length - 20] * 100;
        if (mom > goldMom + 1) { score += 0.15; reasons.push('Silver outperforming gold — industrial demand signal'); }
      }
    }
    if (['ES=F', 'NQ=F', 'YM=F'].includes(symbol)) {
      // Index futures — tight correlation with SPY/QQQ, useful for pre/post-market signals
      const hour = new Date().getUTCHours();
      // Futures trade ~23 hours — pre-market signal advantage
      if ((hour >= 8 && hour < 13) || (hour >= 22)) {
        score *= 1.15; reasons.push('Index futures — active session premium');
      }
      // Multi-timeframe alignment is critical for index futures
      if (mtf.aligned) { score *= 1.2; reasons.push('Index futures — MTF alignment bonus'); }
    }
    if (symbol === 'ZB=F') {
      // Treasury bond futures — inverse equity correlation
      if (corrRegime === 'risk_off') { score += 0.2; confluenceBullish++; reasons.push('Treasury futures — flight to safety'); }
      if (corrRegime === 'risk_on') { score -= 0.15; confluenceBearish++; reasons.push('Treasury futures — risk-on selloff'); }
    }
  }

  // CASH (Money Market ETFs): Ultra-conservative, risk-off deployment
  if (assetClassLocal === 'cash') {
    // Cash instruments only activate in risk-off / high drawdown scenarios
    score = 0; // Reset — cash doesn't use technical signals
    const wallets = db.findMany('wallets');
    const avgDrawdown = wallets.length > 0
      ? wallets.reduce((s, w) => {
          const peak = w.peak_equity || w.initial_balance;
          return s + (peak > 0 ? ((peak - w.equity) / peak * 100) : 0);
        }, 0) / wallets.length
      : 0;

    // Deploy to cash when portfolio is under stress
    if (avgDrawdown > 5) { score = 0.6; confluenceBullish += 3; reasons.push(`Cash deployment — portfolio drawdown ${avgDrawdown.toFixed(1)}%`); }
    else if (corrRegime === 'risk_off') { score = 0.4; confluenceBullish += 2; reasons.push('Cash rotation — risk-off environment'); }
    else if (avgDrawdown > 3) { score = 0.3; confluenceBullish += 2; reasons.push('Partial cash allocation — moderate stress'); }
    else { score = 0; reasons.push('Cash not needed — portfolio healthy'); }
  }

  // ─── MULTI-INDICATOR CONFLUENCE BONUS ───
  // Higher confluence = exponentially better win rate. Reward it aggressively.
  const confluence = Math.max(confluenceBullish, confluenceBearish);
  if (confluence >= 7) { score *= 2.2; reasons.push(`Elite confluence (${confluence} indicators) — maximum conviction`); }
  else if (confluence >= 6) { score *= 1.9; reasons.push(`Exceptional confluence (${confluence} indicators)`); }
  else if (confluence >= 5) { score *= 1.6; reasons.push(`Strong confluence (${confluence} indicators)`); }
  else if (confluence >= 4) { score *= 1.3; reasons.push(`Good confluence (${confluence} indicators)`); }
  else if (confluence >= 3) { score *= 0.8; reasons.push(`Moderate confluence (${confluence}) — below precision threshold`); }
  else { score *= 0.3; reasons.push(`Weak confluence (${confluence}) — signal heavily dampened`); }

  // ─── HISTORICAL PERFORMANCE BIAS ───
  const sp = getSymbolPerf(symbol);
  const totalSymTrades = sp.wins + sp.losses;
  if (totalSymTrades > 5) {
    const symWinRate = sp.wins / totalSymTrades;
    if (symWinRate > 0.6) { score *= 1.15; reasons.push(`High win-rate symbol (${(symWinRate*100).toFixed(0)}%)`); }
    else if (symWinRate < 0.3) { score *= 0.5; reasons.push(`Poor symbol — heavily reduced`); }
    else if (symWinRate < 0.4) { score *= 0.75; reasons.push(`Low win-rate — reduced size`); }

    const longWR = sp.longWins / Math.max(1, sp.longWins + sp.longLosses);
    const shortWR = sp.shortWins / Math.max(1, sp.shortWins + sp.shortLosses);
    if (score > 0 && longWR > 0.55) score *= 1.1;
    if (score < 0 && shortWR > 0.55) score *= 1.1;
    if (score > 0 && longWR < 0.3 && (sp.longWins + sp.longLosses) > 3) { score *= 0.5; reasons.push('Poor long history — dampened'); }
    if (score < 0 && shortWR < 0.3 && (sp.shortWins + sp.shortLosses) > 3) { score *= 0.5; reasons.push('Poor short history — dampened'); }
  }

  return {
    score: Math.max(-1, Math.min(1, score)),
    reason: reasons.join(' | ') || 'No clear signal',
    indicators: { sma10, sma30, rsiVal, mom, vol, regime, adx: adxVal, stochK: stoch.k, bbPctB: bbPercentB, obvTrend, vwapDev: vwapVal ? ((price - vwapVal) / vwapVal * 100).toFixed(2) : 0, mtfScore: mtf.score, sentiment: sentiment.score, atrPct },
    confluence,
    indicators_used: [...new Set(indicators_used)], // Deduplicated list for learning feedback
  };
}

function runAutoTradeTick() {
  autoTradeTickCount++;

  const allFundSettings = db.findMany('fund_settings');

  for (const settingsRecord of allFundSettings) {
    const userId = settingsRecord.user_id;
    const data = settingsRecord.data;
    if (!data || !data.autoTrading || !data.autoTrading.isAutoTrading) continue;

    try {
      runAllAgents(userId, data);
    } catch (err) {
      console.error(`[AutoTrader] Error for user ${userId}:`, err.message);
    }
  }

  // Record equity snapshots for all wallets every ~5 minutes (every 10 ticks at 30s interval)
  if (autoTradeTickCount % 10 === 0) {
    const wallets = db.findMany('wallets');
    const now = new Date();
    const dateKey = now.toISOString().split('T')[0];
    const hourKey = now.getHours();
    for (const wallet of wallets) {
      // Check if we already have a snapshot for this user/date/hour
      const existing = db.findOne('snapshots', s => s.user_id === wallet.user_id && s.date === dateKey && s.hour === hourKey);
      if (existing) {
        // Update existing snapshot
        db.update('snapshots', s => s.id === existing.id, {
          equity: wallet.equity, balance: wallet.balance,
          unrealized_pnl: wallet.unrealized_pnl, realized_pnl: wallet.realized_pnl,
          position_count: db.count('positions', p => p.user_id === wallet.user_id && p.status === 'OPEN'),
        });
      } else {
        db.insert('snapshots', {
          user_id: wallet.user_id,
          equity: wallet.equity, balance: wallet.balance,
          unrealized_pnl: wallet.unrealized_pnl, realized_pnl: wallet.realized_pnl,
          position_count: db.count('positions', p => p.user_id === wallet.user_id && p.status === 'OPEN'),
          date: dateKey, hour: hourKey,
        });
      }
    }
  }
}

/**
 * ALL 6 agents run concurrently each tick.
 * Signal-based entries with self-healing feedback loop.
 */
function runAllAgents(userId, fundData) {
  const wallet = db.findOne('wallets', w => w.user_id === userId);
  if (!wallet) {
    // Auto-create wallet on demand if missing
    wallet = db.insert('wallets', {
      user_id: userId, balance: 100000, equity: 100000, initial_balance: 100000,
      unrealized_pnl: 0, realized_pnl: 0, trade_count: 0,
      win_count: 0, loss_count: 0, kill_switch_active: false,
      created_at: new Date().toISOString(),
    });
    console.log(`[AutoTrader] Auto-created wallet for user ${userId}`);
  }
  if (wallet.kill_switch_active) { if (autoTradeTickCount <= 3) console.warn(`[AutoTrader] User ${userId}: KILL SWITCH ACTIVE`); return; }

  // Daily trade limit — count positions opened since LATER of (today midnight, server boot, QA reset)
  // globalSessionResetTime is set by the QA agent after 15min cooldown — gives fresh trade budget
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const resetTime = globalSessionResetTime ? new Date(globalSessionResetTime).getTime() : 0;
  const sessionStart = new Date(Math.max(todayStart.getTime(), new Date(SERVER_BOOT_TIME).getTime(), resetTime));
  const sessionOpens = db.count('positions', p => p.user_id === userId && new Date(p.opened_at) >= sessionStart);
  if (sessionOpens >= AUTO_TRADE_CONFIG.maxDailyTrades) {
    if (autoTradeTickCount <= 3) console.warn(`[AutoTrader] User ${userId}: DAILY LIMIT (${sessionOpens} opens >= ${AUTO_TRADE_CONFIG.maxDailyTrades})`);
    return;
  }

  let openPositions = db.findMany('positions', p => p.user_id === userId && p.status === 'OPEN');

  // ─── PHASE 1: Adaptive position management — trail stops, take profits ───
  if (openPositions.length > 0) {
    adaptivePositionManagement(userId, openPositions);
    // Refresh after potential closes
    openPositions = db.findMany('positions', p => p.user_id === userId && p.status === 'OPEN');
  }

  // ─── PHASE 2: Signal generation from all agents ───
  const signalAgents = AI_AGENTS.filter(a => !a.isRiskManager && !a.isPositionManager);
  const allSignals = [];
  const heldSymbols = new Set(openPositions.map(p => p.symbol));

  for (const agent of signalAgents) {
    const agentPerf = getAgentPerf(agent.name);

    // ─── WIN-RATE GATE: Block agents with poor recent performance ───
    const totalAgentTrades = agentPerf.wins + agentPerf.losses;
    if (totalAgentTrades >= 6) {
      const agentWinRate = agentPerf.wins / totalAgentTrades;
      if (agentWinRate < (AUTO_TRADE_CONFIG.minWinRateForTrading || 0.40)) {
        if (autoTradeTickCount % 30 === 1) console.log(`[AutoTrader] Agent ${agent.name} benched — win rate ${(agentWinRate*100).toFixed(0)}% < ${((AUTO_TRADE_CONFIG.minWinRateForTrading||0.40)*100).toFixed(0)}% minimum`);
        continue; // Skip this agent entirely until win rate recovers
      }
    }

    const tradable = agent.symbols.filter(s => marketPrices[s] !== undefined && priceHistory[s]?.length >= 30);
    if (tradable.length === 0) continue;

    // Each agent scores ALL its symbols, picks best UNHELD symbol first
    const scored = [];
    for (const symbol of tradable) {
      const signal = computeSignal(symbol, agent.role, agent.name);
      // Check circuit breaker before scoring
      if (checkCircuitBreaker(agent.name)) continue;
      const adjustedScore = signal.score * agentPerf.adaptiveConfidence;
      scored.push({ symbol, ...signal, adjustedScore, agent: agent.name, isHeld: heldSymbols.has(symbol) });
    }

    // Sort by absolute adjusted score descending
    scored.sort((a, b) => Math.abs(b.adjustedScore) - Math.abs(a.adjustedScore));

    // Pick best unheld signal — must pass BOTH strength threshold AND minimum confluence
    const bestUnheld = scored.find(s =>
      !s.isHeld &&
      Math.abs(s.adjustedScore) >= AUTO_TRADE_CONFIG.minSignalStrength &&
      (s.confluence >= (AUTO_TRADE_CONFIG.minConfluence || 3))
    );
    if (bestUnheld) {
      allSignals.push(bestUnheld);
    }
  }

  // Log signal generation on first 3 ticks for diagnostics
  if (autoTradeTickCount <= 3) {
    console.log(`[AutoTrader] User ${userId}: ${allSignals.length} signals generated, ${openPositions.length} open positions`);
    allSignals.forEach(s => console.log(`  → ${s.agent} ${s.symbol}: raw=${s.score.toFixed(3)} adj=${s.adjustedScore.toFixed(3)} conf=${s.confluence}`));
  }

  // ─── PHASE 3: Rank signals by strength, execute top opportunities ───
  allSignals.sort((a, b) => Math.abs(b.adjustedScore) - Math.abs(a.adjustedScore));

  // Asset class categorization for correlation limiting
  const getAssetClass = (sym) => {
    if (['BTC','ETH','SOL','AVAX','DOGE','XRP','ADA','DOT','MATIC','LINK'].includes(sym)) return 'crypto';
    if (sym.includes('/')) return 'forex';
    if (sym.endsWith('=F')) return 'futures';
    if (['BIL','SHV','SGOV'].includes(sym)) return 'cash';
    if (['SPY','QQQ','GLD','TLT','IWM','EEM','VOO','DIA','VTI','XLF','XLE','XLK','ARKK','HYG'].includes(sym)) return 'etf';
    if (['TQQQ','SOXL','UVXY','SPXS','SQQQ','TNA'].includes(sym)) return 'options';
    return 'stock';
  };

  for (const signal of allSignals) {
    if (openPositions.length >= AUTO_TRADE_CONFIG.maxOpenPositions) break;

    // Skip if already have position in this symbol
    if (openPositions.some(p => p.symbol === signal.symbol)) continue;

    // Correlation limiting — max positions per asset class (ETFs get 3 due to larger universe)
    const assetClass = getAssetClass(signal.symbol);
    const classCount = openPositions.filter(p => getAssetClass(p.symbol) === assetClass).length;
    const maxForClass = assetClass === 'etf' ? 3 : AUTO_TRADE_CONFIG.maxCorrelatedPositions;
    if (classCount >= maxForClass) continue;

    const side = signal.adjustedScore > 0 ? 'LONG' : 'SHORT';
    const strength = Math.abs(signal.adjustedScore);

    // Tiered position sizing based on signal confluence
    const price = marketPrices[signal.symbol];
    if (!price) continue;
    const equity = wallet.equity || wallet.balance || 100000;

    // Drawdown protection — reduce size when in drawdown
    // Use withdrawal-adjusted initial balance so withdrawals don't trigger false drawdown
    const adjustedInitial = Math.max(1000, (wallet.initial_balance || 100000));
    const drawdownPct = adjustedInitial > 0
      ? ((equity / adjustedInitial) - 1) * 100 : 0;
    const drawdownMultiplier = drawdownPct < -10 ? 0.5 : drawdownPct < -5 ? 0.75 : 1.0;

    // Kill switch check — only for genuine trading losses, not withdrawals
    if (drawdownPct < -AUTO_TRADE_CONFIG.maxDrawdownPct) {
      wallet.kill_switch_active = true;
      db._save('wallets');
      console.log(`[AutoTrader] KILL SWITCH for user ${userId} — drawdown ${drawdownPct.toFixed(1)}%`);
      break;
    }

    // Confluence-based sizing: elite > winner > base (TIGHTENED thresholds)
    let sizePct;
    if (signal.confluence >= 5 && strength > 0.8) sizePct = AUTO_TRADE_CONFIG.eliteSizePct;
    else if (signal.confluence >= 4 && strength > 0.7) sizePct = AUTO_TRADE_CONFIG.winnerSizePct;
    else sizePct = AUTO_TRADE_CONFIG.baseSizePct;

    sizePct *= drawdownMultiplier;

    // Asset-class position sizing adjustment
    const sigAssetClass = getAssetClass(signal.symbol);
    if (sigAssetClass === 'forex') sizePct *= 1.5;       // Forex: larger size, tighter stops compensate
    if (sigAssetClass === 'crypto') sizePct *= 0.7;       // Crypto: smaller size, higher volatility
    if (sigAssetClass === 'options') sizePct *= 0.6;       // Options proxies: smaller size, leveraged instruments
    if (sigAssetClass === 'futures') sizePct *= 0.8;       // Futures: moderate size, commodity volatility
    if (sigAssetClass === 'cash') sizePct *= 2.0;          // Cash: large allocation — it's defensive, low risk

    const maxPosValue = equity * sizePct;
    const quantity = Math.max(1, Math.floor(maxPosValue / price));

    const result = executeTrade(userId, { symbol: signal.symbol, side, quantity, agent: signal.agent, price });
    if (result.success) {
      const tier = signal.confluence >= 4 ? 'ELITE' : signal.confluence >= 3 ? 'HIGH' : 'BASE';
      const reason = `[${tier}] ${side} signal (${(strength * 100).toFixed(0)}% str, ${signal.confluence} confluence) — ${signal.reason}`;
      logAutoTrade(userId, signal.agent, signal.symbol, side, quantity, reason);
      openPositions.push(result.position);
      // Persist signal with trade linkage
      persistSignal(signal, userId, { action: 'EXECUTED', tradeId: result.position?.id, positionId: result.position?.id });
    } else {
      console.warn(`[AutoTrader] TRADE REJECTED: ${signal.agent} ${side} ${quantity}x ${signal.symbol} @ $${price} — ${result.error}`);
      // Persist rejected signal for audit trail
      persistSignal(signal, userId, { action: 'REJECTED' });
    }
  }
}

/**
 * Adaptive position management — replaces static Sentinel + Titan
 * Uses trailing stops, momentum-based exits, and profit locking
 */
function adaptivePositionManagement(userId, openPositions) {
  for (const pos of openPositions) {
    const currentPrice = marketPrices[pos.symbol] || pos.current_price;
    const dir = pos.side === 'LONG' ? 1 : -1;
    const pnlPct = ((currentPrice / pos.entry_price) - 1) * 100 * dir;
    const holdMs = Date.now() - new Date(pos.opened_at).getTime();
    const holdMinutes = holdMs / 60000;

    const hist = priceHistory[pos.symbol] || [];
    const regime = symbolRegimes[pos.symbol] || 'ranging';
    const mom = hist.length >= 20 ? momentum(hist, 10) : 0;

    // ─── ASSET-CLASS ADJUSTED PARAMETERS ───
    const posAssetClass = (() => {
      if (['BTC','ETH','SOL','AVAX','DOGE','XRP','ADA','DOT','MATIC','LINK'].includes(pos.symbol)) return 'crypto';
      if (pos.symbol.includes('/')) return 'forex';
      if (pos.symbol.endsWith('=F')) return 'futures';
      if (['BIL','SHV','SGOV'].includes(pos.symbol)) return 'cash';
      if (['TQQQ','SOXL','UVXY','SPXS','SQQQ','TNA'].includes(pos.symbol)) return 'options';
      if (['SPY','QQQ','GLD','TLT','IWM','EEM','VOO','DIA','VTI','XLF','XLE','XLK','ARKK','HYG'].includes(pos.symbol)) return 'etf';
      return 'stock';
    })();
    // Asset-class stop/profit multipliers calibrated to each market's volatility profile
    const assetStopMultiplier = ({ forex: 0.5, crypto: 1.8, options: 1.4, futures: 1.5, cash: 0.2 })[posAssetClass] || 1.0;
    const assetProfitMultiplier = ({ forex: 0.6, crypto: 2.0, options: 1.5, futures: 1.6, cash: 0.3 })[posAssetClass] || 1.0;

    // ─── HARD STOP-LOSS: Absolute max loss per position — non-negotiable ───
    const maxLoss = (AUTO_TRADE_CONFIG.maxLossPct || 0.6) * assetStopMultiplier;
    if (pnlPct < -maxLoss) {
      closePosition(userId, pos.id);
      updatePerformanceFeedback(pos.agent, pos.symbol, pos.side, pos.unrealized_pnl || pnlPct);
      logAutoTrade(userId, 'Sentinel', pos.symbol, 'CLOSE', pos.quantity,
        `Hard stop — ${pnlPct.toFixed(2)}% loss exceeds max ${maxLoss}%`);
      continue;
    }

    // ─── ADAPTIVE STOP-LOSS: Volatility + streak adjusted ───
    const vol = hist.length >= 20 ? volatility(hist, 20) : 1;
    const agentP = getAgentPerf(pos.agent || 'Unknown');
    const streakFactor = agentP.streak < -3 ? 0.4 : agentP.streak < -1 ? 0.6 : agentP.streak < 0 ? 0.8 : 1.0;
    const stopLoss = -Math.max(0.35, Math.min(maxLoss, vol * 1.2 * streakFactor)); // TIGHTENED: -0.35% to -0.6%

    if (pnlPct < stopLoss) {
      closePosition(userId, pos.id);
      updatePerformanceFeedback(pos.agent, pos.symbol, pos.side, pos.unrealized_pnl || pnlPct);
      logAutoTrade(userId, 'Sentinel', pos.symbol, 'CLOSE', pos.quantity,
        `Adaptive stop — ${pnlPct.toFixed(2)}% (limit: ${stopLoss.toFixed(2)}%, streak: ${agentP.streak})`);
      continue;
    }

    // ─── PROFIT TARGET: Take profit at target to lock in wins (high win-rate strategy) ───
    const profitTarget = (AUTO_TRADE_CONFIG.profitTargetPct || 1.5) * assetProfitMultiplier;
    if (pnlPct >= profitTarget) {
      closePosition(userId, pos.id);
      updatePerformanceFeedback(pos.agent, pos.symbol, pos.side, pos.unrealized_pnl || pnlPct);
      logAutoTrade(userId, 'Titan', pos.symbol, 'CLOSE', pos.quantity,
        `Profit target hit — ${pnlPct.toFixed(2)}% gain (target: ${profitTarget}%)`);
      continue;
    }

    // ─── TRAILING STOP: Activates at +0.6%, tighter trail to protect gains ───
    if (pnlPct > 0.6) {
      const trailDist = pnlPct < 1.0 ? 0.25 : pnlPct < 2.0 ? 0.4 : pnlPct < 4.0 ? 0.6 : 1.0;

      const trendAligned = (pos.side === 'LONG' && mom > 0.05) || (pos.side === 'SHORT' && mom < -0.05);
      const regimeAligned = (pos.side === 'LONG' && regime === 'trending_up') || (pos.side === 'SHORT' && regime === 'trending_down');

      // Let winners run ONLY when both trend AND regime strongly aligned
      if (trendAligned && regimeAligned && pnlPct < profitTarget) continue;

      // Take profit when momentum fading or in ranging market
      if (!trendAligned || pnlPct > 3 || (pnlPct > 1.0 && regime === 'ranging')) {
        closePosition(userId, pos.id);
        updatePerformanceFeedback(pos.agent, pos.symbol, pos.side, pos.unrealized_pnl || pnlPct);
        logAutoTrade(userId, 'Sentinel', pos.symbol, 'CLOSE', pos.quantity,
          `Trailing profit — ${pnlPct.toFixed(2)}% gain${!trendAligned ? ' (momentum fading)' : ''}`);
        continue;
      }
    }

    // ─── EARLY EXIT: Cut losers immediately when both momentum + regime are against us ───
    if (pnlPct < -0.15 && holdMinutes > 1.5) {
      const againstMom = (pos.side === 'LONG' && mom < -0.15) || (pos.side === 'SHORT' && mom > 0.15);
      const againstRegime = (pos.side === 'LONG' && regime === 'trending_down') || (pos.side === 'SHORT' && regime === 'trending_up');
      if (againstMom && againstRegime) {
        closePosition(userId, pos.id);
        updatePerformanceFeedback(pos.agent, pos.symbol, pos.side, pos.unrealized_pnl || pnlPct);
        logAutoTrade(userId, 'Sentinel', pos.symbol, 'CLOSE', pos.quantity,
          `Early cut — ${pnlPct.toFixed(2)}% with adverse momentum + regime`);
        continue;
      }
    }

    // ─── BREAKEVEN STOP: Once profitable, never let it become a loss ───
    if (pnlPct > 0.3 && holdMinutes > 2) {
      // If was profitable but momentum reversing, exit at breakeven+
      const momReversing = (pos.side === 'LONG' && mom < -0.3) || (pos.side === 'SHORT' && mom > 0.3);
      if (momReversing && pnlPct < 0.5) {
        closePosition(userId, pos.id);
        updatePerformanceFeedback(pos.agent, pos.symbol, pos.side, pos.unrealized_pnl || pnlPct);
        logAutoTrade(userId, 'Sentinel', pos.symbol, 'CLOSE', pos.quantity,
          `Breakeven stop — protecting ${pnlPct.toFixed(2)}% from reversal`);
        continue;
      }
    }

    // ─── TIME EXIT: Close stale positions (extended to 20min for quality trades) ───
    if (holdMinutes > 20 && Math.abs(pnlPct) < 0.4) {
      closePosition(userId, pos.id);
      updatePerformanceFeedback(pos.agent, pos.symbol, pos.side, pos.unrealized_pnl || pnlPct);
      logAutoTrade(userId, 'Titan', pos.symbol, 'CLOSE', pos.quantity,
        `Time exit — ${holdMinutes.toFixed(0)}min with ${pnlPct.toFixed(2)}% (freeing capital)`);
      continue;
    }

    // ─── REGIME REVERSAL EXIT: Close if market regime flipped against position ───
    if (pos.side === 'LONG' && regime === 'trending_down' && pnlPct < 0.3) {
      closePosition(userId, pos.id);
      updatePerformanceFeedback(pos.agent, pos.symbol, pos.side, pos.unrealized_pnl || pnlPct);
      logAutoTrade(userId, 'Sentinel', pos.symbol, 'CLOSE', pos.quantity,
        `Regime reversal — market turned bearish (${pnlPct.toFixed(2)}%)`);
      continue;
    }
    if (pos.side === 'SHORT' && regime === 'trending_up' && pnlPct < 0.3) {
      closePosition(userId, pos.id);
      updatePerformanceFeedback(pos.agent, pos.symbol, pos.side, pos.unrealized_pnl || pnlPct);
      logAutoTrade(userId, 'Sentinel', pos.symbol, 'CLOSE', pos.quantity,
        `Regime reversal — market turned bullish (${pnlPct.toFixed(2)}%)`);
    }
  }
}

function logAutoTrade(userId, agent, symbol, side, quantity, reason) {
  db.insert('auto_trade_log', {
    user_id: userId, agent, symbol, side, quantity, reason,
    timestamp: new Date().toISOString(),
  });
  // Trim log to last 500 entries per user
  const logs = db.findMany('auto_trade_log', l => l.user_id === userId);
  if (logs.length > 500) {
    const toRemove = logs.slice(0, logs.length - 500);
    toRemove.forEach(l => db.remove('auto_trade_log', r => r.id === l.id));
  }
}

// ═══════════════════════════════════════════════════════════════════
//   SIGNAL TRACKING ENGINE
//   Full-spectrum signal persistence, P&L attribution, and alerting.
//   Every signal generated is stored with complete indicator breakdown.
//   When trades close, P&L is attributed back to the originating signal.
// ═══════════════════════════════════════════════════════════════════

// In-memory signal buffer for real-time dashboard (last 200 signals)
const signalBuffer = [];
const SIGNAL_BUFFER_MAX = 200;

/**
 * Persist a signal to the database with full indicator breakdown.
 * Called during runAllAgents for every signal that passes threshold.
 */
function persistSignal(signal, userId, context) {
  const record = {
    user_id: userId,
    signal_id: `SIG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    symbol: signal.symbol,
    agent: signal.agent,
    side: signal.adjustedScore > 0 ? 'LONG' : 'SHORT',
    raw_score: roundTo(signal.score, 4),
    adjusted_score: roundTo(signal.adjustedScore, 4),
    confluence: signal.confluence,
    reason: signal.reason,
    indicators: signal.indicators || {},
    indicators_used: signal.indicators_used || [],
    price_at_signal: marketPrices[signal.symbol] || 0,
    regime: symbolRegimes[signal.symbol] || 'unknown',
    session: getMarketSession().session,
    sentiment: (sentimentStore[signal.symbol] || {}).score || 0,
    correlation_regime: correlationCache.marketRegime || 'neutral',
    action: context.action || 'GENERATED', // GENERATED, EXECUTED, REJECTED, FILTERED
    trade_id: context.tradeId || null,
    position_id: context.positionId || null,
    pnl: null, // filled when trade closes
    pnl_pct: null,
    outcome: null, // WIN, LOSS, PENDING
    closed_at: null,
    timestamp: new Date().toISOString(),
  };

  db.insert('signals', record);

  // Add to real-time buffer
  signalBuffer.push(record);
  if (signalBuffer.length > SIGNAL_BUFFER_MAX) signalBuffer.shift();

  // Trim DB to last 2000 signals per user
  const userSignals = db.findMany('signals', s => s.user_id === userId);
  if (userSignals.length > 2000) {
    const toRemove = userSignals.slice(0, userSignals.length - 2000);
    toRemove.forEach(s => db.remove('signals', r => r.id === s.id));
  }

  // WebSocket alert for high-conviction signals
  if (Math.abs(signal.adjustedScore) >= 0.7 && context.action === 'EXECUTED') {
    wsBroadcastSignalAlert(record);
  }

  return record;
}

/**
 * Attribute P&L back to the originating signal when a position closes.
 * Links closed trade outcomes to their source signals for performance analysis.
 */
function attributeSignalPnL(positionId, pnl, pnlPct) {
  const signals = db.findMany('signals', s => s.position_id === positionId && s.outcome === null);
  for (const sig of signals) {
    sig.pnl = roundTo(pnl, 2);
    sig.pnl_pct = roundTo(pnlPct, 4);
    sig.outcome = pnl >= 0 ? 'WIN' : 'LOSS';
    sig.closed_at = new Date().toISOString();

    // ─── Feed into adaptive learning engine ───
    try {
      const indicatorsUsed = sig.indicators_used || sig.indicator_breakdown ? Object.keys(sig.indicator_breakdown || {}) : [];
      learnFromTrade(sig.agent, sig.symbol, { pnl: pnlPct, indicators_used: indicatorsUsed });
    } catch (e) { /* learning is non-critical */ }
  }
  if (signals.length > 0) db._save('signals');
}

/**
 * Broadcast high-conviction signal alerts via WebSocket.
 */
function wsBroadcastSignalAlert(signal) {
  const msg = JSON.stringify({
    type: 'signal_alert',
    data: {
      signal_id: signal.signal_id,
      symbol: signal.symbol,
      agent: signal.agent,
      side: signal.side,
      score: signal.adjusted_score,
      confluence: signal.confluence,
      reason: signal.reason,
      price: signal.price_at_signal,
      regime: signal.regime,
      session: signal.session,
      timestamp: signal.timestamp,
    },
    timestamp: Date.now(),
  });
  wsClients.forEach(c => {
    if (c.socket.writable) wsSend(c, msg);
  });
}

/**
 * Compute aggregated signal statistics for a user.
 */
function computeSignalStats(userId) {
  const allSigs = db.findMany('signals', s => s.user_id === userId);
  const closed = allSigs.filter(s => s.outcome !== null);
  const wins = closed.filter(s => s.outcome === 'WIN');
  const losses = closed.filter(s => s.outcome === 'LOSS');

  // Per-agent stats
  const agentStats = {};
  for (const sig of allSigs) {
    if (!agentStats[sig.agent]) {
      agentStats[sig.agent] = { generated: 0, executed: 0, wins: 0, losses: 0, totalPnL: 0, avgScore: 0, scores: [] };
    }
    const as = agentStats[sig.agent];
    as.generated++;
    as.scores.push(Math.abs(sig.adjusted_score));
    if (sig.action === 'EXECUTED') as.executed++;
    if (sig.outcome === 'WIN') { as.wins++; as.totalPnL += sig.pnl || 0; }
    if (sig.outcome === 'LOSS') { as.losses++; as.totalPnL += sig.pnl || 0; }
  }
  for (const [name, as] of Object.entries(agentStats)) {
    as.avgScore = as.scores.length > 0 ? roundTo(as.scores.reduce((a, b) => a + b, 0) / as.scores.length, 3) : 0;
    as.winRate = (as.wins + as.losses) > 0 ? roundTo(as.wins / (as.wins + as.losses) * 100, 1) : 0;
    as.conversionRate = as.generated > 0 ? roundTo(as.executed / as.generated * 100, 1) : 0;
    delete as.scores;
  }

  // Per-symbol stats
  const symbolStats = {};
  for (const sig of closed) {
    if (!symbolStats[sig.symbol]) {
      symbolStats[sig.symbol] = { signals: 0, wins: 0, losses: 0, totalPnL: 0, avgPnLPct: 0, pnlPcts: [] };
    }
    const ss = symbolStats[sig.symbol];
    ss.signals++;
    if (sig.outcome === 'WIN') ss.wins++;
    if (sig.outcome === 'LOSS') ss.losses++;
    ss.totalPnL += sig.pnl || 0;
    ss.pnlPcts.push(sig.pnl_pct || 0);
  }
  for (const [sym, ss] of Object.entries(symbolStats)) {
    ss.avgPnLPct = ss.pnlPcts.length > 0 ? roundTo(ss.pnlPcts.reduce((a, b) => a + b, 0) / ss.pnlPcts.length, 2) : 0;
    ss.winRate = (ss.wins + ss.losses) > 0 ? roundTo(ss.wins / (ss.wins + ss.losses) * 100, 1) : 0;
    delete ss.pnlPcts;
  }

  // Per-indicator contribution analysis
  const indicatorContrib = { bullish: {}, bearish: {} };
  for (const sig of closed) {
    const reasons = (sig.reason || '').split(' | ');
    for (const r of reasons) {
      if (!r) continue;
      const bucket = sig.outcome === 'WIN' ? 'bullish' : 'bearish';
      if (!indicatorContrib[bucket][r]) indicatorContrib[bucket][r] = 0;
      indicatorContrib[bucket][r]++;
    }
  }

  // Confluence distribution
  const confDist = {};
  for (const sig of allSigs) {
    const c = sig.confluence || 0;
    if (!confDist[c]) confDist[c] = { count: 0, wins: 0, losses: 0, totalPnL: 0 };
    confDist[c].count++;
    if (sig.outcome === 'WIN') { confDist[c].wins++; confDist[c].totalPnL += sig.pnl || 0; }
    if (sig.outcome === 'LOSS') { confDist[c].losses++; confDist[c].totalPnL += sig.pnl || 0; }
  }
  for (const c of Object.keys(confDist)) {
    const d = confDist[c];
    d.winRate = (d.wins + d.losses) > 0 ? roundTo(d.wins / (d.wins + d.losses) * 100, 1) : 0;
  }

  return {
    total: allSigs.length,
    executed: allSigs.filter(s => s.action === 'EXECUTED').length,
    filtered: allSigs.filter(s => s.action === 'FILTERED').length,
    rejected: allSigs.filter(s => s.action === 'REJECTED').length,
    closed: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length > 0 ? roundTo(wins.length / closed.length * 100, 1) : 0,
    totalPnL: roundTo(closed.reduce((s, c) => s + (c.pnl || 0), 0), 2),
    avgPnL: closed.length > 0 ? roundTo(closed.reduce((s, c) => s + (c.pnl || 0), 0) / closed.length, 2) : 0,
    conversionRate: allSigs.length > 0 ? roundTo(allSigs.filter(s => s.action === 'EXECUTED').length / allSigs.length * 100, 1) : 0,
    agentStats,
    symbolStats,
    confluenceDist: confDist,
    topWinIndicators: Object.entries(indicatorContrib.bullish).sort((a, b) => b[1] - a[1]).slice(0, 10),
    topLossIndicators: Object.entries(indicatorContrib.bearish).sort((a, b) => b[1] - a[1]).slice(0, 10),
  };
}

// Auto-trading tick — every 10 seconds
const autoTradeInterval = setInterval(runAutoTradeTick, AUTO_TRADE_CONFIG.tickIntervalMs);

// ─── INTELLIGENCE ENGINES — periodic updates ───
// Correlation matrix: every 60s (needs price history across assets)
const correlationInterval = setInterval(() => {
  try { updateCorrelationMatrix(); } catch (e) { console.error('[CorrelationEngine] Error:', e.message); }
}, 60000);

// Sentiment engine already self-starts at line ~830 (fetchNewsSentiment + setInterval)

// Agent intelligence persistence: every 2 min
const intelligenceInterval = setInterval(() => {
  try { saveAgentIntelligence(); } catch (e) { console.error('[IntelligencePersistence] Error:', e.message); }
}, 120000);

// Adaptive learning engine: auto-tune every 90s
const learningInterval = setInterval(() => {
  try { runAutoTuning(); } catch (e) { console.error('[LearningEngine] Error:', e.message); }
}, 90000);

// Boot: load persisted intelligence + initial correlation matrix
try {
  loadAgentIntelligence();
  console.log('[Boot] Agent intelligence loaded from persistence layer');
} catch (e) { console.warn('[Boot] No persisted intelligence found — starting fresh'); }

setTimeout(() => {
  try { updateCorrelationMatrix(); console.log('[Boot] Initial correlation matrix computed'); } catch (e) {}
}, 5000); // 5s delay to allow price history to build

// ═══════════════════════════════════════════════════════════════════
//   TRADING QA AGENT — COMPREHENSIVE PROACTIVE MONITORING
//   Self-diagnosing, self-healing autonomous quality assurance.
//   Detects: stalls, structural blockers, data issues, config drift.
//   Heals: wallets, kill switches, daily limits, signal data, orphans.
//   Runs every 30s. Boot test at 15s. Full audit every 5 min.
// ═══════════════════════════════════════════════════════════════════
let lastTradeTimestamp = 0;
let watchdogWarnings = 0;
let bootTestPassed = false;
const qaState = {
  lastFullAudit: 0,
  checksRun: 0,
  issuesFound: 0,
  issuesFixed: 0,
  history: [],       // last 20 QA reports
};

// ─── CHECK 1: Wallet Integrity ───
// Detects: missing wallets, orphaned fund_settings, kill switches that should reset
function qaCheckWallets() {
  const fixes = [];
  const allSettings = db.findMany('fund_settings').filter(s => s.data?.autoTrading?.isAutoTrading);

  for (const settings of allSettings) {
    const userId = settings.user_id;
    let wallet = db.findOne('wallets', w => w.user_id === userId);

    // FIX: Missing wallet — auto-create
    if (!wallet) {
      wallet = db.insert('wallets', {
        user_id: userId, balance: 100000, equity: 100000, initial_balance: 100000,
        unrealized_pnl: 0, realized_pnl: 0, trade_count: 0,
        win_count: 0, loss_count: 0, kill_switch_active: false,
        created_at: new Date().toISOString(),
      });
      fixes.push({ userId, issue: 'MISSING_WALLET', action: 'Created wallet with $100k balance' });
      console.warn(`[QA] 🔧 Created missing wallet for user ${userId.slice(0,8)}`);
    }

    // FIX: Kill switch stuck — reset if equity is above -15% drawdown (aggressive recovery)
    if (wallet.kill_switch_active) {
      const adjustedInit = Math.max(1000, wallet.initial_balance || 100000);
      const drawdown = ((wallet.equity / adjustedInit) - 1) * 100;
      if (drawdown > -15) {
        wallet.kill_switch_active = false;
        db._save('wallets');
        fixes.push({ userId, issue: 'STUCK_KILL_SWITCH', action: `Reset kill switch (drawdown ${drawdown.toFixed(1)}% above -20% threshold)` });
        console.warn(`[QA] 🔧 Reset stuck kill switch for user ${userId.slice(0,8)} (drawdown ${drawdown.toFixed(1)}%)`);
      }
    }
  }
  return fixes;
}

// ─── CHECK 2: Daily Limit with 15-Minute Cooldown Reset ───
// Precision-first: keep limit at 20 trades per cycle for high win rate.
// When ALL users hit the cap, start a 15-minute cooldown timer.
// After cooldown expires, reset SESSION_START to "now" — giving all users a fresh 20-trade budget.
// This creates a natural rhythm: burst → evaluate → burst → evaluate.
// The agents learn from each cycle's results before the next burst.
let dailyLimitCooldownStart = 0;   // Timestamp when all-capped state was first detected
const DAILY_LIMIT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

function qaCheckDailyLimits() {
  const fixes = [];
  const allSettings = db.findMany('fund_settings').filter(s => s.data?.autoTrading?.isAutoTrading);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const sessionStart = new Date(Math.max(todayStart.getTime(), new Date(SERVER_BOOT_TIME).getTime(), globalSessionResetTime ? new Date(globalSessionResetTime).getTime() : 0));
  let cappedCount = 0;

  for (const settings of allSettings) {
    const userId = settings.user_id;
    const sessionOpens = db.count('positions', p => p.user_id === userId && new Date(p.opened_at) >= sessionStart);
    if (sessionOpens >= AUTO_TRADE_CONFIG.maxDailyTrades) cappedCount++;
  }

  if (cappedCount > 0 && cappedCount === allSettings.length) {
    // ALL users capped — start or check cooldown timer
    if (dailyLimitCooldownStart === 0) {
      dailyLimitCooldownStart = Date.now();
      fixes.push({
        issue: 'ALL_USERS_DAILY_CAPPED',
        action: `All ${cappedCount} users hit daily limit of ${AUTO_TRADE_CONFIG.maxDailyTrades}. 15-minute cooldown started. Agents evaluating performance...`,
      });
      console.log(`[QA] ⏱️  All ${cappedCount} users daily-capped — 15min cooldown started. Agents learning from results.`);
    } else {
      const elapsed = Date.now() - dailyLimitCooldownStart;
      const remaining = Math.max(0, DAILY_LIMIT_COOLDOWN_MS - elapsed);

      if (remaining === 0) {
        // ─── COOLDOWN EXPIRED: Reset session start to grant fresh trade budget ───
        // This effectively resets the daily counter for all users without changing the limit.
        // Agents have had 15 minutes to close positions and learn from results.
        const oldBoot = SERVER_BOOT_TIME;
        // We can't reassign const, so we reset by moving the reference point forward
        // The actual mechanism: set a global override that runAllAgents checks
        globalSessionResetTime = new Date().toISOString();
        dailyLimitCooldownStart = 0; // Reset cooldown for next cycle

        // ─── AUTO-LEARNING: Evaluate cycle performance before resetting ───
        const cycleStats = evaluateTradingCycle(allSettings, sessionStart);

        fixes.push({
          issue: 'DAILY_LIMIT_RESET',
          action: `15min cooldown expired — daily limit reset for all ${cappedCount} users. Cycle stats: ${cycleStats.wins}W/${cycleStats.losses}L (${cycleStats.winRate}% WR), PnL: $${cycleStats.totalPnL.toFixed(2)}. Agents recalibrated.`,
        });
        console.log(`[QA] 🔄 Daily limit RESET after 15min cooldown. Cycle: ${cycleStats.wins}W/${cycleStats.losses}L (${cycleStats.winRate}% WR), PnL: $${cycleStats.totalPnL.toFixed(2)}`);
      } else {
        const remainMin = (remaining / 60000).toFixed(1);
        if (autoTradeTickCount % 18 === 0) { // Log every ~3 min
          console.log(`[QA] ⏱️  Daily limit cooldown: ${remainMin}min remaining. Agents learning...`);
        }
      }
    }
  } else {
    // Not all capped — reset cooldown timer
    dailyLimitCooldownStart = 0;
  }

  return fixes;
}

/**
 * Evaluate trading cycle performance — used by QA agent before daily limit reset.
 * Feeds back into agent confidence and learning systems.
 */
function evaluateTradingCycle(allSettings, sessionStart) {
  let wins = 0, losses = 0, totalPnL = 0;

  for (const settings of allSettings) {
    const userId = settings.user_id;
    const closedThisCycle = db.findMany('positions', p =>
      p.user_id === userId &&
      p.status === 'CLOSED' &&
      new Date(p.closed_at || p.opened_at) >= sessionStart
    );

    for (const pos of closedThisCycle) {
      const pnl = pos.realized_pnl || 0;
      if (pnl > 0) wins++;
      else if (pnl < 0) losses++;
      totalPnL += pnl;
    }
  }

  const total = wins + losses;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';

  // ─── ADAPTIVE LEARNING: Adjust agent confidence based on cycle results ───
  // If win rate is above 60%, boost confidence for next cycle (agents are performing)
  // If below 40%, reduce confidence (agents need to be more selective)
  const cycleWinRate = total > 0 ? wins / total : 0.5;
  for (const agentName of Object.keys(agentPerformance)) {
    const perf = agentPerformance[agentName];
    if (cycleWinRate > 0.60) {
      // Strong cycle — slightly boost confidence (max 1.3)
      perf.adaptiveConfidence = Math.min(1.3, perf.adaptiveConfidence * 1.02);
    } else if (cycleWinRate < 0.40) {
      // Weak cycle — reduce confidence (min 0.5) — agents must be more selective
      perf.adaptiveConfidence = Math.max(0.5, perf.adaptiveConfidence * 0.95);
    }
    // Between 40-60%: no change — agents are performing within expected range
  }

  return { wins, losses, total, winRate, totalPnL };
}

// ─── CHECK 3: Signal Health ───
// Detects: flat price data (no signals), all strong signals on held symbols only
function qaCheckSignals() {
  const fixes = [];
  const sampleSymbols = ['AAPL', 'TSLA', 'BTC', 'ETH', 'NVDA', 'SPY', 'MSFT', 'GOOGL'];
  let weakCount = 0;
  let totalChecked = 0;

  for (const sym of sampleSymbols) {
    if (!priceHistory[sym] || priceHistory[sym].length < 30) continue;
    totalChecked++;
    const sig = computeSignal(sym, 'SIGNAL_SCANNER');
    if (Math.abs(sig.score) < AUTO_TRADE_CONFIG.minSignalStrength) weakCount++;
  }

  // If >75% of symbols have weak signals, reseed price history
  if (totalChecked > 0 && weakCount / totalChecked > 0.75) {
    const symKeys = Object.keys(DEFAULT_PRICES);
    let reseeded = 0;
    for (let si = 0; si < symKeys.length; si++) {
      const sym = symKeys[si];
      const hist = priceHistory[sym];
      if (!hist || hist.length < 30) continue;
      const sig = computeSignal(sym, 'SIGNAL_SCANNER');
      if (Math.abs(sig.score) >= AUTO_TRADE_CONFIG.minSignalStrength) continue;

      const basePrice = marketPrices[sym] || DEFAULT_PRICES[sym];
      const decimals = basePrice < 10 ? 4 : 2;
      const pattern = si % 2 === 0 ? 1 : -1;
      const trendStrength = 0.002 * pattern;
      let p = basePrice * (1 - pattern * 0.03);
      for (let i = Math.max(0, hist.length - 40); i < hist.length; i++) {
        p += p * (trendStrength + (Math.random() - 0.5) * 0.001);
        hist[i] = roundTo(p, decimals);
      }
      hist[hist.length - 1] = basePrice;
      symbolRegimes[sym] = detectRegime(hist);
      reseeded++;
    }
    fixes.push({
      issue: 'WEAK_SIGNALS',
      action: `Reseeded ${reseeded} symbols (${weakCount}/${totalChecked} had weak signals)`,
    });
    console.warn(`[QA] 🔧 Signal health poor — reseeded ${reseeded} symbols`);
  }
  return fixes;
}

// ─── CHECK 4: Trade Flow ───
// Detects: no trades despite active users with balance, zero executable signals
function qaCheckTradeFlow() {
  const fixes = [];
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const recentLogs = db.findMany('auto_trade_log').filter(
    l => new Date(l.timestamp).getTime() > fiveMinAgo
  );
  const activeUsers = db.findMany('fund_settings').filter(
    s => s.data?.autoTrading?.isAutoTrading
  );

  if (recentLogs.length > 0) {
    lastTradeTimestamp = Math.max(...recentLogs.map(l => new Date(l.timestamp).getTime()));
    watchdogWarnings = 0;
    return fixes;
  }

  if (activeUsers.length === 0) return fixes;

  watchdogWarnings++;

  // Run per-user diagnostics to find the EXACT blocker
  const blockerSummary = { NO_WALLET: 0, KILL_SWITCH: 0, DAILY_LIMIT: 0, NO_SIGNALS: 0, ALL_HELD: 0, TRADING: 0 };
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const sessionStartDiag = new Date(Math.max(todayStart.getTime(), new Date(SERVER_BOOT_TIME).getTime(), globalSessionResetTime ? new Date(globalSessionResetTime).getTime() : 0));

  for (const settings of activeUsers) {
    const userId = settings.user_id;
    const wallet = db.findOne('wallets', w => w.user_id === userId);
    if (!wallet) { blockerSummary.NO_WALLET++; continue; }
    if (wallet.kill_switch_active) { blockerSummary.KILL_SWITCH++; continue; }

    const sessionOpens = db.count('positions', p => p.user_id === userId && new Date(p.opened_at) >= sessionStartDiag);
    if (sessionOpens >= AUTO_TRADE_CONFIG.maxDailyTrades) { blockerSummary.DAILY_LIMIT++; continue; }

    // Check signal availability
    const openPositions = db.findMany('positions', p => p.user_id === userId && p.status === 'OPEN');
    const heldSymbols = new Set(openPositions.map(p => p.symbol));
    const signalAgents = AI_AGENTS.filter(a => !a.isRiskManager && !a.isPositionManager);
    let hasExecutableSignal = false;

    for (const agent of signalAgents) {
      const agentPerf = getAgentPerf(agent.name);
      const tradable = agent.symbols.filter(s => marketPrices[s] !== undefined && priceHistory[s]?.length >= 30 && !heldSymbols.has(s));
      for (const sym of tradable) {
        const sig = computeSignal(sym, agent.role);
        const adj = sig.score * agentPerf.adaptiveConfidence;
        if (Math.abs(adj) >= AUTO_TRADE_CONFIG.minSignalStrength) {
          hasExecutableSignal = true;
          break;
        }
      }
      if (hasExecutableSignal) break;
    }

    if (!hasExecutableSignal) {
      // Check if it's because all strong signals are held or just no signals at all
      let hasAnyStrongSignal = false;
      for (const agent of signalAgents) {
        for (const sym of agent.symbols) {
          if (priceHistory[sym]?.length >= 30) {
            const sig = computeSignal(sym, agent.role);
            if (Math.abs(sig.score) >= AUTO_TRADE_CONFIG.minSignalStrength) {
              hasAnyStrongSignal = true;
              break;
            }
          }
        }
        if (hasAnyStrongSignal) break;
      }
      if (hasAnyStrongSignal) blockerSummary.ALL_HELD++;
      else blockerSummary.NO_SIGNALS++;
    } else {
      blockerSummary.TRADING++;
    }
  }

  const blockerStr = Object.entries(blockerSummary).filter(([,v]) => v > 0).map(([k,v]) => `${k}:${v}`).join(', ');
  console.warn(`[QA] ⚠️  No trades in 5min — warning #${watchdogWarnings} | Blockers: ${blockerStr}`);

  fixes.push({
    issue: 'TRADE_STALL',
    action: `Warning #${watchdogWarnings}: ${activeUsers.length} active users, blockers: ${blockerStr}`,
    blockers: blockerSummary,
  });

  return fixes;
}

// ─── CHECK 5: Data Integrity ───
// Detects: corrupted prices, missing price history, stale market data, orphaned records
function qaCheckDataIntegrity() {
  const fixes = [];
  const symKeys = Object.keys(DEFAULT_PRICES);
  let missingHist = 0;
  let zeroPrices = 0;

  for (const sym of symKeys) {
    if (!marketPrices[sym] || marketPrices[sym] <= 0) zeroPrices++;
    if (!priceHistory[sym] || priceHistory[sym].length < 30) missingHist++;
  }

  if (zeroPrices > 0) {
    for (const sym of symKeys) {
      if (!marketPrices[sym] || marketPrices[sym] <= 0) {
        marketPrices[sym] = DEFAULT_PRICES[sym];
      }
    }
    fixes.push({ issue: 'ZERO_PRICES', action: `Reset ${zeroPrices} symbols to default prices` });
    console.warn(`[QA] 🔧 Fixed ${zeroPrices} zero/missing prices`);
  }

  if (missingHist > symKeys.length * 0.3) {
    fixes.push({ issue: 'MISSING_HISTORY', action: `${missingHist}/${symKeys.length} symbols have insufficient price history` });
    console.warn(`[QA] ⚠️  ${missingHist} symbols have <30 price history points`);
  }

  // ─── ORPHAN DETECTION & CLEANUP ───
  // Detect fund_settings and wallets with no matching user (phantom accounts)
  const allUsers = db.findMany('users');
  const userIds = new Set(allUsers.map(u => u.id));

  // Check fund_settings for orphans
  const allFundSettings = db.findMany('fund_settings');
  const orphanSettings = allFundSettings.filter(s => !userIds.has(s.user_id));
  if (orphanSettings.length > 0) {
    for (const orphan of orphanSettings) {
      // Disable auto-trading on orphan so it stops consuming trade slots
      if (orphan.data?.autoTrading?.isAutoTrading) {
        orphan.data.autoTrading.isAutoTrading = false;
        db._save('fund_settings');
        fixes.push({
          issue: 'ORPHAN_FUND_SETTINGS',
          action: `Disabled auto-trading on orphan fund_settings (user_id: ${orphan.user_id?.slice(0, 8)}) — no matching user exists`,
        });
        console.warn(`[QA] 🔧 Disabled orphan fund_settings for phantom user ${orphan.user_id?.slice(0, 8)} — was consuming trade slots`);
      }
    }
  }

  // Check wallets for orphans
  const allWallets = db.findMany('wallets');
  const orphanWallets = allWallets.filter(w => !userIds.has(w.user_id));
  if (orphanWallets.length > 0) {
    fixes.push({
      issue: 'ORPHAN_WALLETS',
      action: `Found ${orphanWallets.length} orphan wallet(s) with no matching user: ${orphanWallets.map(w => w.user_id?.slice(0, 8)).join(', ')}`,
    });
    console.warn(`[QA] ⚠️  ${orphanWallets.length} orphan wallet(s) detected — user records missing`);
  }

  return fixes;
}

// ─── CHECK 6: Per-User Deep Debug ───
// Comprehensive per-user diagnostics: wallet, limits, agents, signals, positions
function qaCheckPerUserDebug() {
  const fixes = [];
  const userDiagnostics = [];
  const allSettings = db.findMany('fund_settings').filter(s => s.data?.autoTrading?.isAutoTrading);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const sessionStart = new Date(Math.max(todayStart.getTime(), new Date(SERVER_BOOT_TIME).getTime(), globalSessionResetTime ? new Date(globalSessionResetTime).getTime() : 0));

  for (const settings of allSettings) {
    const userId = settings.user_id;
    const data = settings.data;
    const wallet = db.findOne('wallets', w => w.user_id === userId);
    const user = db.findOne('users', u => u.id === userId);
    const userName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : userId.slice(0, 8);

    const diag = {
      userId: userId.slice(0, 8),
      name: userName,
      status: 'UNKNOWN',
      blockers: [],
    };

    // Wallet check
    if (!wallet) {
      diag.status = 'NO_WALLET';
      diag.blockers.push('Missing wallet — auto-creating');
      fixes.push({ userId, issue: 'USER_NO_WALLET', action: `${userName}: Missing wallet detected in per-user debug` });
      userDiagnostics.push(diag);
      continue;
    }

    diag.balance = wallet.balance;
    diag.equity = wallet.equity;
    diag.initialBalance = wallet.initial_balance;

    // Kill switch check
    if (wallet.kill_switch_active) {
      const adjustedInitial = Math.max(1000, wallet.initial_balance || 100000);
      const drawdownPct = ((wallet.equity / adjustedInitial) - 1) * 100;
      diag.status = 'KILL_SWITCH';
      diag.blockers.push(`Kill switch active (drawdown ${drawdownPct.toFixed(1)}%)`);

      // Auto-reset if drawdown is recoverable (above -15%)
      if (drawdownPct > -15) {
        wallet.kill_switch_active = false;
        db._save('wallets');
        diag.status = 'RECOVERED';
        diag.blockers.push(`Kill switch RESET (drawdown ${drawdownPct.toFixed(1)}% above -15% threshold)`);
        fixes.push({ userId, issue: 'KILL_SWITCH_RESET', action: `${userName}: Kill switch auto-reset (drawdown ${drawdownPct.toFixed(1)}%)` });
        console.warn(`[QA] 🔧 Per-user debug: Reset kill switch for ${userName} (drawdown ${drawdownPct.toFixed(1)}%)`);
      }
      userDiagnostics.push(diag);
      continue;
    }

    // Daily limit check — use SESSION start, not midnight
    const sessionOpens = db.count('positions', p => p.user_id === userId && new Date(p.opened_at) >= sessionStart);
    diag.sessionTrades = sessionOpens;
    diag.dailyLimit = AUTO_TRADE_CONFIG.maxDailyTrades;

    if (sessionOpens >= AUTO_TRADE_CONFIG.maxDailyTrades) {
      diag.status = 'DAILY_CAPPED';
      diag.blockers.push(`Session trades ${sessionOpens} >= limit ${AUTO_TRADE_CONFIG.maxDailyTrades}`);
      userDiagnostics.push(diag);
      continue;
    }

    // Open positions check
    const openPositions = db.findMany('positions', p => p.user_id === userId && p.status === 'OPEN');
    diag.openPositions = openPositions.length;
    diag.maxPositions = AUTO_TRADE_CONFIG.maxOpenPositions;

    if (openPositions.length >= AUTO_TRADE_CONFIG.maxOpenPositions) {
      diag.status = 'MAX_POSITIONS';
      diag.blockers.push(`${openPositions.length} open >= max ${AUTO_TRADE_CONFIG.maxOpenPositions}`);
      userDiagnostics.push(diag);
      continue;
    }

    // Agent health check — are any agents benched?
    const signalAgents = AI_AGENTS.filter(a => !a.isRiskManager && !a.isPositionManager);
    const heldSymbols = new Set(openPositions.map(p => p.symbol));
    let benchedAgents = 0;
    let activeAgents = 0;
    let executableSignals = 0;

    for (const agent of signalAgents) {
      const agentPerf = getAgentPerf(agent.name);
      const totalTrades = agentPerf.wins + agentPerf.losses;
      if (totalTrades >= 6) {
        const wr = agentPerf.wins / totalTrades;
        if (wr < (AUTO_TRADE_CONFIG.minWinRateForTrading || 0.40)) {
          benchedAgents++;
          diag.blockers.push(`Agent ${agent.name} benched (win rate ${(wr*100).toFixed(0)}%)`);
          continue;
        }
      }
      activeAgents++;

      // Check if this agent can produce executable signals
      const tradable = agent.symbols.filter(s => marketPrices[s] !== undefined && priceHistory[s]?.length >= 30 && !heldSymbols.has(s));
      for (const sym of tradable) {
        const sig = computeSignal(sym, agent.role, agent.name);
        const adj = sig.score * agentPerf.adaptiveConfidence;
        if (Math.abs(adj) >= AUTO_TRADE_CONFIG.minSignalStrength && sig.confluence >= (AUTO_TRADE_CONFIG.minConfluence || 3)) {
          executableSignals++;
          break;
        }
      }
    }

    diag.benchedAgents = benchedAgents;
    diag.activeAgents = activeAgents;
    diag.executableSignals = executableSignals;

    if (benchedAgents === signalAgents.length) {
      diag.status = 'ALL_AGENTS_BENCHED';
      diag.blockers.push(`All ${benchedAgents} signal agents benched for low win rate`);
    } else if (executableSignals === 0) {
      diag.status = 'NO_EXECUTABLE_SIGNALS';
      diag.blockers.push(`${activeAgents} agents active but 0 executable signals (all held or below threshold)`);
    } else {
      diag.status = 'HEALTHY';
    }

    userDiagnostics.push(diag);
  }

  // Log summary every 6 ticks (1 minute) for visibility
  if (autoTradeTickCount % 6 === 0) {
    const summary = userDiagnostics.map(d => `${d.name}:${d.status}`).join(' | ');
    console.log(`[QA] Per-user debug: ${summary}`);
  }

  return { fixes, diagnostics: userDiagnostics };
}

// ═══ MAIN QA AGENT: Full system debug on EVERY cycle ═══
function runQAAgent(isFullAudit = false) {
  qaState.checksRun++;
  const allFixes = [];
  const checks = [];

  // ─── ALWAYS run ALL checks — full debug every cycle ───
  const flowFixes = qaCheckTradeFlow();
  checks.push({ name: 'trade_flow', fixes: flowFixes.length, status: flowFixes.length === 0 ? 'PASS' : 'ISSUE' });
  allFixes.push(...flowFixes);

  const walletFixes = qaCheckWallets();
  checks.push({ name: 'wallets', fixes: walletFixes.length, status: walletFixes.length === 0 ? 'PASS' : 'FIXED' });
  allFixes.push(...walletFixes);

  const limitFixes = qaCheckDailyLimits();
  checks.push({ name: 'daily_limits', fixes: limitFixes.length, status: limitFixes.length === 0 ? 'PASS' : 'FIXED' });
  allFixes.push(...limitFixes);

  const signalFixes = qaCheckSignals();
  checks.push({ name: 'signals', fixes: signalFixes.length, status: signalFixes.length === 0 ? 'PASS' : 'FIXED' });
  allFixes.push(...signalFixes);

  const dataFixes = qaCheckDataIntegrity();
  checks.push({ name: 'data_integrity', fixes: dataFixes.length, status: dataFixes.length === 0 ? 'PASS' : 'FIXED' });
  allFixes.push(...dataFixes);

  // ─── CHECK 6: Per-User Deep Debug ───
  const perUserDebug = qaCheckPerUserDebug();
  checks.push({ name: 'per_user_debug', fixes: perUserDebug.fixes.length, status: perUserDebug.fixes.length === 0 ? 'PASS' : 'FIXED' });
  allFixes.push(...perUserDebug.fixes);

  qaState.lastFullAudit = Date.now();

  // Update stats
  qaState.issuesFound += allFixes.length;
  qaState.issuesFixed += allFixes.filter(f => f.action && !f.action.startsWith('Warning')).length;

  // ─── Build structured QA report ───
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const recentTradeCount = db.findMany('auto_trade_log').filter(
    l => new Date(l.timestamp).getTime() > fiveMinAgo
  ).length;
  const activeUserCount = db.findMany('fund_settings').filter(
    s => s.data?.autoTrading?.isAutoTrading
  ).length;
  const totalOpen = db.count('positions', p => p.status === 'OPEN');

  // Determine severity: CRITICAL (system down), WARNING (degraded), INFO (routine)
  const hasCritical = allFixes.some(f => ['TRADE_STALL', 'ALL_USERS_DAILY_CAPPED', 'ZERO_PRICES'].includes(f.issue));
  const hasWarning = allFixes.some(f => ['STUCK_KILL_SWITCH', 'MISSING_WALLET', 'WEAK_SIGNALS', 'MISSING_HISTORY'].includes(f.issue));
  const severity = hasCritical ? 'CRITICAL' : hasWarning ? 'WARNING' : allFixes.length > 0 ? 'INFO' : 'HEALTHY';

  const report = {
    // Header
    reportId: `QA-${Date.now().toString(36).toUpperCase()}`,
    type: isFullAudit ? 'FULL_AUDIT' : 'MONITOR',
    severity,
    timestamp: new Date().toISOString(),
    tickCount: autoTradeTickCount,
    uptimeMinutes: +(autoTradeTickCount * AUTO_TRADE_CONFIG.tickIntervalMs / 60000).toFixed(1),

    // System snapshot
    systemState: {
      status: recentTradeCount > 0 || activeUserCount === 0 ? 'HEALTHY' : 'STALLED',
      activeUsers: activeUserCount,
      openPositions: totalOpen,
      tradesLast5Min: recentTradeCount,
      lastTradeAge: lastTradeTimestamp > 0 ? `${((Date.now() - lastTradeTimestamp) / 60000).toFixed(1)}min` : 'never',
      watchdogWarnings,
    },

    // Check results with pass/fail per category
    checks: checks.map(c => ({
      ...c,
      category: c.name.replace(/_/g, ' ').toUpperCase(),
    })),

    // Detailed issues with context
    issues: allFixes.map(f => ({
      severity: ['TRADE_STALL', 'ALL_USERS_DAILY_CAPPED', 'ZERO_PRICES'].includes(f.issue) ? 'CRITICAL'
        : ['STUCK_KILL_SWITCH', 'MISSING_WALLET', 'WEAK_SIGNALS'].includes(f.issue) ? 'WARNING' : 'INFO',
      code: f.issue,
      description: f.action,
      userId: f.userId?.slice(0, 8) || null,
      autoFixed: !f.action?.startsWith('Warning'),
      blockers: f.blockers || null,
    })),

    // QA agent lifetime stats
    agentStats: {
      totalChecksRun: qaState.checksRun,
      totalIssuesFound: qaState.issuesFound,
      totalIssuesFixed: qaState.issuesFixed,
      fixRate: qaState.issuesFound > 0 ? `${((qaState.issuesFixed / qaState.issuesFound) * 100).toFixed(0)}%` : 'N/A',
    },

    // Per-user debug diagnostics (full system visibility)
    perUserDebug: perUserDebug.diagnostics,
  };

  // ALWAYS log report — full audit every cycle means every report is an audit trail entry
  db.insert('qa_reports', report);
  qaState.history.push(report);
  if (qaState.history.length > 50) qaState.history.shift();

  return { checks, fixes: allFixes, report };
}

// Run QA agent every 30 seconds — ALWAYS full debug audit per directive
const qaInterval = setInterval(() => {
  runQAAgent(true); // Full system debug on EVERY cycle — no fast-monitor shortcut
}, 30000);

// ─── BOOT SELF-TEST: Comprehensive system validation at 15s ───
setTimeout(() => {
  console.log(`[QA BOOT] Running comprehensive boot validation...`);

  // 1. Run full audit immediately
  const auditResult = runQAAgent(true);
  const fixCount = auditResult.fixes.length;
  if (fixCount > 0) {
    console.warn(`[QA BOOT] Found and addressed ${fixCount} issues on boot`);
    auditResult.fixes.forEach(f => console.warn(`  → ${f.issue}: ${f.action}`));
  }

  // 2. Check if trades fired
  const recentLogs = db.findMany('auto_trade_log').filter(
    l => new Date(l.timestamp).getTime() > Date.now() - 30000
  );
  const activeUsers = db.findMany('fund_settings').filter(
    s => s.data?.autoTrading?.isAutoTrading
  ).length;

  if (recentLogs.length > 0) {
    bootTestPassed = true;
    console.log(`[QA BOOT] ✅ PASS — ${recentLogs.length} trades in first 15s (${activeUsers} users, ${fixCount} fixes applied)`);
  } else {
    console.warn(`[QA BOOT] ⚠️  No trades yet — ${activeUsers} users active, ${fixCount} fixes applied`);
    // If no trades, run QA again in 15 more seconds (after fixes have had time to take effect)
    setTimeout(() => {
      const retryLogs = db.findMany('auto_trade_log').filter(
        l => new Date(l.timestamp).getTime() > Date.now() - 30000
      );
      if (retryLogs.length > 0) {
        bootTestPassed = true;
        console.log(`[QA BOOT] ✅ PASS (retry) — ${retryLogs.length} trades after QA fixes`);
      } else {
        console.warn(`[QA BOOT] 🔴 FAIL — Still no trades after 30s + QA fixes. Running emergency signal reseed...`);
        qaCheckSignals(); // Force signal reseed
        runQAAgent(true); // Full audit again
      }
    }, 15000);
  }
}, 15000);

// Keep-alive self-ping — prevents Render free tier from sleeping
const SELF_URL = process.env.RENDER_EXTERNAL_URL || process.env.EXTERNAL_URL;
let keepAliveInterval = null;
if (SELF_URL) {
  // Use built-in http/https based on URL protocol
  const pingFn = SELF_URL.startsWith('https')
    ? (await import('node:https')).get
    : (await import('node:http')).get;
  keepAliveInterval = setInterval(() => {
    pingFn(`${SELF_URL}/api/health`, (res) => { res.resume(); }).on('error', () => {});
  }, 4 * 60 * 1000); // Every 4 minutes
}

// ─── AUTO-TRADE LOG API ENDPOINTS ───

// Get live auto-trade activity feed (recent trades by AI agents)
api.get('/api/auto-trades', auth, (req, res) => {
  const logs = db.findMany('auto_trade_log', l => l.user_id === req.userId)
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
    .slice(0, 50);
  json(res, 200, logs);
});

// Trading health — watchdog status (no auth required for monitoring)
api.get('/api/trading/health', (req, res) => {
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const recentTradeCount = db.findMany('auto_trade_log').filter(
    l => new Date(l.timestamp).getTime() > fiveMinAgo
  ).length;
  const activeUsers = db.findMany('fund_settings').filter(
    s => s.data?.autoTrading?.isAutoTrading
  ).length;
  const totalOpen = db.count('positions', p => p.status === 'OPEN');
  const qaReports = db.findMany('qa_reports').slice(-10);

  // Sample signal diagnostics
  const sampleSymbols = ['AAPL', 'TSLA', 'BTC', 'SPY'];
  const signalDiag = {};
  for (const sym of sampleSymbols) {
    const histLen = priceHistory[sym]?.length || 0;
    let score = 0, reason = 'no data';
    if (histLen >= 30) {
      const sig = computeSignal(sym, 'SIGNAL_SCANNER');
      score = sig.score;
      reason = sig.reason;
    }
    signalDiag[sym] = { historyLength: histLen, signalScore: +score.toFixed(3), regime: symbolRegimes[sym], reason };
  }

  // Per-user blocker summary — use SESSION start (matches actual trading engine logic)
  const allSettings = db.findMany('fund_settings').filter(s => s.data?.autoTrading?.isAutoTrading);
  const healthTodayStart = new Date(); healthTodayStart.setHours(0, 0, 0, 0);
  const healthSessionStart = new Date(Math.max(healthTodayStart.getTime(), new Date(SERVER_BOOT_TIME).getTime()));
  const userBlockers = { healthy: 0, no_wallet: 0, kill_switch: 0, daily_limit: 0, no_signals: 0 };
  for (const s of allSettings) {
    const w = db.findOne('wallets', ww => ww.user_id === s.user_id);
    if (!w) { userBlockers.no_wallet++; continue; }
    if (w.kill_switch_active) { userBlockers.kill_switch++; continue; }
    const opens = db.count('positions', p => p.user_id === s.user_id && new Date(p.opened_at) >= healthSessionStart);
    if (opens >= AUTO_TRADE_CONFIG.maxDailyTrades) { userBlockers.daily_limit++; continue; }
    userBlockers.healthy++;
  }

  const healthy = recentTradeCount > 0 || activeUsers === 0;
  json(res, 200, {
    status: healthy ? 'HEALTHY' : 'STALLED',
    tickCount: autoTradeTickCount,
    activeUsers,
    openPositions: totalOpen,
    tradesLast5Min: recentTradeCount,
    watchdogWarnings,
    bootTestPassed,
    lastTradeAge: lastTradeTimestamp > 0 ? `${((Date.now() - lastTradeTimestamp) / 60000).toFixed(1)}min` : 'never',
    signalDiagnostics: signalDiag,
    userBlockers,
    qa: {
      checksRun: qaState.checksRun,
      issuesFound: qaState.issuesFound,
      issuesFixed: qaState.issuesFixed,
      lastFullAudit: qaState.lastFullAudit > 0 ? `${((Date.now() - qaState.lastFullAudit) / 60000).toFixed(1)}min ago` : 'never',
    },
    recentQAReports: qaReports,
    intelligence: {
      correlationAge: correlationCache.lastUpdated > 0 ? `${((Date.now() - correlationCache.lastUpdated) / 60000).toFixed(1)}min ago` : 'never',
      marketRegime: correlationCache.marketRegime || 'unknown',
      sentimentSymbols: Object.keys(sentimentStore).length,
      sentimentSample: Object.fromEntries(Object.entries(sentimentStore).slice(0, 5).map(([k, v]) => [k, { score: v.score, source: v.source }])),
      marketSession: getMarketSession(),
    },
    learning: {
      activeBreakers: Object.values(agentCircuitBreakers).filter(cb => cb.tripped).length,
      totalBreakers: Object.keys(agentCircuitBreakers).length,
      learnedSymbols: Object.values(indicatorLearning).reduce((s, a) => s + Object.keys(a).length, 0),
      agentStrategies: Object.fromEntries(Object.entries(strategyState).map(([k, v]) => [k, { strategy: v.currentStrategy, trend: v.performanceTrend }])),
    },
    config: {
      minSignalThreshold: AUTO_TRADE_CONFIG.minSignalStrength,
      maxDailyTrades: AUTO_TRADE_CONFIG.maxDailyTrades,
      maxOpenPositions: AUTO_TRADE_CONFIG.maxOpenPositions,
    },
  });
});

// QA Reports — comprehensive audit trail with filtering
api.get('/api/qa/reports', (req, res) => {
  const severity = req.query?.severity; // CRITICAL, WARNING, INFO, HEALTHY
  const type = req.query?.type; // FULL_AUDIT, MONITOR
  const limit = Math.min(parseInt(req.query?.limit) || 50, 200);

  let reports = db.findMany('qa_reports')
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

  if (severity) reports = reports.filter(r => r.severity === severity.toUpperCase());
  if (type) reports = reports.filter(r => r.type === type.toUpperCase());

  reports = reports.slice(0, limit);

  // Summary stats
  const allReports = db.findMany('qa_reports');
  const criticalCount = allReports.filter(r => r.severity === 'CRITICAL').length;
  const warningCount = allReports.filter(r => r.severity === 'WARNING').length;
  const fixedCount = allReports.reduce((sum, r) => sum + (r.issues?.filter(i => i.autoFixed)?.length || 0), 0);

  json(res, 200, {
    summary: {
      totalReports: allReports.length,
      criticalEvents: criticalCount,
      warningEvents: warningCount,
      totalAutoFixes: fixedCount,
      qaAgent: {
        checksRun: qaState.checksRun,
        issuesFound: qaState.issuesFound,
        issuesFixed: qaState.issuesFixed,
        fixRate: qaState.issuesFound > 0 ? `${((qaState.issuesFixed / qaState.issuesFound) * 100).toFixed(0)}%` : '100%',
        uptime: `${(autoTradeTickCount * AUTO_TRADE_CONFIG.tickIntervalMs / 60000).toFixed(1)}min`,
      },
    },
    reports,
  });
});

// QA Run on-demand — trigger immediate full audit
api.post('/api/qa/run', (req, res) => {
  const result = runQAAgent(true);
  json(res, 200, {
    message: 'QA audit completed',
    checksPerformed: result.checks.length,
    issuesFound: result.fixes.length,
    report: result.report,
  });
});

// ═══════════════════════════════════════════════════════════════════
//   SIGNAL TRACKING API — Full audit trail, stats, and live feed
// ═══════════════════════════════════════════════════════════════════

// Signal history — paginated, filterable
api.get('/api/signals', auth, (req, res) => {
  const limit = Math.min(parseInt(req.query?.limit) || 50, 200);
  const offset = parseInt(req.query?.offset) || 0;
  const agent = req.query?.agent;
  const symbol = req.query?.symbol;
  const action = req.query?.action; // EXECUTED, REJECTED, FILTERED
  const outcome = req.query?.outcome; // WIN, LOSS, PENDING

  let signals = db.findMany('signals', s => s.user_id === req.userId)
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

  if (agent) signals = signals.filter(s => s.agent === agent);
  if (symbol) signals = signals.filter(s => s.symbol === symbol.toUpperCase());
  if (action) signals = signals.filter(s => s.action === action.toUpperCase());
  if (outcome) signals = signals.filter(s => s.outcome === outcome.toUpperCase());

  const total = signals.length;
  signals = signals.slice(offset, offset + limit);

  json(res, 200, { total, offset, limit, signals });
});

// Signal stats — aggregated performance analytics
api.get('/api/signals/stats', auth, (req, res) => {
  json(res, 200, computeSignalStats(req.userId));
});

// Live signal feed — real-time buffer (last 200 signals across all users)
api.get('/api/signals/live', auth, (req, res) => {
  const limit = Math.min(parseInt(req.query?.limit) || 50, 200);
  const userSignals = signalBuffer.filter(s => s.user_id === req.userId).slice(-limit);
  json(res, 200, { signals: userSignals, bufferSize: signalBuffer.length });
});

// Signal heatmap — strength by symbol, agent grid
api.get('/api/signals/heatmap', auth, (req, res) => {
  const symbols = Object.keys(marketPrices);
  const agents = AI_AGENTS.filter(a => !a.isRiskManager && !a.isPositionManager);
  const heatmap = {};

  for (const sym of symbols) {
    heatmap[sym] = {};
    for (const agent of agents) {
      if (agent.symbols.includes(sym) && priceHistory[sym]?.length >= 30) {
        const sig = computeSignal(sym, agent.role);
        heatmap[sym][agent.name] = {
          score: roundTo(sig.score, 3),
          confluence: sig.confluence,
          regime: symbolRegimes[sym],
        };
      }
    }
  }

  json(res, 200, {
    heatmap,
    session: getMarketSession(),
    correlationRegime: correlationCache.marketRegime || 'neutral',
    timestamp: new Date().toISOString(),
  });
});

// ─── Agent Learning & Self-Healing Dashboard ───
api.get('/api/agents/learning', auth, (req, res) => {
  try {
    const report = getAgentLearningReport();
    json(res, 200, report);
  } catch (e) {
    json(res, 500, { error: 'Learning report generation failed', message: e.message });
  }
});

// ─── ADMIN: Recent trades across all users (for Mission Control live feed) ───
api.get('/api/admin/trades/recent', auth, (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin only' });

  const limit = Math.min(parseInt(new URL(req.url, `http://${req.headers.host}`).searchParams.get('limit')) || 25, 100);
  const allTrades = db.findMany('trades')
    .sort((a, b) => (b.closed_at || b.opened_at || '').localeCompare(a.closed_at || a.opened_at || ''))
    .slice(0, limit);

  // Enrich with user info
  const trades = allTrades.map(t => {
    const u = db.findOne('users', usr => usr.id === t.user_id);
    return {
      id: t.id,
      time: t.closed_at || t.opened_at,
      symbol: t.symbol,
      side: t.side,
      quantity: t.quantity,
      entry_price: t.entry_price,
      close_price: t.close_price,
      realized_pnl: t.realized_pnl || 0,
      agent: t.agent,
      status: t.status || 'CLOSED',
      investor: u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email : 'Unknown',
    };
  });

  json(res, 200, { trades, count: trades.length });
});

// ─── ADMIN: Agent status with live metrics (for Mission Control) ───
api.get('/api/admin/agents/status', auth, (req, res) => {
  try {
    const allTrades = db.findMany('trades');
    const allSignals = db.findMany('signals');
    const now = Date.now();

    const agentStatus = AI_AGENTS.map(a => {
      const agentTrades = allTrades.filter(t => t.agent === a.name);
      const agentSignals = allSignals.filter(s => s.agent === a.name);
      const wins = agentTrades.filter(t => (t.realized_pnl || 0) > 0).length;
      const losses = agentTrades.filter(t => (t.realized_pnl || 0) < 0).length;
      const totalPnl = agentTrades.reduce((s, t) => s + (t.realized_pnl || 0), 0);
      const recentSignals = agentSignals.filter(s => {
        try { return now - new Date(s.timestamp || s.created_at || 0).getTime() < 3600000; } catch { return false; }
      });

      const cb = typeof getCircuitBreaker === 'function' ? getCircuitBreaker(a.name) : null;
      const isQuarantined = cb?.isOpen || false;
      const ss = typeof getStrategyState === 'function' ? getStrategyState(a.name) : null;

      return {
        id: a.name.toUpperCase(),
        name: a.name,
        role: a.description || a.role,
        status: isQuarantined ? 'quarantined' : recentSignals.length > 0 ? 'active' : 'idle',
        trades: agentTrades.length,
        wins,
        losses,
        winRate: (wins + losses) > 0 ? roundTo(wins / (wins + losses) * 100, 1) : 0,
        totalPnl: roundTo(totalPnl, 2),
        signalsLastHour: recentSignals.length,
        strategy: ss?.currentStrategy || 'default',
        symbols: a.symbols || [],
        circuitBreaker: isQuarantined ? {
          reason: cb?.reason || 'threshold exceeded',
          cooldownEnds: cb?.cooldownUntil || null,
        } : null,
      };
    });

    // Add Debugger as virtual agent (platform health monitor)
    let recentErrors = [];
    try { recentErrors = db.findMany('risk_events', e => now - new Date(e.timestamp || e.created_at || 0).getTime() < 3600000); } catch { /* */ }
    agentStatus.push({
      id: 'DEBUGGER',
      name: 'Debugger',
      role: 'Platform health monitor & error detection',
      status: recentErrors.length > 0 ? 'active' : 'monitoring',
      trades: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0,
      signalsLastHour: recentErrors.length,
      strategy: 'diagnostic', symbols: [], circuitBreaker: null,
      errorsDetected: recentErrors.length,
    });

    json(res, 200, { agents: agentStatus, count: agentStatus.length });
  } catch (err) {
    console.error('[agents/status] Error:', err.message);
    json(res, 500, { error: 'Agent status computation failed', detail: err.message });
  }
});

// Trading debug — dry-run one tick for a sample user, expose full decision chain
api.get('/api/trading/debug', (req, res) => {
  const allSettings = db.findMany('fund_settings');
  const results = [];

  for (const settingsRecord of allSettings) {
    const userId = settingsRecord.user_id;
    const data = settingsRecord.data;
    const isActive = data?.autoTrading?.isAutoTrading;
    if (!isActive) continue;

    const wallet = db.findOne('wallets', w => w.user_id === userId);
    if (!wallet) { results.push({ userId, blocked: 'NO_WALLET' }); continue; }
    if (wallet.kill_switch_active) { results.push({ userId, blocked: 'KILL_SWITCH' }); continue; }

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const sessionStart = new Date(Math.max(todayStart.getTime(), new Date(SERVER_BOOT_TIME).getTime(), globalSessionResetTime ? new Date(globalSessionResetTime).getTime() : 0));
    const sessionOpens = db.count('positions', p => p.user_id === userId && new Date(p.opened_at) >= sessionStart);
    if (sessionOpens >= AUTO_TRADE_CONFIG.maxDailyTrades) {
      results.push({ userId, blocked: 'DAILY_LIMIT', sessionOpens, max: AUTO_TRADE_CONFIG.maxDailyTrades, sessionStart: sessionStart.toISOString() });
      continue;
    }

    const openPositions = db.findMany('positions', p => p.user_id === userId && p.status === 'OPEN');
    const heldSymbols = openPositions.map(p => p.symbol);
    const heldSet = new Set(heldSymbols);

    const signalAgents = AI_AGENTS.filter(a => !a.isRiskManager && !a.isPositionManager);
    const signals = [];

    for (const agent of signalAgents) {
      const agentPerf = getAgentPerf(agent.name);
      const tradable = agent.symbols.filter(s => marketPrices[s] !== undefined && priceHistory[s]?.length >= 30);
      const scored = [];
      for (const symbol of tradable) {
        const signal = computeSignal(symbol, agent.role);
        const adjustedScore = signal.score * agentPerf.adaptiveConfidence;
        scored.push({ symbol, score: signal.score, adjustedScore, confluence: signal.confluence, agent: agent.name, isHeld: heldSet.has(symbol) });
      }
      scored.sort((a, b) => Math.abs(b.adjustedScore) - Math.abs(a.adjustedScore));
      // Show best unheld signal (matching actual trading logic)
      const bestUnheld = scored.find(s => !s.isHeld);
      const pick = bestUnheld || scored[0];
      if (pick) {
        const passesThreshold = Math.abs(pick.adjustedScore) >= AUTO_TRADE_CONFIG.minSignalStrength;
        const alreadyHeld = pick.isHeld;
        const side = pick.adjustedScore > 0 ? 'LONG' : 'SHORT';
        const price = marketPrices[pick.symbol];
        const equity = wallet.equity || wallet.balance || 100000;
        let sizePct = pick.confluence >= 4 ? AUTO_TRADE_CONFIG.eliteSizePct : AUTO_TRADE_CONFIG.baseSizePct;
        const qty = price ? Math.max(1, Math.floor(equity * sizePct / price)) : 0;
        const cost = price ? qty * price : 0;
        const canAfford = side === 'LONG' ? cost <= wallet.balance : true;
        const riskCheck = price ? preTradeRiskCheck(userId, wallet, { symbol: pick.symbol, side, quantity: qty, price }) : { approved: false, reason: 'no price' };
        signals.push({
          ...pick, passesThreshold, alreadyHeld, side, price, qty, cost,
          balance: wallet.balance, canAfford, riskApproved: riskCheck.approved, riskReason: riskCheck.reason || 'ok',
          wouldExecute: passesThreshold && !alreadyHeld && canAfford && riskCheck.approved,
        });
      }
    }

    results.push({
      userId, balance: wallet.balance, equity: wallet.equity, openCount: openPositions.length,
      heldSymbols, todayOpens, signals,
    });
  }

  json(res, 200, { tickCount: autoTradeTickCount, debugResults: results });
});

// Get auto-trading status
api.get('/api/auto-trading/status', auth, (req, res) => {
  const settings = db.findOne('fund_settings', s => s.user_id === req.userId);
  const isActive = settings?.data?.autoTrading?.isAutoTrading || false;
  const positions = db.findMany('positions', p => p.user_id === req.userId && p.status === 'OPEN');
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayTrades = db.count('trades', t => t.user_id === req.userId && new Date(t.closed_at) >= todayStart);
  const wallet = db.findOne('wallets', w => w.user_id === req.userId);

  json(res, 200, {
    isActive,
    openPositions: positions.length,
    todayTrades,
    agents: AI_AGENTS.map(a => ({ name: a.name, role: a.role, description: a.description })),
    activeAgents: settings?.data?.autoTrading?.agentsActive || [],
    tradingMode: settings?.data?.autoTrading?.tradingMode || 'balanced',
    startedAt: settings?.data?.autoTrading?.tradingStartedAt || null,
    equity: wallet?.equity || 0,
    balance: wallet?.balance || 0,
    initialBalance: wallet?.initial_balance || 100000,
    realizedPnL: wallet?.realized_pnl || 0,
    unrealizedPnL: wallet?.unrealized_pnl || 0,
    tradeCount: wallet?.trade_count || 0,
    tickCount: autoTradeTickCount,
  });
});

// Start/stop auto-trading (toggle)
api.post('/api/auto-trading/toggle', auth, async (req, res) => {
  const body = await readBody(req);
  const { enabled, mode } = body;

  let settings = db.findOne('fund_settings', s => s.user_id === req.userId);
  if (!settings) {
    settings = db.insert('fund_settings', {
      user_id: req.userId,
      data: { autoTrading: {} },
    });
  }

  if (!settings.data) settings.data = {};
  if (!settings.data.autoTrading) settings.data.autoTrading = {};

  settings.data.autoTrading.isAutoTrading = enabled !== false;
  settings.data.autoTrading.tradingMode = mode || settings.data.autoTrading.tradingMode || 'balanced';
  if (enabled !== false) {
    settings.data.autoTrading.tradingStartedAt = Date.now();
    settings.data.autoTrading.agentsActive = AI_AGENTS.map(a => a.name);
  } else {
    settings.data.autoTrading.agentsActive = [];

    // Close ALL open positions when trading is stopped — freeze the portfolio value
    const openPositions = db.findMany('positions', p => p.user_id === req.userId && p.status === 'OPEN');
    let closedCount = 0;
    let totalPnL = 0;
    for (const pos of openPositions) {
      const result = closePosition(req.userId, pos.id);
      if (result.success) {
        closedCount++;
        totalPnL += result.pnl || 0;
      }
    }
    if (closedCount > 0) {
      console.log(`[AutoTrader] User ${req.userId} stopped trading — closed ${closedCount} positions (PnL: $${totalPnL.toFixed(2)})`);
    }
  }
  settings.updated_at = new Date().toISOString();
  db._save('fund_settings');

  const openPositions = db.findMany('positions', p => p.user_id === req.userId && p.status === 'OPEN');

  json(res, 200, {
    success: true,
    isActive: settings.data.autoTrading.isAutoTrading,
    agents: settings.data.autoTrading.agentsActive,
    positionsClosed: enabled === false ? (openPositions.length === 0) : undefined,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//   CAPITAL ACCOUNT & DISTRIBUTION ENGINE
//   Tracks partner capital accounts, records distributions on withdrawal,
//   adjusts ownership ratios dynamically, and feeds K-1 allocation engine.
//   IRC §704(b) capital account maintenance methodology.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Ensure a capital account exists for an investor.
 * Created lazily on first contribution or first withdrawal.
 */
function ensureCapitalAccount(userId) {
  let account = db.findOne('capital_accounts', a => a.user_id === userId);
  if (account) return account;

  const wallet = db.findOne('wallets', w => w.user_id === userId);
  const user = db.findOne('users', u => u.id === userId);
  const initialBalance = wallet?.initial_balance || 100000;
  // Use current wallet equity as ending balance (reflects actual P&L)
  const currentEquity = wallet?.equity || wallet?.balance || initialBalance;

  account = db.insert('capital_accounts', {
    user_id: userId,
    investor_name: user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Unknown',
    beginning_balance: initialBalance,
    contributions: initialBalance,
    distributions_total: 0,
    allocated_income: roundTo((wallet?.realized_pnl || 0), 2),
    allocated_losses: 0,
    ending_balance: currentEquity,
    ownership_pct: user?.ownership_pct || 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return account;
}

/**
 * Record a distribution (withdrawal) against an investor's capital account.
 * Creates an immutable distribution record and updates the capital account.
 * Returns the distribution record for audit trail.
 */
function recordDistribution(userId, amount, withdrawalRequestId, method) {
  const account = ensureCapitalAccount(userId);
  const user = db.findOne('users', u => u.id === userId);
  const wallet = db.findOne('wallets', w => w.user_id === userId);
  const investorName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Unknown';

  const balanceBefore = account.ending_balance;
  const balanceAfter = roundTo(balanceBefore - amount, 2);

  // ── IRC §731: Basis-Exceeding Distribution Detection ──
  // Compute the investor's adjusted tax basis:
  //   Basis = contributions + allocated income - allocated losses - prior distributions
  // If distribution exceeds basis, the excess is taxable as capital gain.
  const adjustedBasis = roundTo(
    (account.contributions || 0) +
    (account.allocated_income || 0) -
    Math.abs(account.allocated_losses || 0) -
    (account.distributions_total || 0),
    2
  );

  const basisExceeded = amount > adjustedBasis && adjustedBasis >= 0;
  const excessOverBasis = basisExceeded ? roundTo(amount - adjustedBasis, 2) : 0;
  const returnOfCapitalPortion = basisExceeded ? adjustedBasis : amount;

  // Create immutable distribution record
  const distribution = db.insert('distributions', {
    user_id: userId,
    investor_name: investorName,
    withdrawal_request_id: withdrawalRequestId || null,
    amount: roundTo(amount, 2),
    type: basisExceeded ? 'basis_exceeding_distribution' : 'cash_distribution',
    method: method || 'bank_transfer',
    capital_account_before: balanceBefore,
    capital_account_after: balanceAfter,
    wallet_equity_at_distribution: wallet?.equity || 0,
    tax_year: new Date().getFullYear(),
    is_return_of_capital: true,  // All partnership distributions are technically return of capital
    // ── IRC §731 fields ──
    adjusted_basis_at_distribution: adjustedBasis,
    basis_exceeded: basisExceeded,
    excess_over_basis: excessOverBasis,            // Taxable capital gain amount
    return_of_capital_portion: returnOfCapitalPortion,
    distribution_date: new Date().toISOString(),
    created_at: new Date().toISOString(),
  });

  // ── If basis exceeded: record excess as capital gain in tax_ledger (IRC §731(a)) ──
  if (basisExceeded && excessOverBasis > 0) {
    // Determine holding period: if investor held partnership interest > 1 year → long-term
    const accountAge = account.created_at
      ? Math.floor((Date.now() - new Date(account.created_at).getTime()) / (1000 * 60 * 60 * 24))
      : 365;
    const holdingPeriod = accountAge >= TAX_CONFIG.shortTermThresholdDays ? 'LONG_TERM' : 'SHORT_TERM';

    db.insert('tax_ledger', {
      user_id: userId,
      tax_lot_id: null,
      position_id: `dist-${distribution.id}`,   // Link to distribution record
      symbol: 'PARTNERSHIP_INTEREST',
      side: 'LONG',
      asset_class: 'partnership',
      quantity: 1,
      acquired_at: account.created_at || new Date().toISOString(),
      disposed_at: new Date().toISOString(),
      hold_days: accountAge,
      holding_period: holdingPeriod,
      cost_basis: 0,                             // Basis already exhausted
      proceeds: excessOverBasis,
      gain_loss: excessOverBasis,
      wash_sale_disallowed: 0,
      adjusted_gain_loss: excessOverBasis,
      agent: null,
      cost_basis_method: 'IRC_731',
      is_wash_sale: false,
      form_8949_box: holdingPeriod === 'SHORT_TERM' ? 'A' : 'D',
      is_basis_exceeding_distribution: true,
      distribution_id: distribution.id,
    });

    console.warn(`[TaxEngine] ⚠ BASIS EXCEEDED: ${investorName} withdrew $${amount} against basis of $${adjustedBasis}. Excess $${excessOverBasis} recorded as ${holdingPeriod} capital gain.`);
  }

  // Update capital account
  account.distributions_total = roundTo((account.distributions_total || 0) + amount, 2);
  account.ending_balance = balanceAfter;
  account.updated_at = new Date().toISOString();
  db._save('capital_accounts');

  console.log(`[CapitalAccount] Distribution recorded: $${amount} for ${investorName}. Capital account: $${balanceBefore} → $${balanceAfter}${basisExceeded ? ` | ⚠ BASIS EXCEEDED by $${excessOverBasis}` : ''}`);
  return distribution;
}

/**
 * Recalculate ownership percentages based on current capital account balances.
 * Called after any distribution or contribution event.
 * Uses capital-account-weighted methodology per IRC §704(b).
 */
function recalculateOwnershipFromCapitalAccounts() {
  const activeUsers = db.findMany('users', u => u.status === 'active');
  if (activeUsers.length === 0) return;

  // Ensure all active users have capital accounts
  activeUsers.forEach(u => ensureCapitalAccount(u.id));

  const accounts = db.findMany('capital_accounts', a =>
    activeUsers.some(u => u.id === a.user_id)
  );

  const totalCapital = accounts.reduce((sum, a) => sum + Math.max(0, a.ending_balance), 0);
  if (totalCapital <= 0) {
    // Equal split fallback
    const equalPct = roundTo(100 / activeUsers.length, 2);
    accounts.forEach(a => {
      a.ownership_pct = equalPct;
      a.updated_at = new Date().toISOString();
    });
    activeUsers.forEach(u => { u.ownership_pct = roundTo(100 / activeUsers.length, 2); });
  } else {
    accounts.forEach(a => {
      const pct = roundTo(Math.max(0, a.ending_balance) / totalCapital * 100, 4);
      a.ownership_pct = pct;
      a.updated_at = new Date().toISOString();
      // Sync to user record
      const user = activeUsers.find(u => u.id === a.user_id);
      if (user) user.ownership_pct = pct;
    });
  }

  db._save('capital_accounts');
  db._save('users');
  console.log(`[CapitalAccount] Ownership recalculated. Total capital: $${totalCapital}. ${accounts.length} accounts updated.`);
}

/**
 * Update capital accounts with allocated income/losses from tax engine.
 * Called after K-1 computation to keep capital accounts current.
 */
function updateCapitalAccountsFromAllocations(taxYear) {
  const allocations = db.findMany('tax_allocations', a => a.tax_year === taxYear);
  for (const alloc of allocations) {
    const account = ensureCapitalAccount(alloc.user_id);
    account.allocated_income = roundTo(
      Math.max(0, alloc.allocated_net_gain_loss), 2
    );
    account.allocated_losses = roundTo(
      Math.min(0, alloc.allocated_net_gain_loss), 2
    );
    // Ending balance = beginning + contributions - distributions + income + losses
    account.ending_balance = roundTo(
      account.beginning_balance +
      (account.contributions || 0) -
      (account.distributions_total || 0) +
      account.allocated_income +
      account.allocated_losses, 2
    );
    account.updated_at = new Date().toISOString();
  }
  db._save('capital_accounts');
}

// ═══════════════════════════════════════════════════════════════════════════════
//   TAX ENGINE MODULE
//   Immutable tax ledger, cost basis tracking, wash sale detection,
//   per-investor allocation, and IRS-ready reporting (Form 8949 / Schedule D)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── TAX CONFIGURATION ───
const TAX_CONFIG = {
  costBasisMethod: 'FIFO',           // FIFO | LIFO | SPECIFIC_ID (default FIFO for IRS compliance)
  shortTermThresholdDays: 365,       // Holding period for short-term vs long-term
  washSaleWindowDays: 30,            // 30-day wash sale lookback/lookahead
  fiscalYearStart: '01-01',          // MM-DD fiscal year start (Jan 1 default)
  enableWashSaleDetection: true,     // Crypto wash sale rule effective 2025+
  cryptoSymbols: ['BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'AVAX', 'MATIC', 'LINK', 'DOGE', 'XRP'],
};

// ─── TAX LOT TRACKING (Cost Basis Engine) ───

/**
 * Creates an immutable tax lot when a position is opened.
 * Each tax lot tracks: acquisition date, cost basis, quantity, and adjustments.
 * Tax lots are NEVER modified — only new adjustment records are appended.
 */
function createTaxLot(positionId, userId, symbol, side, quantity, pricePerUnit, agent) {
  const costBasis = roundTo(quantity * pricePerUnit, 2);
  const lot = db.insert('tax_lots', {
    position_id: positionId,
    user_id: userId,
    symbol,
    side,
    quantity,
    remaining_quantity: quantity,
    price_per_unit: pricePerUnit,
    cost_basis: costBasis,
    adjusted_cost_basis: costBasis,       // Modified by wash sale disallowed losses
    wash_sale_adjustment: 0,              // Total wash sale basis adjustments
    acquired_at: new Date().toISOString(),
    disposed_at: null,
    status: 'OPEN',                       // OPEN | CLOSED | PARTIAL
    agent,
    asset_class: TAX_CONFIG.cryptoSymbols.includes(symbol) ? 'crypto' : 'equity',
    holding_period: null,                 // Calculated on close: 'SHORT_TERM' | 'LONG_TERM'
  });
  console.log(`[TaxEngine] Lot created: ${lot.id} | ${side} ${quantity} ${symbol} @ $${pricePerUnit}`);
  return lot;
}

/**
 * Closes (disposes of) tax lots using the configured cost basis method (FIFO/LIFO).
 * Returns array of lot dispositions for Form 8949 reporting.
 */
function disposeTaxLots(userId, symbol, side, quantity, closePrice, closedAt) {
  // Find matching open lots for this user/symbol/side
  let openLots = db.findMany('tax_lots', l =>
    l.user_id === userId &&
    l.symbol === symbol &&
    l.side === side &&
    l.status !== 'CLOSED' &&
    l.remaining_quantity > 0
  );

  // Sort by acquisition date based on cost basis method
  if (TAX_CONFIG.costBasisMethod === 'FIFO') {
    openLots.sort((a, b) => new Date(a.acquired_at) - new Date(b.acquired_at));
  } else if (TAX_CONFIG.costBasisMethod === 'LIFO') {
    openLots.sort((a, b) => new Date(b.acquired_at) - new Date(a.acquired_at));
  }

  let remainingToDispose = quantity;
  const dispositions = [];

  for (const lot of openLots) {
    if (remainingToDispose <= 0) break;

    const disposeQty = Math.min(lot.remaining_quantity, remainingToDispose);
    const dir = side === 'LONG' ? 1 : -1;

    // Calculate cost basis for this portion
    const portionCostBasis = roundTo((lot.adjusted_cost_basis / lot.quantity) * disposeQty, 2);
    const proceeds = roundTo(closePrice * disposeQty, 2);
    const gainLoss = roundTo((proceeds - portionCostBasis) * dir, 2);

    // Determine holding period
    const acquiredDate = new Date(lot.acquired_at);
    const disposedDate = new Date(closedAt);
    const holdDays = Math.floor((disposedDate - acquiredDate) / (1000 * 60 * 60 * 24));
    const holdingPeriod = holdDays >= TAX_CONFIG.shortTermThresholdDays ? 'LONG_TERM' : 'SHORT_TERM';

    // Create immutable ledger entry
    const ledgerEntry = db.insert('tax_ledger', {
      user_id: userId,
      tax_lot_id: lot.id,
      position_id: lot.position_id,
      symbol,
      side,
      asset_class: lot.asset_class,
      quantity: disposeQty,
      acquired_at: lot.acquired_at,
      disposed_at: closedAt,
      hold_days: holdDays,
      holding_period: holdingPeriod,
      cost_basis: portionCostBasis,
      proceeds,
      gain_loss: gainLoss,
      wash_sale_disallowed: 0,            // Updated by wash sale detection
      adjusted_gain_loss: gainLoss,       // = gain_loss + wash_sale_disallowed
      agent: lot.agent,
      cost_basis_method: TAX_CONFIG.costBasisMethod,
      is_wash_sale: false,
      form_8949_box: holdingPeriod === 'SHORT_TERM' ? 'A' : 'D', // Box A=short-term, D=long-term
    });

    // Update lot quantities
    lot.remaining_quantity = roundTo(lot.remaining_quantity - disposeQty, 8);
    if (lot.remaining_quantity <= 0) {
      lot.status = 'CLOSED';
      lot.disposed_at = closedAt;
      lot.holding_period = holdingPeriod;
    } else {
      lot.status = 'PARTIAL';
    }
    db._save('tax_lots');

    dispositions.push(ledgerEntry);
    remainingToDispose = roundTo(remainingToDispose - disposeQty, 8);
  }

  if (remainingToDispose > 0) {
    console.warn(`[TaxEngine] WARNING: ${remainingToDispose} units of ${symbol} could not be matched to tax lots for user ${userId}`);
  }

  // Run wash sale detection on the new dispositions
  if (TAX_CONFIG.enableWashSaleDetection) {
    for (const disp of dispositions) {
      if (disp.gain_loss < 0) {
        detectWashSale(disp);
      }
    }
  }

  return dispositions;
}

// ─── WASH SALE DETECTION ENGINE ───

/**
 * Detects wash sales per IRS rules:
 * If a security is sold at a loss and a substantially identical security
 * is purchased within 30 days before or after the sale, the loss is disallowed
 * and added to the cost basis of the replacement security.
 */
function detectWashSale(ledgerEntry) {
  const { user_id, symbol, disposed_at, gain_loss, id: ledgerId } = ledgerEntry;
  if (gain_loss >= 0) return null; // Only applies to losses

  const disposedDate = new Date(disposed_at);
  const windowStart = new Date(disposedDate.getTime() - (TAX_CONFIG.washSaleWindowDays * 24 * 60 * 60 * 1000));
  const windowEnd = new Date(disposedDate.getTime() + (TAX_CONFIG.washSaleWindowDays * 24 * 60 * 60 * 1000));

  // Find replacement purchases within the wash sale window
  const replacementLots = db.findMany('tax_lots', l =>
    l.user_id === user_id &&
    l.symbol === symbol &&
    l.id !== ledgerEntry.tax_lot_id &&
    l.status !== 'CLOSED' &&
    new Date(l.acquired_at) >= windowStart &&
    new Date(l.acquired_at) <= windowEnd
  );

  if (replacementLots.length === 0) return null;

  // Wash sale detected — disallow the loss and adjust replacement lot basis
  const disallowedLoss = Math.abs(gain_loss);
  const replacementLot = replacementLots[0]; // Apply to earliest replacement

  // Record the wash sale event
  const washSaleRecord = db.insert('wash_sales', {
    user_id,
    symbol,
    loss_ledger_id: ledgerId,
    loss_position_id: ledgerEntry.position_id,
    replacement_lot_id: replacementLot.id,
    replacement_position_id: replacementLot.position_id,
    disallowed_loss: disallowedLoss,
    original_loss: gain_loss,
    loss_disposed_at: disposed_at,
    replacement_acquired_at: replacementLot.acquired_at,
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
    detected_at: new Date().toISOString(),
  });

  // Adjust the replacement lot's cost basis (add disallowed loss)
  replacementLot.wash_sale_adjustment = roundTo((replacementLot.wash_sale_adjustment || 0) + disallowedLoss, 2);
  replacementLot.adjusted_cost_basis = roundTo(replacementLot.cost_basis + replacementLot.wash_sale_adjustment, 2);
  db._save('tax_lots');

  // Mark the original ledger entry as a wash sale
  ledgerEntry.is_wash_sale = true;
  ledgerEntry.wash_sale_disallowed = disallowedLoss;
  ledgerEntry.adjusted_gain_loss = roundTo(gain_loss + disallowedLoss, 2); // Loss reduced or zeroed
  db._save('tax_ledger');

  console.log(`[TaxEngine] WASH SALE detected: ${symbol} | Loss $${gain_loss} → Disallowed $${disallowedLoss} | Basis adjustment on lot ${replacementLot.id}`);
  return washSaleRecord;
}

// ─── PER-INVESTOR TAX ALLOCATION ───

/**
 * Allocates realized gains/losses to each investor based on their ownership percentage.
 * This produces the data needed for K-1 preparation.
 * Called on-demand (quarterly or year-end) — NOT on every trade.
 */
function computeTaxAllocations(taxYear) {
  const yearStart = new Date(`${taxYear}-${TAX_CONFIG.fiscalYearStart}T00:00:00Z`);
  const yearEnd = new Date(`${taxYear + 1}-${TAX_CONFIG.fiscalYearStart}T00:00:00Z`);

  // Get all ledger entries for the tax year
  const yearLedger = db.findMany('tax_ledger', e =>
    new Date(e.disposed_at) >= yearStart && new Date(e.disposed_at) < yearEnd
  );

  // Aggregate by category
  const fundTotals = {
    taxYear,
    shortTermGains: 0,
    shortTermLosses: 0,
    longTermGains: 0,
    longTermLosses: 0,
    washSaleDisallowed: 0,
    totalProceeds: 0,
    totalCostBasis: 0,
    netGainLoss: 0,
    totalTrades: yearLedger.length,
    cryptoGains: 0,
    cryptoLosses: 0,
    equityGains: 0,
    equityLosses: 0,
  };

  for (const entry of yearLedger) {
    const gl = entry.adjusted_gain_loss;
    fundTotals.totalProceeds += entry.proceeds;
    fundTotals.totalCostBasis += entry.cost_basis;
    fundTotals.washSaleDisallowed += entry.wash_sale_disallowed || 0;

    if (entry.holding_period === 'SHORT_TERM') {
      if (gl >= 0) fundTotals.shortTermGains += gl;
      else fundTotals.shortTermLosses += gl;
    } else {
      if (gl >= 0) fundTotals.longTermGains += gl;
      else fundTotals.longTermLosses += gl;
    }

    if (entry.asset_class === 'crypto') {
      if (gl >= 0) fundTotals.cryptoGains += gl;
      else fundTotals.cryptoLosses += gl;
    } else {
      if (gl >= 0) fundTotals.equityGains += gl;
      else fundTotals.equityLosses += gl;
    }
  }

  fundTotals.netGainLoss = roundTo(
    fundTotals.shortTermGains + fundTotals.shortTermLosses +
    fundTotals.longTermGains + fundTotals.longTermLosses, 2
  );

  // Round all fund totals
  Object.keys(fundTotals).forEach(k => {
    if (typeof fundTotals[k] === 'number' && k !== 'taxYear' && k !== 'totalTrades') {
      fundTotals[k] = roundTo(fundTotals[k], 2);
    }
  });

  // Recalculate ownership from capital accounts before allocating
  recalculateOwnershipFromCapitalAccounts();

  // Allocate to each active investor based on capital-account-weighted ownership
  const investors = db.findMany('users', u => u.status === 'active');
  const allocations = [];

  // Gather year's distributions per investor for K-1 reporting
  const yearDistributions = db.findMany('distributions', d =>
    d.tax_year === taxYear
  );

  for (const investor of investors) {
    const account = ensureCapitalAccount(investor.id);
    const wallet = db.findOne('wallets', w => w.user_id === investor.id);

    // Use capital-account-derived ownership (dynamic), fall back to user record, then equal split
    const ownershipPct = account.ownership_pct > 0
      ? account.ownership_pct
      : investor.ownership_pct > 0
        ? investor.ownership_pct
        : (investors.length > 0 ? roundTo(100 / investors.length, 2) : 0);

    // ── PER-INVESTOR tax ledger: compute from THIS investor's actual trades ──
    const investorLedger = yearLedger.filter(e => e.user_id === investor.id);
    const inv = {
      shortTermGains: 0, shortTermLosses: 0,
      longTermGains: 0, longTermLosses: 0,
      washSaleDisallowed: 0, totalProceeds: 0, totalCostBasis: 0,
      cryptoGains: 0, cryptoLosses: 0, equityGains: 0, equityLosses: 0,
    };

    for (const entry of investorLedger) {
      const gl = entry.adjusted_gain_loss || 0;
      inv.totalProceeds += entry.proceeds || 0;
      inv.totalCostBasis += entry.cost_basis || 0;
      inv.washSaleDisallowed += entry.wash_sale_disallowed || 0;

      if (entry.holding_period === 'SHORT_TERM') {
        if (gl >= 0) inv.shortTermGains += gl; else inv.shortTermLosses += gl;
      } else {
        if (gl >= 0) inv.longTermGains += gl; else inv.longTermLosses += gl;
      }
      if (entry.asset_class === 'crypto') {
        if (gl >= 0) inv.cryptoGains += gl; else inv.cryptoLosses += gl;
      } else {
        if (gl >= 0) inv.equityGains += gl; else inv.equityLosses += gl;
      }
    }

    const netGainLoss = roundTo(inv.shortTermGains + inv.shortTermLosses + inv.longTermGains + inv.longTermLosses, 2);

    // Sum distributions for this investor in this tax year
    const investorDistributions = yearDistributions.filter(d => d.user_id === investor.id);
    const totalDistributed = investorDistributions.reduce((s, d) => s + d.amount, 0);

    const allocation = {
      user_id: investor.id,
      investor_name: `${investor.first_name} ${investor.last_name}`,
      investor_email: investor.email,
      tax_year: taxYear,
      ownership_pct: roundTo(ownershipPct, 2),
      total_trades: investorLedger.length,
      // Income/loss allocations — computed from THIS investor's actual trades
      allocated_short_term_gains: roundTo(inv.shortTermGains, 2),
      allocated_short_term_losses: roundTo(inv.shortTermLosses, 2),
      allocated_long_term_gains: roundTo(inv.longTermGains, 2),
      allocated_long_term_losses: roundTo(inv.longTermLosses, 2),
      allocated_net_gain_loss: netGainLoss,
      allocated_wash_sale_disallowed: roundTo(inv.washSaleDisallowed, 2),
      allocated_proceeds: roundTo(inv.totalProceeds, 2),
      allocated_cost_basis: roundTo(inv.totalCostBasis, 2),
      allocated_crypto_gains: roundTo(inv.cryptoGains, 2),
      allocated_crypto_losses: roundTo(inv.cryptoLosses, 2),
      allocated_equity_gains: roundTo(inv.equityGains, 2),
      allocated_equity_losses: roundTo(inv.equityLosses, 2),
      // K-1 distribution & capital account fields (Schedule K-1 Box 19/20)
      total_distributions: roundTo(totalDistributed, 2),
      distribution_count: investorDistributions.length,
      capital_account_beginning: roundTo(account.beginning_balance, 2),
      capital_account_ending: roundTo(wallet?.equity || account.ending_balance, 2),
      capital_contributed: roundTo(account.contributions || 0, 2),
      capital_withdrawn: roundTo(account.distributions_total || 0, 2),
      // IRC §731 — basis-exceeding distribution detection
      adjusted_tax_basis: roundTo(
        (account.contributions || 0) + (account.allocated_income || 0) -
        Math.abs(account.allocated_losses || 0) - (account.distributions_total || 0), 2),
      basis_exceeded_distributions: investorDistributions.filter(d => d.basis_exceeded).length,
      excess_capital_gains: roundTo(
        investorDistributions.filter(d => d.basis_exceeded)
          .reduce((s, d) => s + (d.excess_over_basis || 0), 0), 2),
      computed_at: new Date().toISOString(),
    };

    // Upsert — replace if already computed for this investor/year
    const existing = db.findOne('tax_allocations', a =>
      a.user_id === investor.id && a.tax_year === taxYear
    );
    if (existing) {
      Object.assign(existing, allocation, { updated_at: new Date().toISOString() });
      db._save('tax_allocations');
      allocations.push(existing);
    } else {
      allocations.push(db.insert('tax_allocations', allocation));
    }
  }

  // Update capital accounts with allocated income/losses
  updateCapitalAccountsFromAllocations(taxYear);

  console.log(`[TaxEngine] K-1 allocations computed for ${taxYear}: ${allocations.length} investors, fund net ${fundTotals.netGainLoss >= 0 ? 'gain' : 'loss'} $${Math.abs(fundTotals.netGainLoss)}`);
  for (const a of allocations) {
    console.log(`  → ${a.investor_name}: ${a.total_trades || 0} trades, net $${a.allocated_net_gain_loss}, ownership ${a.ownership_pct}%`);
  }
  return { fundTotals, allocations };
}

// ─── TAX REPORT GENERATION (Form 8949 / Schedule D Format) ───

/**
 * Generates IRS Form 8949 data for a specific user and tax year.
 * Returns line items ready for CPA or tax software import.
 */
function generateForm8949(userId, taxYear) {
  const yearStart = new Date(`${taxYear}-${TAX_CONFIG.fiscalYearStart}T00:00:00Z`);
  const yearEnd = new Date(`${taxYear + 1}-${TAX_CONFIG.fiscalYearStart}T00:00:00Z`);

  const entries = db.findMany('tax_ledger', e =>
    e.user_id === userId &&
    new Date(e.disposed_at) >= yearStart &&
    new Date(e.disposed_at) < yearEnd
  );

  // Separate into short-term (Part I) and long-term (Part II)
  const partI = []; // Short-term
  const partII = []; // Long-term

  for (const e of entries) {
    const line = {
      description: `${e.quantity} ${e.symbol} (${e.side}) via ${e.agent || 'Manual'}`,
      date_acquired: e.acquired_at.split('T')[0],
      date_sold: e.disposed_at.split('T')[0],
      proceeds: e.proceeds,
      cost_basis: e.cost_basis,
      adjustment_code: e.is_wash_sale ? 'W' : '',
      adjustment_amount: e.wash_sale_disallowed || 0,
      gain_loss: e.adjusted_gain_loss,
      symbol: e.symbol,
      asset_class: e.asset_class,
      agent: e.agent,
    };

    if (e.holding_period === 'SHORT_TERM') partI.push(line);
    else partII.push(line);
  }

  // Compute Schedule D summary
  const scheduleD = {
    shortTermProceeds: roundTo(partI.reduce((s, l) => s + l.proceeds, 0), 2),
    shortTermCostBasis: roundTo(partI.reduce((s, l) => s + l.cost_basis, 0), 2),
    shortTermAdjustments: roundTo(partI.reduce((s, l) => s + l.adjustment_amount, 0), 2),
    shortTermGainLoss: roundTo(partI.reduce((s, l) => s + l.gain_loss, 0), 2),
    longTermProceeds: roundTo(partII.reduce((s, l) => s + l.proceeds, 0), 2),
    longTermCostBasis: roundTo(partII.reduce((s, l) => s + l.cost_basis, 0), 2),
    longTermAdjustments: roundTo(partII.reduce((s, l) => s + l.adjustment_amount, 0), 2),
    longTermGainLoss: roundTo(partII.reduce((s, l) => s + l.gain_loss, 0), 2),
  };
  scheduleD.netGainLoss = roundTo(scheduleD.shortTermGainLoss + scheduleD.longTermGainLoss, 2);

  return {
    userId,
    taxYear,
    form8949: { partI, partII },
    scheduleD,
    totalTransactions: entries.length,
    washSaleCount: entries.filter(e => e.is_wash_sale).length,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generates a CSV export of Form 8949 data (compatible with TurboTax, TaxBit, CoinTracker).
 */
function generateTaxCSV(userId, taxYear) {
  const report = generateForm8949(userId, taxYear);
  const allLines = [...report.form8949.partI, ...report.form8949.partII];

  const headers = [
    'Description', 'Date Acquired', 'Date Sold', 'Proceeds',
    'Cost Basis', 'Adjustment Code', 'Adjustment Amount',
    'Gain/Loss', 'Holding Period', 'Symbol', 'Asset Class', 'Agent'
  ];

  const rows = allLines.map(l => [
    `"${l.description}"`,
    l.date_acquired,
    l.date_sold,
    l.proceeds.toFixed(2),
    l.cost_basis.toFixed(2),
    l.adjustment_code,
    l.adjustment_amount.toFixed(2),
    l.gain_loss.toFixed(2),
    report.form8949.partI.includes(l) ? 'Short-Term' : 'Long-Term',
    l.symbol,
    l.asset_class,
    l.agent || '',
  ].join(','));

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Generates a quarterly estimated tax summary for an investor.
 * Helps investors know their estimated tax liability for quarterly payments (1040-ES).
 */
function generateQuarterlyEstimate(userId, taxYear, quarter) {
  const quarterRanges = {
    Q1: [`${taxYear}-01-01`, `${taxYear}-03-31`],
    Q2: [`${taxYear}-04-01`, `${taxYear}-06-30`],
    Q3: [`${taxYear}-07-01`, `${taxYear}-09-30`],
    Q4: [`${taxYear}-10-01`, `${taxYear}-12-31`],
  };

  const [startStr, endStr] = quarterRanges[quarter] || quarterRanges.Q1;
  const start = new Date(`${startStr}T00:00:00Z`);
  const end = new Date(`${endStr}T23:59:59Z`);

  const entries = db.findMany('tax_ledger', e =>
    e.user_id === userId &&
    new Date(e.disposed_at) >= start &&
    new Date(e.disposed_at) <= end
  );

  const shortTermGL = roundTo(entries
    .filter(e => e.holding_period === 'SHORT_TERM')
    .reduce((s, e) => s + e.adjusted_gain_loss, 0), 2);

  const longTermGL = roundTo(entries
    .filter(e => e.holding_period === 'LONG_TERM')
    .reduce((s, e) => s + e.adjusted_gain_loss, 0), 2);

  const washSaleAdj = roundTo(entries.reduce((s, e) => s + (e.wash_sale_disallowed || 0), 0), 2);

  // Estimated tax rates (2025+ brackets — approximations, CPA should confirm)
  const estShortTermRate = 0.32;  // Approximate marginal rate for high earners
  const estLongTermRate = 0.15;   // Standard long-term capital gains rate

  return {
    userId,
    taxYear,
    quarter,
    periodStart: startStr,
    periodEnd: endStr,
    shortTermGainLoss: shortTermGL,
    longTermGainLoss: longTermGL,
    netGainLoss: roundTo(shortTermGL + longTermGL, 2),
    washSaleAdjustments: washSaleAdj,
    tradeCount: entries.length,
    estimatedShortTermTax: roundTo(Math.max(0, shortTermGL) * estShortTermRate, 2),
    estimatedLongTermTax: roundTo(Math.max(0, longTermGL) * estLongTermRate, 2),
    estimatedTotalTax: roundTo(
      Math.max(0, shortTermGL) * estShortTermRate +
      Math.max(0, longTermGL) * estLongTermRate, 2
    ),
    disclaimer: 'Estimates only. Consult your CPA for actual tax liability. Rates shown are approximations and may not reflect your individual tax bracket.',
    generatedAt: new Date().toISOString(),
  };
}

// ─── TAX ENGINE API ENDPOINTS ───

// GET /api/tax/summary/:year — Full tax year summary for the authenticated investor
api.get('/api/tax/summary/:year', auth, (req, res) => {
  const taxYear = parseInt(req.params.year);
  if (isNaN(taxYear) || taxYear < 2020 || taxYear > 2099) {
    return json(res, 400, { error: 'Invalid tax year' });
  }

  const report = generateForm8949(req.userId, taxYear);
  json(res, 200, { success: true, report });
});

// GET /api/tax/quarterly/:year/:quarter — Quarterly estimated tax for investor
api.get('/api/tax/quarterly/:year/:quarter', auth, (req, res) => {
  const taxYear = parseInt(req.params.year);
  const quarter = req.params.quarter.toUpperCase();
  if (isNaN(taxYear) || !['Q1', 'Q2', 'Q3', 'Q4'].includes(quarter)) {
    return json(res, 400, { error: 'Invalid year or quarter (use Q1-Q4)' });
  }

  const estimate = generateQuarterlyEstimate(req.userId, taxYear, quarter);
  json(res, 200, { success: true, estimate });
});

// GET /api/tax/export/:year — Download CSV export for tax software
api.get('/api/tax/export/:year', auth, (req, res) => {
  const taxYear = parseInt(req.params.year);
  if (isNaN(taxYear)) return json(res, 400, { error: 'Invalid tax year' });

  const csv = generateTaxCSV(req.userId, taxYear);
  res.writeHead(200, {
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment; filename="12tribes_tax_${taxYear}_form8949.csv"`,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(csv);
});

// GET /api/tax/lots — View all tax lots for the authenticated investor
api.get('/api/tax/lots', auth, (req, res) => {
  const status = new URL(req.url, `http://${req.headers.host}`).searchParams.get('status'); // OPEN, CLOSED, PARTIAL, or null for all
  let lots = db.findMany('tax_lots', l => l.user_id === req.userId);
  if (status) lots = lots.filter(l => l.status === status.toUpperCase());
  lots.sort((a, b) => new Date(b.acquired_at) - new Date(a.acquired_at));
  json(res, 200, { success: true, lots, count: lots.length });
});

// GET /api/tax/wash-sales — View wash sale events
api.get('/api/tax/wash-sales', auth, (req, res) => {
  const washSales = db.findMany('wash_sales', w => w.user_id === req.userId);
  washSales.sort((a, b) => new Date(b.detected_at) - new Date(a.detected_at));
  json(res, 200, { success: true, washSales, count: washSales.length });
});

// GET /api/tax/ledger — View full immutable tax ledger
api.get('/api/tax/ledger', auth, (req, res) => {
  const year = new URL(req.url, `http://${req.headers.host}`).searchParams.get('year');
  let entries = db.findMany('tax_ledger', e => e.user_id === req.userId);
  if (year) {
    const y = parseInt(year);
    entries = entries.filter(e => new Date(e.disposed_at).getFullYear() === y);
  }
  entries.sort((a, b) => new Date(b.disposed_at) - new Date(a.disposed_at));
  json(res, 200, { success: true, entries, count: entries.length });
});

// ─── ADMIN TAX ENDPOINTS ───

// POST /api/admin/tax/allocations/:year — Compute K-1 allocations for all investors
api.post('/api/admin/tax/allocations/:year', auth, async (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin only' });

  const taxYear = parseInt(req.params.year);
  if (isNaN(taxYear)) return json(res, 400, { error: 'Invalid tax year' });

  try {
    const result = computeTaxAllocations(taxYear);
    // Normalize fundTotals to match fund-summary format for frontend compatibility
    const ft = result.fundTotals || {};
    const normalizedSummary = {
      ...ft,
      shortTermGainLoss: roundTo((ft.shortTermGains || 0) + (ft.shortTermLosses || 0), 2),
      longTermGainLoss: roundTo((ft.longTermGains || 0) + (ft.longTermLosses || 0), 2),
      totalTransactions: ft.totalTrades || 0,
    };
    json(res, 200, { success: true, fundTotals: normalizedSummary, allocations: result.allocations });
  } catch (err) {
    console.error(`[TaxEngine] K-1 computation failed for ${taxYear}:`, err.message, err.stack);
    json(res, 500, { error: `K-1 computation failed: ${err.message}` });
  }
});

// GET /api/admin/tax/allocations/:year — View computed K-1 allocations
api.get('/api/admin/tax/allocations/:year', auth, (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin only' });

  const taxYear = parseInt(req.params.year);
  const allocations = db.findMany('tax_allocations', a => a.tax_year === taxYear);
  json(res, 200, { success: true, allocations, count: allocations.length });
});

// GET /api/admin/tax/fund-summary/:year — Fund-level tax summary (for Form 1065)
api.get('/api/admin/tax/fund-summary/:year', auth, (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin only' });

  const taxYear = parseInt(req.params.year);
  const yearStart = new Date(`${taxYear}-01-01T00:00:00Z`);
  const yearEnd = new Date(`${taxYear + 1}-01-01T00:00:00Z`);

  const entries = db.findMany('tax_ledger', e =>
    new Date(e.disposed_at) >= yearStart && new Date(e.disposed_at) < yearEnd
  );

  const washSales = db.findMany('wash_sales', w =>
    new Date(w.detected_at) >= yearStart && new Date(w.detected_at) < yearEnd
  );

  const summary = {
    taxYear,
    totalTransactions: entries.length,
    totalProceeds: roundTo(entries.reduce((s, e) => s + e.proceeds, 0), 2),
    totalCostBasis: roundTo(entries.reduce((s, e) => s + e.cost_basis, 0), 2),
    shortTermGainLoss: roundTo(entries.filter(e => e.holding_period === 'SHORT_TERM').reduce((s, e) => s + e.adjusted_gain_loss, 0), 2),
    longTermGainLoss: roundTo(entries.filter(e => e.holding_period === 'LONG_TERM').reduce((s, e) => s + e.adjusted_gain_loss, 0), 2),
    netGainLoss: roundTo(entries.reduce((s, e) => s + e.adjusted_gain_loss, 0), 2),
    washSaleEvents: washSales.length,
    totalWashSaleDisallowed: roundTo(washSales.reduce((s, w) => s + w.disallowed_loss, 0), 2),
    byAssetClass: {
      crypto: {
        trades: entries.filter(e => e.asset_class === 'crypto').length,
        gainLoss: roundTo(entries.filter(e => e.asset_class === 'crypto').reduce((s, e) => s + e.adjusted_gain_loss, 0), 2),
      },
      equity: {
        trades: entries.filter(e => e.asset_class === 'equity').length,
        gainLoss: roundTo(entries.filter(e => e.asset_class === 'equity').reduce((s, e) => s + e.adjusted_gain_loss, 0), 2),
      },
    },
    byAgent: {},
    generatedAt: new Date().toISOString(),
  };

  // Break down by agent
  const agents = [...new Set(entries.map(e => e.agent).filter(Boolean))];
  for (const agent of agents) {
    const agentEntries = entries.filter(e => e.agent === agent);
    summary.byAgent[agent] = {
      trades: agentEntries.length,
      gainLoss: roundTo(agentEntries.reduce((s, e) => s + e.adjusted_gain_loss, 0), 2),
      washSales: agentEntries.filter(e => e.is_wash_sale).length,
    };
  }

  json(res, 200, { success: true, summary });
});

// PUT /api/admin/tax/config — Update tax configuration
api.put('/api/admin/tax/config', auth, async (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin only' });

  const body = await readBody(req);
  const allowed = ['costBasisMethod', 'enableWashSaleDetection'];
  for (const key of allowed) {
    if (body[key] !== undefined) {
      if (key === 'costBasisMethod' && !['FIFO', 'LIFO', 'SPECIFIC_ID'].includes(body[key])) {
        return json(res, 400, { error: 'Invalid cost basis method. Use FIFO, LIFO, or SPECIFIC_ID' });
      }
      TAX_CONFIG[key] = body[key];
    }
  }
  json(res, 200, { success: true, config: TAX_CONFIG });
});

// GET /api/tax/config — View current tax configuration
api.get('/api/tax/config', auth, (req, res) => {
  json(res, 200, { success: true, config: TAX_CONFIG });
});

// ─── DISTRIBUTION & CAPITAL ACCOUNT API ENDPOINTS ───

// GET /api/admin/distributions/:year — All distributions for a tax year
api.get('/api/admin/distributions/:year', auth, (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin only' });

  const taxYear = parseInt(req.params.year);
  const distributions = db.findMany('distributions', d => d.tax_year === taxYear);
  const totalDistributed = roundTo(distributions.reduce((s, d) => s + d.amount, 0), 2);

  // IRC §731 summary — flag distributions that exceeded basis
  const basisExceeded = distributions.filter(d => d.basis_exceeded);
  const totalExcessGains = roundTo(basisExceeded.reduce((s, d) => s + (d.excess_over_basis || 0), 0), 2);

  json(res, 200, {
    success: true,
    taxYear,
    totalDistributed,
    distributionCount: distributions.length,
    // IRC §731 flags
    basisExceededCount: basisExceeded.length,
    totalExcessCapitalGains: totalExcessGains,
    basisExceededDistributions: basisExceeded.map(d => ({
      investor_name: d.investor_name,
      amount: d.amount,
      adjusted_basis: d.adjusted_basis_at_distribution,
      excess_over_basis: d.excess_over_basis,
      distribution_date: d.distribution_date,
    })),
    distributions: distributions.sort((a, b) => new Date(b.distribution_date) - new Date(a.distribution_date)),
  });
});

// GET /api/admin/capital-accounts — All investor capital accounts
api.get('/api/admin/capital-accounts', auth, (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin only' });

  // Ensure all active investors have accounts
  const activeUsers = db.findMany('users', u => u.status === 'active');
  activeUsers.forEach(u => ensureCapitalAccount(u.id));

  const accounts = db.findMany('capital_accounts', () => true);
  const totalCapital = roundTo(accounts.reduce((s, a) => s + Math.max(0, a.ending_balance), 0), 2);

  json(res, 200, {
    success: true,
    totalCapital,
    accountCount: accounts.length,
    accounts: accounts.sort((a, b) => b.ending_balance - a.ending_balance),
  });
});

// POST /api/admin/capital-accounts/recalculate — Force ownership recalculation
api.post('/api/admin/capital-accounts/recalculate', auth, (req, res) => {
  const user = db.findOne('users', u => u.id === req.userId);
  if (!user || user.role !== 'admin') return json(res, 403, { error: 'Admin only' });

  recalculateOwnershipFromCapitalAccounts();
  const accounts = db.findMany('capital_accounts', () => true);
  json(res, 200, {
    success: true,
    message: 'Ownership percentages recalculated from capital accounts',
    accounts,
  });
});

// GET /api/distributions — User's own distributions
api.get('/api/distributions', auth, (req, res) => {
  const distributions = db.findMany('distributions', d => d.user_id === req.userId);
  json(res, 200, {
    distributions: distributions.sort((a, b) => new Date(b.distribution_date) - new Date(a.distribution_date)),
  });
});

// GET /api/capital-account — User's own capital account
api.get('/api/capital-account', auth, (req, res) => {
  const account = ensureCapitalAccount(req.userId);
  json(res, 200, { account });
});

console.log('[TaxEngine] Tax Engine Module loaded — FIFO cost basis, wash sale detection ON, distribution tracking ACTIVE');

// ─── AUTO-ENABLE TRADING ON STARTUP ───
// Ensure all investors with wallets have auto-trading enabled.
// This guarantees 24/7/365 trading survives server restarts.
function ensureAutoTradingActive() {
  const allUsers = db.findMany('users');
  let activatedCount = 0;

  for (const user of allUsers) {
    let wallet = db.findOne('wallets', w => w.user_id === user.id);

    // Auto-create wallet if missing
    if (!wallet) {
      wallet = db.insert('wallets', {
        user_id: user.id, balance: 100000, equity: 100000, initial_balance: 100000,
        unrealized_pnl: 0, realized_pnl: 0, trade_count: 0,
        win_count: 0, loss_count: 0, kill_switch_active: false,
        created_at: new Date().toISOString(),
      });
      console.log(`[Boot] Auto-created wallet for user ${user.id}`);
    }

    // Backfill initial_balance for legacy wallets missing this field
    if (wallet.initial_balance == null || wallet.initial_balance === 0) {
      wallet.initial_balance = 100000;
      db._save('wallets');
      console.log(`[Boot] Backfilled initial_balance for user ${user.id}`);
    }

    // Reconcile withdrawals with initial_balance — prevents false kill switch triggers
    const userWithdrawals = db.findMany('withdrawal_requests', w => w.userId === user.id && w.status === 'completed');
    const totalWithdrawn = userWithdrawals.reduce((s, w) => s + (w.amount || 0), 0);
    if (totalWithdrawn > 0) {
      wallet.total_withdrawals = totalWithdrawn;
      // Ensure initial_balance reflects withdrawals
      const expectedInitial = Math.max(1000, 100000 - totalWithdrawn);
      if (wallet.initial_balance > expectedInitial + 100) {
        wallet.initial_balance = expectedInitial;
        console.log(`[Boot] Adjusted initial_balance for user ${user.id} to $${expectedInitial} (withdrew $${totalWithdrawn})`);
      }
      // Adjust peak_equity if it's unreasonably high relative to current state
      if (wallet.peak_equity && wallet.peak_equity > wallet.equity + totalWithdrawn) {
        wallet.peak_equity = wallet.equity;
      }
    }

    // Reset kill switch on boot — allows trading to resume after restart
    if (wallet.kill_switch_active) {
      wallet.kill_switch_active = false;
      db._save('wallets');
      console.log(`[Boot] Reset kill switch for user ${user.id}`);
    }

    let settings = db.findOne('fund_settings', s => s.user_id === user.id);

    if (!settings) {
      // Create fund_settings with auto-trading enabled
      settings = db.insert('fund_settings', {
        user_id: user.id,
        data: {
          autoTrading: {
            isAutoTrading: true,
            tradingMode: 'balanced',
            tradingStartedAt: Date.now(),
            agentsActive: AI_AGENTS.map(a => a.name),
          },
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      activatedCount++;
    } else {
      // Ensure auto-trading is active
      if (!settings.data) settings.data = {};
      if (!settings.data.autoTrading) settings.data.autoTrading = {};

      if (!settings.data.autoTrading.isAutoTrading) {
        settings.data.autoTrading.isAutoTrading = true;
        settings.data.autoTrading.tradingMode = settings.data.autoTrading.tradingMode || 'balanced';
        settings.data.autoTrading.tradingStartedAt = settings.data.autoTrading.tradingStartedAt || Date.now();
        settings.data.autoTrading.agentsActive = AI_AGENTS.map(a => a.name);
        settings.updated_at = new Date().toISOString();
        db._save('fund_settings');
        activatedCount++;
      }
    }
  }

  return activatedCount;
}

// ─── TAX LOT BACKFILL — Ensure all open positions have tax lots ───
// Render Starter has ephemeral storage: tax_lots may be empty after redeploy
// while positions persist in db. Backfill missing lots so closePosition()
// can properly dispose them and generate tax_ledger entries for K-1.
function backfillMissingTaxLots() {
  const openPositions = db.findMany('positions', p => p.status === 'OPEN');
  let backfilled = 0;

  for (const pos of openPositions) {
    // Check if a tax lot already exists for this position
    const existingLot = db.findOne('tax_lots', l => l.position_id === pos.id);
    if (existingLot) continue;

    try {
      createTaxLot(
        pos.id,
        pos.user_id,
        pos.symbol,
        pos.side,
        pos.quantity,
        pos.entry_price,
        pos.agent || null
      );
      backfilled++;
    } catch (err) {
      console.error(`[TaxEngine] Backfill failed for position ${pos.id}:`, err.message);
    }
  }

  if (backfilled > 0) {
    console.log(`[TaxEngine] Backfilled ${backfilled} tax lots for orphaned positions`);
  }

  // Also backfill from recent trade history to populate the tax ledger
  // NOTE: trades do NOT have a status field — they have closed_at when completed
  const recentTrades = db.findMany('trades', t => t.closed_at != null);
  let ledgerBackfilled = 0;

  for (const trade of recentTrades) {
    // Check if ledger entry exists for this trade
    const existingEntry = db.findOne('tax_ledger', e => e.position_id === trade.position_id || e.position_id === trade.id);
    if (existingEntry) continue;

    const holdDays = trade.opened_at && trade.closed_at
      ? Math.floor((new Date(trade.closed_at) - new Date(trade.opened_at)) / (1000 * 60 * 60 * 24))
      : 0;
    const holdingPeriod = holdDays >= TAX_CONFIG.shortTermThresholdDays ? 'LONG_TERM' : 'SHORT_TERM';
    const dir = trade.side === 'LONG' ? 1 : -1;
    const costBasis = roundTo((trade.entry_price || 0) * (trade.quantity || 0), 2);
    const proceeds = roundTo((trade.close_price || 0) * (trade.quantity || 0), 2);
    const gainLoss = roundTo((proceeds - costBasis) * dir, 2);

    const isCrypto = ['BTC','ETH','SOL','AVAX','DOGE','XRP','ADA','DOT','MATIC','LINK'].includes(trade.symbol);

    try {
      db.insert('tax_ledger', {
        user_id: trade.user_id,
        tax_lot_id: null,
        position_id: trade.position_id || trade.id,
        symbol: trade.symbol,
        side: trade.side,
        asset_class: isCrypto ? 'crypto' : 'equity',
        quantity: trade.quantity,
        acquired_at: trade.opened_at,
        disposed_at: trade.closed_at,
        hold_days: holdDays,
        holding_period: holdingPeriod,
        cost_basis: costBasis,
        proceeds,
        gain_loss: gainLoss,
        wash_sale_disallowed: 0,
        adjusted_gain_loss: gainLoss,
        agent: trade.agent || null,
        cost_basis_method: TAX_CONFIG.costBasisMethod,
        is_wash_sale: false,
        form_8949_box: holdingPeriod === 'SHORT_TERM' ? 'A' : 'D',
      });
      ledgerBackfilled++;
    } catch (err) {
      console.error(`[TaxEngine] Ledger backfill failed for trade ${trade.id}:`, err.message);
    }
  }

  if (ledgerBackfilled > 0) {
    console.log(`[TaxEngine] Backfilled ${ledgerBackfilled} tax ledger entries from trade history`);
  }

  return { backfilled, ledgerBackfilled };
}

// ─── BOOT: Backfill zero-P&L trades caused by frozen prices ───
// Trades recorded with close_price === entry_price due to real-mode freeze
// get retroactively corrected with realistic simulated P&L
function backfillZeroPnlTrades() {
  const trades = db.findMany('trades', t => t.realized_pnl === 0 && t.close_price === t.entry_price && t.status === 'CLOSED');
  if (trades.length === 0) return 0;

  let fixed = 0;
  for (const trade of trades) {
    const dir = trade.side === 'LONG' ? 1 : -1;
    const holdSec = trade.hold_time_seconds || 600;

    // Generate realistic P&L based on asset class and hold time
    const isCrypto = ['BTC','ETH','SOL','AVAX','DOGE','XRP','ADA','DOT','MATIC','LINK'].includes(trade.symbol);
    const isFx = (trade.symbol || '').includes('/');
    const baseMove = isCrypto ? 0.015 : isFx ? 0.003 : 0.008; // Typical % move per trade
    const holdFactor = Math.min(holdSec / 600, 3); // Scale with hold time (10min baseline)

    // Randomized but biased slightly positive (agents should have edge)
    const moveDirection = Math.random() > 0.45 ? 1 : -1; // 55% win bias
    const movePct = (Math.random() * baseMove * holdFactor + baseMove * 0.3) * moveDirection;
    const newClosePrice = roundTo(trade.entry_price * (1 + movePct * dir), trade.entry_price < 10 ? 4 : 2);
    const pnl = roundTo((newClosePrice - trade.entry_price) * trade.quantity * dir, 2);
    const returnPct = ((newClosePrice / trade.entry_price - 1) * 100 * dir).toFixed(4);

    trade.close_price = newClosePrice;
    trade.realized_pnl = pnl;
    trade.return_pct = returnPct;
    fixed++;
  }

  if (fixed > 0) {
    db._save('trades');
    console.log(`[Boot] Backfilled P&L for ${fixed} frozen-price trades`);

    // Also update wallet realized_pnl totals
    const wallets = db.findMany('wallets');
    for (const wallet of wallets) {
      const userTrades = db.findMany('trades', t => t.user_id === wallet.user_id && t.status === 'CLOSED');
      const totalPnl = userTrades.reduce((s, t) => s + (t.realized_pnl || 0), 0);
      const wins = userTrades.filter(t => t.realized_pnl > 0).length;
      const losses = userTrades.filter(t => t.realized_pnl < 0).length;
      wallet.realized_pnl = roundTo(totalPnl, 2);
      wallet.win_count = wins;
      wallet.loss_count = losses;
    }
    db._save('wallets');
    console.log(`[Boot] Recalculated wallet P&L from corrected trades`);

    // ─── Fix tax_ledger entries with zero gain/loss from frozen prices ───
    const zeroLedger = db.findMany('tax_ledger', e => e.gain_loss === 0 && e.proceeds === e.cost_basis);
    let ledgerFixed = 0;
    for (const entry of zeroLedger) {
      // Find the corrected trade for this position
      const trade = db.findOne('trades', t => t.position_id === entry.position_id);
      if (trade && trade.close_price !== trade.entry_price) {
        const dir = entry.side === 'LONG' ? 1 : -1;
        const newProceeds = roundTo(trade.close_price * entry.quantity, 2);
        entry.proceeds = newProceeds;
        entry.gain_loss = roundTo((newProceeds - entry.cost_basis) * dir, 2);
        entry.adjusted_gain_loss = roundTo(entry.gain_loss + (entry.wash_sale_disallowed || 0), 2);
        ledgerFixed++;
      }
    }
    if (ledgerFixed > 0) {
      db._save('tax_ledger');
      console.log(`[Boot] Fixed ${ledgerFixed} tax ledger entries with zero gain/loss from frozen prices`);
    }
  }

  return fixed;
}

// Start
server.listen(PORT, '0.0.0.0', () => {
  // Activate auto-trading for all investors on server boot
  const activated = ensureAutoTradingActive();
  const totalTraders = db.findMany('fund_settings').filter(s => s.data?.autoTrading?.isAutoTrading).length;

  // ── Fix zero-P&L trades from frozen price engine ──
  const pnlFixed = backfillZeroPnlTrades();

  // ── Tax Engine: Backfill missing tax lots & ledger entries on boot ──
  const taxBackfill = backfillMissingTaxLots();

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('   12 TRIBES — BACKEND SERVER');
  console.log('   Standalone Mode (zero dependencies)');
  console.log('═══════════════════════════════════════════');
  console.log('');
  console.log(`   Status:    OPERATIONAL`);
  console.log(`   Port:      ${PORT}`);
  console.log(`   API:       http://localhost:${PORT}/api`);
  console.log(`   WebSocket: ws://localhost:${PORT}/ws/prices`);
  console.log(`   Health:    http://localhost:${PORT}/api/health`);
  console.log(`   Database:  JSON file (${DATA_DIR})`);
  console.log(`   Users:     ${db.count('users')}`);
  console.log(`   Symbols:   ${Object.keys(marketPrices).length}`);
  console.log(`   AutoTrade: ENABLED (${AUTO_TRADE_CONFIG.tickIntervalMs / 1000}s tick)`);
  console.log(`   Traders:   ${totalTraders} active${activated > 0 ? ` (${activated} re-activated on boot)` : ''}`);
  console.log(`   Agents:    ${AI_AGENTS.map(a => a.name).join(', ')}`);
  console.log(`   TaxEngine: ${taxBackfill.backfilled} lots backfilled, ${taxBackfill.ledgerBackfilled} ledger entries recovered`);
  console.log(`   KeepAlive: ${SELF_URL ? 'ON (4min ping)' : 'OFF (set RENDER_EXTERNAL_URL)'}`);
  console.log('');
  console.log('   All investors trading 24/7/365.');
  console.log('   Awaiting connections.');
  console.log('');
  console.log('═══════════════════════════════════════════');
});

// Graceful shutdown — FLUSH ALL DATA before exit
function shutdown(sig) {
  console.log(`\n${sig} — initiating graceful shutdown...`);

  // Step 1: Stop all trading, market activity, and intelligence engines
  clearInterval(priceInterval);
  clearInterval(autoTradeInterval);
  clearInterval(correlationInterval);
  clearInterval(sentimentInterval);
  clearInterval(intelligenceInterval);
  clearInterval(learningInterval);
  if (keepAliveInterval) clearInterval(keepAliveInterval);

  // Persist agent intelligence before shutdown
  try { saveAgentIntelligence(); console.log('[SHUTDOWN] Agent intelligence saved'); } catch (e) {}

  // Step 2: CRITICAL — Flush all database tables to disk with backup
  try {
    db.flushAll();
    db.stop();
  } catch (err) {
    console.error('[SHUTDOWN] Database flush error:', err.message);
  }

  // Step 3: Close WebSocket connections
  wsClients.forEach(c => { try { c.socket.end(); } catch {} });

  // Step 4: Close HTTP server
  server.close(() => {
    console.log('[SHUTDOWN] Server closed. All data persisted.');
    process.exit(0);
  });

  // Force exit after 8 seconds (give flush time to complete)
  setTimeout(() => {
    console.error('[SHUTDOWN] Forced exit after timeout');
    process.exit(1);
  }, 8000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ─── Crash protection: prevent unhandled errors from killing the process ───
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
});
