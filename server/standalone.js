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
//   MARKET DATA + SIMULATED PRICE ENGINE
// ═══════════════════════════════════════════

const DEFAULT_PRICES = {
  "AAPL": 227.50, "MSFT": 422.30, "NVDA": 138.20, "TSLA": 278.40,
  "AMZN": 198.60, "GOOGL": 175.80, "META": 612.40, "JPM": 248.90,
  "AMD": 164.30, "PLTR": 72.80, "COIN": 248.50,
  "JNJ": 158.20, "VOO": 478.60,
  "BTC": 87432, "ETH": 3287, "SOL": 187.50, "AVAX": 38.20,
  "DOGE": 0.1742, "XRP": 2.18, "ADA": 0.72,
  "F": 11.40, "BAC": 42.80, "WISH": 5.20, "RIOT": 12.60, "GE": 174.30, "CCIV": 24.50,
  "EUR/USD": 1.0842, "GBP/USD": 1.2934, "USD/JPY": 150.85, "AUD/USD": 0.6521,
  "SPY": 521.47, "QQQ": 441.22, "GLD": 284.70, "TLT": 87.30,
  "IWM": 202.40, "EEM": 42.70,
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

// Seed price history with realistic synthetic data so agents can trade immediately after restart
for (const sym of Object.keys(DEFAULT_PRICES)) {
  const basePrice = DEFAULT_PRICES[sym];
  const hist = [];
  let p = basePrice * (0.97 + Math.random() * 0.06); // Start slightly off from current
  const baseVol = basePrice < 1 ? 0.008 : basePrice < 50 ? 0.003 : basePrice < 500 ? 0.002 : 0.0015;
  // Generate 120 ticks of realistic price action with trends and mean-reversion
  let drift = (Math.random() - 0.45) * baseVol * 2;
  for (let i = 0; i < PRICE_HISTORY_LEN; i++) {
    // Occasional regime shifts
    if (i % 30 === 0) drift = (Math.random() - 0.45) * baseVol * 2;
    const noise = (Math.random() - 0.5) * baseVol;
    p = p * (1 + drift + noise);
    hist.push(roundTo(p, basePrice < 10 ? 4 : 2));
  }
  // Ensure last price matches current market price
  hist[hist.length - 1] = basePrice;
  priceHistory[sym] = hist;
  symbolRegimes[sym] = 'ranging';
}
// Detect initial regimes from seeded data
for (const sym of Object.keys(DEFAULT_PRICES)) {
  symbolRegimes[sym] = detectRegime(priceHistory[sym]);
}

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
  let gains = 0, losses = 0;
  const recent = arr.slice(-(period + 1));
  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i] - recent[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - (100 / (1 + rs));
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

function detectRegime(hist) {
  if (hist.length < 30) return 'ranging';
  const shortSma = sma(hist, 10);
  const longSma = sma(hist, 30);
  const mom = momentum(hist, 20);
  if (shortSma > longSma * 1.001 && mom > 0.3) return 'trending_up';
  if (shortSma < longSma * 0.999 && mom < -0.3) return 'trending_down';
  return 'ranging';
}

// ─── Price tick with micro-trend persistence ───
// Prices exhibit short-term trends (momentum) that agents can exploit
const trendState = {}; // per-symbol trend drift
for (const sym of Object.keys(DEFAULT_PRICES)) {
  trendState[sym] = { drift: 0, duration: 0, maxDuration: 30 + Math.floor(Math.random() * 60) };
}

function tickPrices() {
  for (const symbol of Object.keys(marketPrices)) {
    const price = marketPrices[symbol];
    const isCrypto = ['BTC','ETH','SOL','AVAX','DOGE','XRP','ADA'].includes(symbol);
    const isFx = symbol.includes('/');
    const baseVol = isFx ? 0.0003 : isCrypto ? 0.002 : 0.001;

    // Micro-trend system: prices have short-lived directional biases
    let ts = trendState[symbol];
    ts.duration++;
    if (ts.duration >= ts.maxDuration) {
      // New micro-trend
      ts.drift = (Math.random() - 0.45) * baseVol * 2; // slight upward bias overall
      ts.duration = 0;
      ts.maxDuration = 20 + Math.floor(Math.random() * 80);
    }

    const noise = (Math.random() - 0.5) * baseVol;
    const change = ts.drift + noise;
    const decimals = price < 10 ? 4 : 2;
    marketPrices[symbol] = roundTo(price * (1 + change), decimals);

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

  // Update wallet equity
  db.findMany('wallets').forEach(wallet => {
    const positions = db.findMany('positions', p => p.user_id === wallet.user_id && p.status === 'OPEN');
    const unrealized = positions.reduce((s, p) => s + (p.unrealized_pnl || 0), 0);
    wallet.unrealized_pnl = roundTo(unrealized, 2);
    wallet.equity = roundTo(wallet.balance + unrealized, 2);
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

  // Drawdown check
  const drawdown = ((wallet.initial_balance - wallet.equity) / wallet.initial_balance) * 100;
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
  db._save('wallets');

  // Record trade
  db.insert('trades', {
    user_id: userId, wallet_id: wallet.id, position_id: pos.id,
    symbol: pos.symbol, side: pos.side, quantity: pos.quantity,
    entry_price: pos.entry_price, close_price: closePrice,
    realized_pnl: pnl, return_pct: ((closePrice / pos.entry_price - 1) * 100 * dir).toFixed(4),
    agent: pos.agent, execution_mode: 'paper',
    opened_at: pos.opened_at, closed_at: new Date().toISOString(), hold_time_seconds: holdTime,
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
    unrealized_pnl: 0,
    realized_pnl: 0,
    trade_count: 0,
    win_count: 0,
    loss_count: 0,
    deposit_amount: INITIAL_BALANCE,
    deposit_timestamp: new Date().toISOString(),
    kill_switch_active: false,
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

  json(res, 200, {
    id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name,
    avatar: user.avatar, role: user.role, tradingMode: user.trading_mode,
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
    };
  });

  json(res, 200, allUsers);
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
      agentCount: 6,
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
    // Deduct from wallet
    const wallet = db.findOne('wallets', w => w.user_id === wr.userId);
    if (wallet) {
      wallet.balance = Math.max(0, (wallet.balance || 0) - wr.amount);
      wallet.equity = Math.max(0, (wallet.equity || 0) - wr.amount);
      db._save('wallets');
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
  json(res, 200, {
    id: wallet.id, balance: wallet.balance, initialBalance: wallet.initial_balance,
    equity: wallet.equity, unrealizedPnL: wallet.unrealized_pnl, realizedPnL: wallet.realized_pnl,
    tradeCount: wallet.trade_count, winCount: wallet.win_count, lossCount: wallet.loss_count,
    winRate: (wallet.win_count + wallet.loss_count) > 0 ? (wallet.win_count / (wallet.win_count + wallet.loss_count) * 100) : 0,
    killSwitchActive: wallet.kill_switch_active,
    depositTimestamp: wallet.deposit_timestamp,
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

  json(res, 200, {
    period, currentEquity, initialBalance: wallet.initial_balance,
    periodReturn, allTimeReturn,
    allTimePnL: currentEquity - wallet.initial_balance,
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

// ─── WALLET: GROUP ───
api.get('/api/wallet/group', auth, (req, res) => {
  const wallets = db.findMany('wallets');
  const totalEquity = wallets.reduce((s, w) => s + w.equity, 0);
  const totalInitial = wallets.reduce((s, w) => s + w.initial_balance, 0);
  const totalRealized = wallets.reduce((s, w) => s + (w.realized_pnl || 0), 0);
  const totalUnrealized = wallets.reduce((s, w) => s + (w.unrealized_pnl || 0), 0);
  const totalWins = wallets.reduce((s, w) => s + (w.win_count || 0), 0);
  const totalLosses = wallets.reduce((s, w) => s + (w.loss_count || 0), 0);

  json(res, 200, {
    investorCount: wallets.length, totalEquity, totalInitial,
    totalRealizedPnL: totalRealized, totalUnrealizedPnL: totalUnrealized,
    totalPnL: totalRealized + totalUnrealized,
    returnPct: totalInitial > 0 ? ((totalEquity / totalInitial - 1) * 100) : 0,
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

  const drawdown = ((wallet.initial_balance - wallet.equity) / wallet.initial_balance * 100);
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
  json(res, 200, { prices: marketPrices, symbols: Object.keys(marketPrices), timestamp: Date.now() });
});

// ─── MARKET: RESEARCH ───
// Comprehensive research endpoint — technical analysis, AI signals, and agent insights
api.get('/api/market/research/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const price = marketPrices[symbol];
  if (price === undefined) {
    return json(res, 404, { error: `Symbol "${symbol}" not found. Available: ${Object.keys(marketPrices).join(', ')}` });
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
  const isCrypto = ['BTC', 'ETH', 'SOL', 'AVAX', 'DOGE', 'XRP', 'ADA'].includes(symbol);
  const isFx = symbol.includes('/');
  const isEtf = ['SPY', 'QQQ', 'GLD', 'TLT', 'IWM', 'EEM', 'VOO'].includes(symbol);
  const assetClass = isCrypto ? 'Cryptocurrency' : isFx ? 'Forex' : isEtf ? 'ETF' : 'Stock';

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
});

// ─── MARKET: SEARCH SYMBOLS ───
api.get('/api/market/search', (req, res) => {
  const q = (req.query.q || '').toUpperCase();
  if (!q) return json(res, 200, { results: Object.keys(marketPrices) });
  const results = Object.keys(marketPrices).filter(s => s.includes(q));
  json(res, 200, { results });
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

// ═══════════════════════════════════════════
//   SERVER-SIDE AUTONOMOUS TRADING ENGINE
//   Runs independently of browser — 24/7
// ═══════════════════════════════════════════

// ─── AGENT DEFINITIONS: Each agent has a DISTINCT role in the collective ───
const AI_AGENTS = [
  {
    name: 'Viper',
    role: 'SIGNAL_SCANNER',
    description: 'Scans momentum and breakout signals across growth/tech',
    symbols: ['NVDA', 'TSLA', 'META', 'AMD', 'PLTR', 'COIN'],
    longBias: 0.65,           // 65% long bias (trend following)
    reasons: { long: 'Momentum breakout detected', short: 'Trend exhaustion — taking profit' },
  },
  {
    name: 'Oracle',
    role: 'FUNDAMENTAL_ANALYST',
    description: 'Value investing — analyzes fundamentals, picks stable compounders',
    symbols: ['AAPL', 'MSFT', 'JPM', 'JNJ', 'SPY', 'VOO'],
    longBias: 0.70,           // 70% long bias (value buyer)
    reasons: { long: 'Undervalued entry — strong fundamentals', short: 'Overvaluation detected — trimming' },
  },
  {
    name: 'Spectre',
    role: 'VOLATILITY_TRADER',
    description: 'Exploits volatility in crypto and high-beta assets',
    symbols: ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ADA'],
    longBias: 0.55,           // 55% long bias (balanced vol trader)
    reasons: { long: 'Vol breakout — riding momentum', short: 'Mean reversion short — overbought' },
  },
  {
    name: 'Sentinel',
    role: 'RISK_MANAGER',
    description: 'Monitors portfolio risk, hedges, closes losing positions',
    symbols: ['GLD', 'TLT', 'SPY', 'QQQ', 'AAPL', 'MSFT'],
    longBias: 0.60,
    isRiskManager: true,       // Special role: reviews open positions for risk
    reasons: { long: 'Hedging — defensive position', short: 'Risk-off rotation — reducing exposure' },
  },
  {
    name: 'Phoenix',
    role: 'RECOVERY_SPECIALIST',
    description: 'Finds turnaround plays in beaten-down sectors',
    symbols: ['F', 'BAC', 'WISH', 'RIOT', 'GE', 'CCIV'],
    longBias: 0.60,
    reasons: { long: 'Recovery catalyst identified', short: 'Dead cat bounce — exiting' },
  },
  {
    name: 'Titan',
    role: 'POSITION_SIZER',
    description: 'Manages position sizes, scales winners, trims losers',
    symbols: ['SPY', 'QQQ', 'IWM', 'EEM', 'AAPL', 'MSFT'],
    longBias: 0.55,
    isPositionManager: true,   // Special role: scales existing positions
    reasons: { long: 'Scaling into winner — conviction high', short: 'Sector rotation — reallocating capital' },
  },
];

const AUTO_TRADE_CONFIG = {
  tickIntervalMs: 10000,       // Check every 10 seconds
  maxOpenPositions: 12,        // Per user — slightly reduced for quality > quantity
  maxDailyTrades: 120,         // Per user — focused on high-quality setups
  baseSizePct: 0.035,          // 3.5% of equity per trade (balanced growth)
  winnerSizePct: 0.055,        // 5.5% for high-conviction signals
  eliteSizePct: 0.07,          // 7% for multi-indicator confluence trades
  consensusThreshold: 0.3,     // Lower threshold — act on strong signals fast
  minSignalStrength: 0.50,     // Moderate threshold — allows more frequent trading while filtering noise
  maxCorrelatedPositions: 3,   // Max positions in same asset class
  maxDrawdownPct: 15,          // Kill switch trigger at -15% from peak equity
};

let autoTradeTickCount = 0;

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
}

// ─── Signal Quality Scoring v2 ───
// Multi-indicator confluence system: more agreement = stronger signal
// Tracks indicator alignment count for position sizing tiers
function computeSignal(symbol, agentStyle) {
  const hist = priceHistory[symbol];
  if (!hist || hist.length < 30) return { score: 0, reason: 'Insufficient data', confluence: 0 };

  const price = marketPrices[symbol];
  const sma10 = sma(hist, 10);
  const sma30 = sma(hist, 30);
  const ema10 = ema(hist, 10);
  const ema12 = ema(hist, 12);
  const ema26 = ema(hist, 26);
  const macdVal = ema12 - ema26;
  const rsiVal = rsi(hist, 14);
  const mom = momentum(hist, 20);
  const mom10 = momentum(hist, 10); // short-term momentum
  const vol = volatility(hist, 20);
  const regime = symbolRegimes[symbol];

  let score = 0;
  let reasons = [];
  let confluenceBullish = 0; // count of aligned bullish indicators
  let confluenceBearish = 0; // count of aligned bearish indicators

  // ─── TREND SIGNALS ───
  if (agentStyle === 'SIGNAL_SCANNER' || agentStyle === 'FUNDAMENTAL_ANALYST') {
    // SMA crossover
    if (sma10 > sma30 && mom > 0.1) { score += 0.3; confluenceBullish++; reasons.push('Uptrend (SMA cross)'); }
    else if (sma10 < sma30 && mom < -0.1) { score -= 0.3; confluenceBearish++; reasons.push('Downtrend (SMA cross)'); }

    // EMA support/resistance bounce
    if (ema10 > price * 0.998 && ema10 < price * 1.005 && regime === 'trending_up') {
      score += 0.2; confluenceBullish++; reasons.push('EMA support bounce');
    }

    // MACD crossover signal
    if (macdVal > 0 && ema12 > ema26) { score += 0.15; confluenceBullish++; reasons.push('MACD bullish'); }
    else if (macdVal < 0 && ema12 < ema26) { score -= 0.15; confluenceBearish++; reasons.push('MACD bearish'); }
  }

  // ─── MOMENTUM SIGNALS ───
  if (agentStyle === 'SIGNAL_SCANNER' || agentStyle === 'VOLATILITY_TRADER') {
    if (mom > 0.5) { score += 0.25; confluenceBullish++; reasons.push(`Momentum +${mom.toFixed(1)}%`); }
    else if (mom < -0.5) { score -= 0.25; confluenceBearish++; reasons.push(`Momentum ${mom.toFixed(1)}%`); }

    // Short-term acceleration — momentum of momentum
    if (mom10 > 0.2 && mom > 0) { score += 0.1; reasons.push('Accelerating upward'); }
    else if (mom10 < -0.2 && mom < 0) { score -= 0.1; reasons.push('Accelerating downward'); }
  }

  // ─── RSI SIGNALS (improved with divergence detection) ───
  if (rsiVal < 28) { score += 0.25; confluenceBullish++; reasons.push(`RSI deeply oversold (${rsiVal.toFixed(0)})`); }
  else if (rsiVal < 35 && mom10 > 0) { score += 0.15; confluenceBullish++; reasons.push(`RSI recovering from oversold (${rsiVal.toFixed(0)})`); }
  else if (rsiVal > 72) { score -= 0.2; confluenceBearish++; reasons.push(`RSI overbought (${rsiVal.toFixed(0)})`); }
  else if (rsiVal > 65 && mom10 < 0) { score -= 0.1; confluenceBearish++; reasons.push(`RSI fading from overbought (${rsiVal.toFixed(0)})`); }
  else if (rsiVal > 45 && rsiVal < 55 && regime === 'trending_up') { score += 0.08; reasons.push('RSI neutral in uptrend'); }

  // ─── REGIME BONUS ───
  if (regime === 'trending_up') { score += 0.12; confluenceBullish++; reasons.push('Bullish regime'); }
  else if (regime === 'trending_down') { score -= 0.12; confluenceBearish++; reasons.push('Bearish regime'); }

  // ─── VOLATILITY CONTEXT ───
  if (vol > 0.5 && agentStyle === 'VOLATILITY_TRADER') {
    score *= 1.2; reasons.push(`High vol (${vol.toFixed(1)}%)`);
  }
  // Penalize low-volatility environments for momentum traders
  if (vol < 0.15 && (agentStyle === 'SIGNAL_SCANNER' || agentStyle === 'VOLATILITY_TRADER')) {
    score *= 0.7; reasons.push('Low vol — reduced conviction');
  }

  // ─── RECOVERY SPECIALIST — oversold bounces with confluence ───
  if (agentStyle === 'RECOVERY_SPECIALIST') {
    if (rsiVal < 25 && mom < -0.5) { score += 0.4; confluenceBullish++; reasons.push('Deep oversold — recovery play'); }
    if (rsiVal < 35 && regime === 'ranging' && mom10 > 0) { score += 0.25; confluenceBullish++; reasons.push('Mean reversion setup with momentum shift'); }
    if (rsiVal < 35 && regime === 'ranging') { score += 0.15; reasons.push('Mean reversion setup'); }
  }

  // ─── MULTI-INDICATOR CONFLUENCE BONUS ───
  // When 3+ indicators agree, the signal is much higher quality
  const confluence = Math.max(confluenceBullish, confluenceBearish);
  if (confluence >= 4) { score *= 1.4; reasons.push(`Strong confluence (${confluence} indicators)`); }
  else if (confluence >= 3) { score *= 1.2; reasons.push(`Good confluence (${confluence} indicators)`); }

  // ─── HISTORICAL PERFORMANCE BIAS ───
  const sp = getSymbolPerf(symbol);
  const totalSymTrades = sp.wins + sp.losses;
  if (totalSymTrades > 5) {
    const symWinRate = sp.wins / totalSymTrades;
    if (symWinRate > 0.6) { score *= 1.15; reasons.push(`High win-rate symbol (${(symWinRate*100).toFixed(0)}%)`); }
    else if (symWinRate < 0.3) { score *= 0.5; reasons.push(`Poor symbol — heavily reduced`); }
    else if (symWinRate < 0.4) { score *= 0.75; reasons.push(`Low win-rate — reduced size`); }

    // Prefer the historically winning side
    const longWR = sp.longWins / Math.max(1, sp.longWins + sp.longLosses);
    const shortWR = sp.shortWins / Math.max(1, sp.shortWins + sp.shortLosses);
    if (score > 0 && longWR > 0.55) score *= 1.1;
    if (score < 0 && shortWR > 0.55) score *= 1.1;
    // Avoid sides with very poor track record
    if (score > 0 && longWR < 0.3 && (sp.longWins + sp.longLosses) > 3) { score *= 0.5; reasons.push('Poor long history — dampened'); }
    if (score < 0 && shortWR < 0.3 && (sp.shortWins + sp.shortLosses) > 3) { score *= 0.5; reasons.push('Poor short history — dampened'); }
  }

  return {
    score: Math.max(-1, Math.min(1, score)),
    reason: reasons.join(' | ') || 'No clear signal',
    indicators: { sma10, sma30, rsiVal, mom, vol, regime },
    confluence,
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
  if (!wallet || wallet.kill_switch_active) return;

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayTrades = db.count('trades', t => t.user_id === userId && new Date(t.closed_at) >= todayStart);
  const todayOpens = db.count('positions', p => p.user_id === userId && new Date(p.opened_at) >= todayStart);
  if (todayTrades + todayOpens >= AUTO_TRADE_CONFIG.maxDailyTrades) return;

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

  for (const agent of signalAgents) {
    const agentPerf = getAgentPerf(agent.name);
    const tradable = agent.symbols.filter(s => marketPrices[s] !== undefined && priceHistory[s]?.length >= 30);
    if (tradable.length === 0) continue;

    // Each agent scores ALL its symbols and picks the best
    let bestSignal = null;
    for (const symbol of tradable) {
      const signal = computeSignal(symbol, agent.role);
      const adjustedScore = signal.score * agentPerf.adaptiveConfidence;

      if (!bestSignal || Math.abs(adjustedScore) > Math.abs(bestSignal.adjustedScore)) {
        bestSignal = { symbol, ...signal, adjustedScore, agent: agent.name };
      }
    }

    if (bestSignal && Math.abs(bestSignal.adjustedScore) >= AUTO_TRADE_CONFIG.minSignalStrength) {
      allSignals.push(bestSignal);
    }
  }

  // ─── PHASE 3: Rank signals by strength, execute top opportunities ───
  allSignals.sort((a, b) => Math.abs(b.adjustedScore) - Math.abs(a.adjustedScore));

  // Asset class categorization for correlation limiting
  const getAssetClass = (sym) => {
    if (['BTC','ETH','SOL','AVAX','DOGE','XRP','ADA'].includes(sym)) return 'crypto';
    if (sym.includes('/')) return 'forex';
    if (['SPY','QQQ','GLD','TLT','IWM','EEM','VOO'].includes(sym)) return 'etf';
    return 'stock';
  };

  for (const signal of allSignals) {
    if (openPositions.length >= AUTO_TRADE_CONFIG.maxOpenPositions) break;

    // Skip if already have position in this symbol
    if (openPositions.some(p => p.symbol === signal.symbol)) continue;

    // Correlation limiting — max positions per asset class
    const assetClass = getAssetClass(signal.symbol);
    const classCount = openPositions.filter(p => getAssetClass(p.symbol) === assetClass).length;
    if (classCount >= AUTO_TRADE_CONFIG.maxCorrelatedPositions) continue;

    const side = signal.adjustedScore > 0 ? 'LONG' : 'SHORT';
    const strength = Math.abs(signal.adjustedScore);

    // Tiered position sizing based on signal confluence
    const price = marketPrices[signal.symbol];
    if (!price) continue;
    const equity = wallet.equity || wallet.balance || 100000;

    // Drawdown protection — reduce size when in drawdown
    const drawdownPct = wallet.initial_balance > 0
      ? ((equity / wallet.initial_balance) - 1) * 100 : 0;
    const drawdownMultiplier = drawdownPct < -10 ? 0.5 : drawdownPct < -5 ? 0.75 : 1.0;

    // Kill switch check
    if (drawdownPct < -AUTO_TRADE_CONFIG.maxDrawdownPct) {
      wallet.kill_switch_active = true;
      db._save('wallets');
      console.log(`[AutoTrader] KILL SWITCH for user ${userId} — drawdown ${drawdownPct.toFixed(1)}%`);
      break;
    }

    // Confluence-based sizing: elite > winner > base
    let sizePct;
    if (signal.confluence >= 4 && strength > 0.8) sizePct = AUTO_TRADE_CONFIG.eliteSizePct;
    else if (signal.confluence >= 3 || strength > 0.8) sizePct = AUTO_TRADE_CONFIG.winnerSizePct;
    else sizePct = AUTO_TRADE_CONFIG.baseSizePct;

    sizePct *= drawdownMultiplier;

    const maxPosValue = equity * sizePct;
    const quantity = Math.max(1, Math.floor(maxPosValue / price));

    const result = executeTrade(userId, { symbol: signal.symbol, side, quantity, agent: signal.agent, price });
    if (result.success) {
      const tier = signal.confluence >= 4 ? 'ELITE' : signal.confluence >= 3 ? 'HIGH' : 'BASE';
      const reason = `[${tier}] ${side} signal (${(strength * 100).toFixed(0)}% str, ${signal.confluence} confluence) — ${signal.reason}`;
      logAutoTrade(userId, signal.agent, signal.symbol, side, quantity, reason);
      openPositions.push(result.position);
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

    // ─── STOP-LOSS: Adaptive based on volatility + agent streak ───
    const vol = hist.length >= 20 ? volatility(hist, 20) : 1;
    const agentP = getAgentPerf(pos.agent || 'Unknown');
    // Tighten stops on losing streaks: -3 streak = 0.7x stop distance
    const streakFactor = agentP.streak < -2 ? 0.7 : agentP.streak < 0 ? 0.85 : 1.0;
    const stopLoss = -Math.max(1.2, Math.min(3.5, vol * 2 * streakFactor)); // Dynamic: -1.2% to -3.5%

    if (pnlPct < stopLoss) {
      closePosition(userId, pos.id);
      updatePerformanceFeedback(pos.agent, pos.symbol, pos.side, pos.unrealized_pnl || pnlPct);
      logAutoTrade(userId, 'Sentinel', pos.symbol, 'CLOSE', pos.quantity,
        `Adaptive stop — ${pnlPct.toFixed(1)}% loss (limit: ${stopLoss.toFixed(1)}%, streak: ${agentP.streak})`);
      continue;
    }

    // ─── TRAILING STOP: Lock in profits progressively ───
    // Once in profit, set a trailing stop that ratchets up
    if (pnlPct > 1.5) {
      // Trailing stop = peak PnL minus trail distance
      // Trail narrows as profit grows: at +2% trail 1%, at +5% trail 1.5%, at +8% trail 2%
      const trailDist = pnlPct < 3 ? 1.0 : pnlPct < 6 ? 1.5 : 2.0;
      const trailingStop = pnlPct - trailDist;

      // Check if price has retraced from a higher level
      // We don't store peak PnL, so we use momentum as a proxy for reversal
      const trendAligned = (pos.side === 'LONG' && mom > 0.05) || (pos.side === 'SHORT' && mom < -0.05);
      const regimeAligned = (pos.side === 'LONG' && regime === 'trending_up') || (pos.side === 'SHORT' && regime === 'trending_down');

      // Let big winners run in aligned trends
      if (trendAligned && regimeAligned && pnlPct < 10) continue;

      // Take profit if momentum fading or big enough gain
      if (!trendAligned || pnlPct > 6 || (pnlPct > 3 && regime === 'ranging')) {
        closePosition(userId, pos.id);
        updatePerformanceFeedback(pos.agent, pos.symbol, pos.side, pos.unrealized_pnl || pnlPct);
        logAutoTrade(userId, 'Sentinel', pos.symbol, 'CLOSE', pos.quantity,
          `Trailing stop — ${pnlPct.toFixed(1)}% gain${!trendAligned ? ' (momentum fading)' : ''}`);
        continue;
      }
    }

    // ─── EARLY EXIT: Cut losers faster when momentum confirms ───
    if (pnlPct < -0.5 && holdMinutes > 5) {
      const againstMom = (pos.side === 'LONG' && mom < -0.3) || (pos.side === 'SHORT' && mom > 0.3);
      const againstRegime = (pos.side === 'LONG' && regime === 'trending_down') || (pos.side === 'SHORT' && regime === 'trending_up');
      if (againstMom && againstRegime) {
        closePosition(userId, pos.id);
        updatePerformanceFeedback(pos.agent, pos.symbol, pos.side, pos.unrealized_pnl || pnlPct);
        logAutoTrade(userId, 'Sentinel', pos.symbol, 'CLOSE', pos.quantity,
          `Early cut — ${pnlPct.toFixed(1)}% with adverse momentum + regime`);
        continue;
      }
    }

    // ─── TIME EXIT: Close stale positions that aren't moving ───
    if (holdMinutes > 20 && Math.abs(pnlPct) < 0.3) {
      closePosition(userId, pos.id);
      updatePerformanceFeedback(pos.agent, pos.symbol, pos.side, pos.unrealized_pnl || pnlPct);
      logAutoTrade(userId, 'Titan', pos.symbol, 'CLOSE', pos.quantity,
        `Time exit — ${holdMinutes.toFixed(0)}min with ${pnlPct.toFixed(1)}% (freeing capital)`);
      continue;
    }

    // ─── REGIME REVERSAL EXIT: Close if market regime flipped against position ───
    if (pos.side === 'LONG' && regime === 'trending_down' && pnlPct < 1) {
      closePosition(userId, pos.id);
      updatePerformanceFeedback(pos.agent, pos.symbol, pos.side, pos.unrealized_pnl || pnlPct);
      logAutoTrade(userId, 'Sentinel', pos.symbol, 'CLOSE', pos.quantity,
        `Regime reversal — market turned bearish (${pnlPct.toFixed(1)}%)`);
      continue;
    }
    if (pos.side === 'SHORT' && regime === 'trending_up' && pnlPct < 1) {
      closePosition(userId, pos.id);
      updatePerformanceFeedback(pos.agent, pos.symbol, pos.side, pos.unrealized_pnl || pnlPct);
      logAutoTrade(userId, 'Sentinel', pos.symbol, 'CLOSE', pos.quantity,
        `Regime reversal — market turned bullish (${pnlPct.toFixed(1)}%)`);
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

// Auto-trading tick — every 10 seconds
const autoTradeInterval = setInterval(runAutoTradeTick, AUTO_TRADE_CONFIG.tickIntervalMs);

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

// ─── AUTO-ENABLE TRADING ON STARTUP ───
// Ensure all investors with wallets have auto-trading enabled.
// This guarantees 24/7/365 trading survives server restarts.
function ensureAutoTradingActive() {
  const allUsers = db.findMany('users');
  let activatedCount = 0;

  for (const user of allUsers) {
    const wallet = db.findOne('wallets', w => w.user_id === user.id);
    if (!wallet) continue; // No wallet = no trading

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

// Start
server.listen(PORT, '0.0.0.0', () => {
  // Activate auto-trading for all investors on server boot
  const activated = ensureAutoTradingActive();
  const totalTraders = db.findMany('fund_settings').filter(s => s.data?.autoTrading?.isAutoTrading).length;

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

  // Step 1: Stop all trading and market activity
  clearInterval(priceInterval);
  clearInterval(autoTradeInterval);
  if (keepAliveInterval) clearInterval(keepAliveInterval);

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
