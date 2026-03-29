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
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ═══════ CONFIG ═══════
const PORT = parseInt(process.env.PORT || '4000', 10);
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const JWT_SECRET = process.env.JWT_SECRET || 'tribes-dev-secret-' + randomBytes(16).toString('hex');
const DATA_DIR = join(__dirname, 'data');
const INITIAL_BALANCE = 100000;  // $100,000 virtual wallet
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'abose.ctc@gmail.com').toLowerCase();
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev'; // Resend default sender (works without domain verification)
const APP_NAME = '12 Tribes Investments';
const FRONTEND_ORIGIN = process.env.FRONTEND_URL || 'https://12-tribes-platform.vercel.app';

// Risk management defaults
const RISK = {
  maxPositionSizePct: 10,
  maxDailyLossPct: 5,
  maxDrawdownPct: 15,
  killSwitchDrawdownPct: 25,
  maxOrdersPerMinute: 10,
  confirmationThreshold: 10000,
};

// ═══════════════════════════════════════════
//   JSON FILE DATABASE
//   Drop-in replacement for PostgreSQL in dev
// ═══════════════════════════════════════════

class JsonDB {
  constructor(dataDir) {
    this.dir = dataDir;
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    this.tables = {};
    this._load('users');
    this._load('wallets');
    this._load('positions');
    this._load('trades');
    this._load('snapshots');
    this._load('login_log');
    this._load('agent_stats');
    this._load('broker_connections');
    this._load('risk_events');
    this._load('order_queue');
    this._load('access_requests');
    this._load('auto_trade_log');
    this._load('fund_settings');
    this._load('verification_codes');

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
  }

  _filePath(table) { return join(this.dir, `${table}.json`); }

  _load(table) {
    const fp = this._filePath(table);
    try {
      this.tables[table] = existsSync(fp) ? JSON.parse(readFileSync(fp, 'utf8')) : [];
    } catch {
      this.tables[table] = [];
    }
  }

  _save(table) {
    writeFileSync(this._filePath(table), JSON.stringify(this.tables[table], null, 2));
  }

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
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
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

function tickPrices() {
  for (const symbol of Object.keys(marketPrices)) {
    const price = marketPrices[symbol];
    const vol = symbol.includes('/') ? 0.0003 : ['BTC','ETH','SOL','AVAX','DOGE','XRP','ADA'].includes(symbol) ? 0.002 : 0.001;
    marketPrices[symbol] = parseFloat((price + price * (Math.random() - 0.498) * vol).toFixed(price < 10 ? 4 : 2));
  }
  updatePositionValues();
}

function updatePositionValues() {
  db.findMany('positions', p => p.status === 'OPEN').forEach(pos => {
    const price = marketPrices[pos.symbol] || pos.entry_price;
    const dir = pos.side === 'LONG' ? 1 : -1;
    pos.current_price = price;
    pos.unrealized_pnl = parseFloat(((price - pos.entry_price) * pos.quantity * dir).toFixed(2));
    pos.return_pct = parseFloat(((price / pos.entry_price - 1) * 100 * dir).toFixed(4));
  });

  // Update wallet equity
  db.findMany('wallets').forEach(wallet => {
    const positions = db.findMany('positions', p => p.user_id === wallet.user_id && p.status === 'OPEN');
    const unrealized = positions.reduce((s, p) => s + (p.unrealized_pnl || 0), 0);
    wallet.unrealized_pnl = unrealized;
    wallet.equity = wallet.balance + unrealized;
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
    } catch {}
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
  try { client.socket.write(wsEncodeFrame(data)); } catch {}
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
  const pnl = parseFloat(((closePrice - pos.entry_price) * pos.quantity * dir).toFixed(2));
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

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

// ─── AUTH: REGISTER ───
api.post('/api/auth/register', async (req, res) => {
  const body = await readBody(req);
  const { email, password, firstName, lastName, phone } = body;

  if (!email || !password || !firstName || !lastName) {
    return json(res, 400, { error: 'All fields required: email, password, firstName, lastName' });
  }
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
  const body = await readBody(req);
  const { email, password } = body;

  if (!email || !password) return json(res, 400, { error: 'Email and password required' });

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

// ─── AUTH: FORGOT PASSWORD (sends email with code) ───
api.post('/api/auth/forgot-password', async (req, res) => {
  const body = await readBody(req);
  const { email } = body;
  if (!email) return json(res, 400, { error: 'Email required' });

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

  // If code provided, verify it. If not, allow (backward compat with frontend-only codes)
  if (code) {
    const check = verifyCode(emailKey, 'password_reset', code);
    if (!check.valid) return json(res, 400, { error: check.reason });
  }

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
    if (existing.status === 'denied') return json(res, 200, { status: 'denied', message: 'Your previous request was not approved. Contact support for more information.' });
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

  const requests = db.findMany('access_requests').sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || ''));
  json(res, 200, requests);
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

  // Send email notification on approval
  if (status === 'approved' && request.email) {
    sendEmail(request.email, `${APP_NAME} — Access Approved!`, accessApprovedEmail(request.first_name || 'Investor'))
      .catch(() => {}); // best-effort
  }

  json(res, 200, { success: true, request });
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
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
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
  maxOpenPositions: 12,        // Per user — raised for 6 concurrent agents
  maxDailyTrades: 80,          // Per user — 6 agents need room
  positionSizePct: 0.025,      // 2.5% of equity per trade (conservative with 6 agents)
  consensusThreshold: 0.5,     // 50%+ agents must agree for trade
};

let autoTradeTickCount = 0;

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
}

/**
 * ALL 6 agents run concurrently each tick.
 * Each agent evaluates its own symbols, then the collective makes consensus decisions.
 */
function runAllAgents(userId, fundData) {
  const wallet = db.findOne('wallets', w => w.user_id === userId);
  if (!wallet || wallet.kill_switch_active) return;

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayTrades = db.count('trades', t => t.user_id === userId && new Date(t.closed_at) >= todayStart);
  const todayOpens = db.count('positions', p => p.user_id === userId && new Date(p.opened_at) >= todayStart);
  if (todayTrades + todayOpens >= AUTO_TRADE_CONFIG.maxDailyTrades) return;

  const openPositions = db.findMany('positions', p => p.user_id === userId && p.status === 'OPEN');

  // ─── PHASE 1: Sentinel (Risk Manager) reviews open positions ───
  if (openPositions.length > 0) {
    sentinelRiskReview(userId, openPositions);
  }

  // ─── PHASE 2: Titan (Position Manager) scales/trims existing positions ───
  if (openPositions.length > 0) {
    titanPositionManagement(userId, openPositions, wallet);
  }

  // ─── PHASE 3: All signal agents generate trade proposals ───
  const signalAgents = AI_AGENTS.filter(a => !a.isRiskManager && !a.isPositionManager);
  const proposals = [];

  for (const agent of signalAgents) {
    const tradable = agent.symbols.filter(s => marketPrices[s] !== undefined);
    if (tradable.length === 0) continue;

    // Each agent picks their top opportunity
    const symbol = tradable[Math.floor(Math.random() * tradable.length)];
    const rand = Math.random();
    const side = rand < agent.longBias ? 'LONG' : 'SHORT';
    const confidence = 0.5 + Math.random() * 0.5; // 0.5-1.0

    proposals.push({
      agent: agent.name,
      symbol,
      side,
      confidence,
      reason: side === 'LONG' ? agent.reasons.long : agent.reasons.short,
    });
  }

  // ─── PHASE 4: Consensus — group proposals by symbol, execute if consensus ───
  const symbolVotes = {};
  for (const p of proposals) {
    if (!symbolVotes[p.symbol]) symbolVotes[p.symbol] = { long: [], short: [], total: 0 };
    symbolVotes[p.symbol].total++;
    if (p.side === 'LONG') symbolVotes[p.symbol].long.push(p);
    else symbolVotes[p.symbol].short.push(p);
  }

  // Execute trades where multiple agents agree (or single high-confidence)
  for (const [symbol, votes] of Object.entries(symbolVotes)) {
    if (openPositions.length >= AUTO_TRADE_CONFIG.maxOpenPositions) break;

    // Already have a position in this symbol? Skip new entry.
    if (openPositions.some(p => p.symbol === symbol)) continue;

    const longVotes = votes.long.length;
    const shortVotes = votes.short.length;
    const totalVoters = proposals.length;

    let side, reason, leadAgent;

    if (longVotes > shortVotes && longVotes / totalVoters >= AUTO_TRADE_CONFIG.consensusThreshold) {
      side = 'LONG';
      const best = votes.long.sort((a, b) => b.confidence - a.confidence)[0];
      leadAgent = best.agent;
      reason = `Consensus LONG (${longVotes}/${totalVoters} agents) — ${best.reason}`;
    } else if (shortVotes > longVotes && shortVotes / totalVoters >= AUTO_TRADE_CONFIG.consensusThreshold) {
      side = 'SHORT';
      const best = votes.short.sort((a, b) => b.confidence - a.confidence)[0];
      leadAgent = best.agent;
      reason = `Consensus SHORT (${shortVotes}/${totalVoters} agents) — ${best.reason}`;
    } else if (votes.total === 1) {
      // Single agent proposal — execute if confidence > 0.75
      const single = votes.long[0] || votes.short[0];
      if (single.confidence < 0.75) continue;
      side = single.side;
      leadAgent = single.agent;
      reason = `Solo signal (${(single.confidence * 100).toFixed(0)}% confidence) — ${single.reason}`;
    } else {
      continue; // No consensus
    }

    // Position sizing
    const price = marketPrices[symbol];
    if (!price) continue;
    const equity = wallet.equity || wallet.balance || 100000;
    const maxPosValue = equity * AUTO_TRADE_CONFIG.positionSizePct;
    const quantity = Math.max(1, Math.floor(maxPosValue / price));

    const result = executeTrade(userId, { symbol, side, quantity, agent: leadAgent, price });
    if (result.success) {
      logAutoTrade(userId, leadAgent, symbol, side, quantity, reason);
    }
  }
}

/**
 * Sentinel agent — reviews all open positions for risk and closes bad ones
 */
function sentinelRiskReview(userId, openPositions) {
  for (const pos of openPositions) {
    const currentPrice = marketPrices[pos.symbol] || pos.current_price;
    const dir = pos.side === 'LONG' ? 1 : -1;
    const pnlPct = ((currentPrice / pos.entry_price) - 1) * 100 * dir;

    // Close if loss exceeds -5% (stop-loss)
    if (pnlPct < -5) {
      closePosition(userId, pos.id);
      logAutoTrade(userId, 'Sentinel', pos.symbol, 'CLOSE', pos.quantity,
        `Risk stop — ${pnlPct.toFixed(1)}% loss exceeds threshold`);
      continue;
    }

    // Close if profit exceeds +10% (take-profit)
    if (pnlPct > 10) {
      closePosition(userId, pos.id);
      logAutoTrade(userId, 'Sentinel', pos.symbol, 'CLOSE', pos.quantity,
        `Take profit — locking in ${pnlPct.toFixed(1)}% gain`);
      continue;
    }

    // Close if held too long (> 2 hours with no significant gain)
    const holdMs = Date.now() - new Date(pos.opened_at).getTime();
    if (holdMs > 7200000 && pnlPct < 1) {
      closePosition(userId, pos.id);
      logAutoTrade(userId, 'Sentinel', pos.symbol, 'CLOSE', pos.quantity,
        `Time exit — held ${Math.round(holdMs / 60000)}min with ${pnlPct.toFixed(1)}% return`);
    }
  }
}

/**
 * Titan agent — manages position sizing, scales winners
 */
function titanPositionManagement(userId, openPositions, wallet) {
  // Only act on ~20% of ticks to avoid over-trading
  if (Math.random() > 0.2) return;

  for (const pos of openPositions) {
    const currentPrice = marketPrices[pos.symbol] || pos.current_price;
    const dir = pos.side === 'LONG' ? 1 : -1;
    const pnlPct = ((currentPrice / pos.entry_price) - 1) * 100 * dir;

    // Scale into winners: if up > 3%, add to position (if room)
    if (pnlPct > 3 && openPositions.length < AUTO_TRADE_CONFIG.maxOpenPositions) {
      const equity = wallet.equity || wallet.balance || 100000;
      const addValue = equity * 0.015; // Add 1.5% of equity
      const addQty = Math.max(1, Math.floor(addValue / currentPrice));

      const result = executeTrade(userId, {
        symbol: pos.symbol, side: pos.side, quantity: addQty,
        agent: 'Titan', price: currentPrice,
      });
      if (result.success) {
        logAutoTrade(userId, 'Titan', pos.symbol, pos.side, addQty,
          `Scaling winner — adding to ${pnlPct.toFixed(1)}% gainer`);
      }
      break; // Only scale one position per tick
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
  }
  settings.updated_at = new Date().toISOString();
  db._save('fund_settings');

  json(res, 200, {
    success: true,
    isActive: settings.data.autoTrading.isAutoTrading,
    agents: settings.data.autoTrading.agentsActive,
  });
});

// Start
server.listen(PORT, '0.0.0.0', () => {
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
  console.log(`   Agents:    ${AI_AGENTS.map(a => a.name).join(', ')}`);
  console.log(`   KeepAlive: ${SELF_URL ? 'ON (4min ping)' : 'OFF (set RENDER_EXTERNAL_URL)'}`);
  console.log('');
  console.log('   Awaiting connections.');
  console.log('');
  console.log('═══════════════════════════════════════════');
});

// Graceful shutdown
function shutdown(sig) {
  console.log(`\n${sig} — shutting down...`);
  clearInterval(priceInterval);
  clearInterval(autoTradeInterval);
  if (keepAliveInterval) clearInterval(keepAliveInterval);
  wsClients.forEach(c => { try { c.socket.end(); } catch {} });
  server.close(() => { console.log('Server closed.'); process.exit(0); });
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
