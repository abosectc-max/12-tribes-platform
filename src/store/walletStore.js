// ═══════════════════════════════════════════
//   12 TRIBES — VIRTUAL WALLET STORE v2.0
//   Dynamic User Wallets | $100K Per Investor
//   No fake data — wallets created for registered users
//   Persistent via localStorage
// ═══════════════════════════════════════════

const INITIAL_BALANCE = 100_000;

const AI_AGENTS = ["Viper", "Oracle", "Spectre", "Sentinel", "Phoenix", "Titan"];

// Storage keys
const STORAGE_KEY_WALLETS = '12tribes_wallets';
const STORAGE_KEY_POSITIONS = '12tribes_positions';
const STORAGE_KEY_HISTORY = '12tribes_trade_history';
const STORAGE_KEY_AGENT_STATS = '12tribes_agent_stats';

function loadFromStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveToStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ═══════ WALLET STATE ═══════
let walletState = {
  wallets: loadFromStorage(STORAGE_KEY_WALLETS) || {},
  positions: loadFromStorage(STORAGE_KEY_POSITIONS) || [],
  tradeHistory: loadFromStorage(STORAGE_KEY_HISTORY) || [],
  agentStats: loadFromStorage(STORAGE_KEY_AGENT_STATS) || {},
  marketPrices: {},
  lastUpdate: Date.now(),
  dataSource: 'simulated',
};

// Initialize agent stats if empty
if (Object.keys(walletState.agentStats).length === 0) {
  AI_AGENTS.forEach(agent => {
    walletState.agentStats[agent] = {
      name: agent,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalPnL: 0,
      bestTrade: 0,
      worstTrade: 0,
      avgReturn: 0,
    };
  });
  saveToStorage(STORAGE_KEY_AGENT_STATS, walletState.agentStats);
}

// Persistence helpers
function persistWallets() {
  saveToStorage(STORAGE_KEY_WALLETS, walletState.wallets);
}

function persistPositions() {
  saveToStorage(STORAGE_KEY_POSITIONS, walletState.positions);
}

function persistHistory() {
  saveToStorage(STORAGE_KEY_HISTORY, walletState.tradeHistory);
}

function persistAgentStats() {
  saveToStorage(STORAGE_KEY_AGENT_STATS, walletState.agentStats);
}

// ═══════ WALLET CREATION (called on user registration) ═══════
export function createWallet(user) {
  if (!user || !user.id) return null;

  // Don't overwrite existing wallet
  if (walletState.wallets[user.id]) return walletState.wallets[user.id];

  const now = new Date();
  const wallet = {
    id: user.id,
    name: user.name || `${user.firstName} ${user.lastName}`,
    avatar: user.avatar || (user.firstName?.[0] || '') + (user.lastName?.[0] || ''),
    email: user.email,
    balance: INITIAL_BALANCE,
    initialBalance: INITIAL_BALANCE,
    equity: INITIAL_BALANCE,
    unrealizedPnL: 0,
    realizedPnL: 0,
    tradeCount: 0,
    winCount: 0,
    lossCount: 0,
    depositAmount: INITIAL_BALANCE,
    depositTimestamp: now.toISOString(),
    depositDate: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    depositTime: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    createdAt: now.toISOString(),
  };

  walletState.wallets[user.id] = wallet;
  persistWallets();
  return wallet;
}

// Ensure a wallet exists for a given user (auto-create if missing)
export function ensureWallet(user) {
  if (!user || !user.id) return null;
  if (walletState.wallets[user.id]) return walletState.wallets[user.id];
  return createWallet(user);
}

// ═══════ MARKET DATA ═══════
const DEFAULT_PRICES = {
  // Large-cap stocks
  "AAPL": 227.50, "MSFT": 422.30, "NVDA": 138.20, "TSLA": 278.40,
  "AMZN": 198.60, "GOOGL": 175.80, "META": 612.40, "JPM": 248.90,
  // Momentum & growth
  "AMD": 164.30, "PLTR": 72.80, "COIN": 248.50,
  // Stable / value
  "JNJ": 158.20, "VOO": 478.60,
  // Crypto
  "BTC": 87432, "ETH": 3287, "SOL": 187.50, "AVAX": 38.20,
  "DOGE": 0.1742, "XRP": 2.18, "ADA": 0.72,
  // Recovery / small-cap
  "F": 11.40, "BAC": 42.80, "WISH": 5.20, "RIOT": 12.60, "GE": 174.30, "CCIV": 24.50,
  // Forex
  "EUR/USD": 1.0842, "GBP/USD": 1.2934, "USD/JPY": 150.85, "AUD/USD": 0.6521,
  // ETFs & indices
  "SPY": 521.47, "QQQ": 441.22, "GLD": 284.70, "TLT": 87.30,
  "IWM": 202.40, "EEM": 42.70,
};

function initPrices() {
  walletState.marketPrices = { ...DEFAULT_PRICES };
}
initPrices();

// Simulate price movement
function tickPrices() {
  Object.keys(walletState.marketPrices).forEach(symbol => {
    const price = walletState.marketPrices[symbol];
    const volatility = symbol.includes("/") ? 0.001
      : ["BTC", "ETH", "SOL", "AVAX"].includes(symbol) ? 0.005
      : 0.003;
    const change = price * (Math.random() - 0.498) * volatility;
    walletState.marketPrices[symbol] = parseFloat((price + change).toFixed(
      price < 10 ? 4 : 2
    ));
  });
  walletState.lastUpdate = Date.now();
  updatePositionValues();
}

// ═══════ POSITION MANAGEMENT ═══════
function updatePositionValues() {
  walletState.positions.forEach(pos => {
    const currentPrice = walletState.marketPrices[pos.symbol] || pos.entryPrice;
    const direction = pos.side === "LONG" ? 1 : -1;
    pos.currentPrice = currentPrice;
    pos.unrealizedPnL = parseFloat(((currentPrice - pos.entryPrice) * pos.quantity * direction).toFixed(2));
    pos.returnPct = parseFloat(((currentPrice / pos.entryPrice - 1) * 100 * direction).toFixed(2));
  });

  // Update wallet equity for all active wallets
  Object.values(walletState.wallets).forEach(wallet => {
    const investorPositions = walletState.positions.filter(p => p.investorId === wallet.id);
    const unrealized = investorPositions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
    wallet.unrealizedPnL = unrealized;
    wallet.equity = wallet.balance + unrealized;
  });
}

// ═══════ TRADE EXECUTION ═══════
function executeTrade({ symbol, side, quantity, investorId, agent }) {
  const price = walletState.marketPrices[symbol];
  if (!price) return { success: false, error: "Symbol not found" };

  const wallet = walletState.wallets[investorId];
  if (!wallet) return { success: false, error: "Investor wallet not found. Please register first." };

  const cost = price * quantity;
  if (side === "LONG" && cost > wallet.balance) {
    return { success: false, error: "Insufficient balance" };
  }

  const tradeId = `TRD_${String(walletState.tradeHistory.length + walletState.positions.length + 1).padStart(5, "0")}`;
  const now = new Date();
  const position = {
    id: tradeId,
    symbol, side, quantity,
    entryPrice: price,
    currentPrice: price,
    investorId,
    agent: agent || AI_AGENTS[Math.floor(Math.random() * AI_AGENTS.length)],
    openTime: Date.now(),
    openTimestamp: now.toISOString(),
    unrealizedPnL: 0,
    returnPct: 0,
    status: "OPEN",
  };

  walletState.positions.push(position);

  if (side === "LONG") {
    wallet.balance -= cost;
  } else {
    wallet.balance -= cost * 0.1; // SHORT margin requirement
  }

  wallet.tradeCount++;
  persistWallets();
  persistPositions();

  return { success: true, trade: position };
}

function closePosition(positionId) {
  const posIndex = walletState.positions.findIndex(p => p.id === positionId);
  if (posIndex === -1) return { success: false, error: "Position not found" };

  const pos = walletState.positions[posIndex];
  const wallet = walletState.wallets[pos.investorId];

  if (!wallet) return { success: false, error: "Wallet not found" };

  const pnl = pos.unrealizedPnL;
  const cost = pos.entryPrice * pos.quantity;

  if (pos.side === "LONG") {
    wallet.balance += cost + pnl;
  } else {
    wallet.balance += (cost * 0.1) + pnl;
  }

  wallet.realizedPnL += pnl;
  if (pnl >= 0) wallet.winCount++;
  else wallet.lossCount++;

  // Update agent stats
  const agentStat = walletState.agentStats[pos.agent];
  if (agentStat) {
    agentStat.totalTrades++;
    agentStat.totalPnL += pnl;
    if (pnl >= 0) agentStat.wins++;
    else agentStat.losses++;
    if (pnl > agentStat.bestTrade) agentStat.bestTrade = pnl;
    if (pnl < agentStat.worstTrade) agentStat.worstTrade = pnl;
    agentStat.avgReturn = agentStat.totalPnL / agentStat.totalTrades;
  }

  const closedTrade = {
    ...pos,
    closePrice: pos.currentPrice,
    closeTime: Date.now(),
    closeTimestamp: new Date().toISOString(),
    realizedPnL: pnl,
    status: "CLOSED",
  };

  walletState.tradeHistory.push(closedTrade);
  walletState.positions.splice(posIndex, 1);

  persistWallets();
  persistPositions();
  persistHistory();
  persistAgentStats();

  return { success: true, trade: closedTrade };
}

// ═══════ PUBLIC API ═══════
export function getWalletState() {
  return { ...walletState };
}

export function getWallet(investorId) {
  return walletState.wallets[investorId] || null;
}

export function getPositions(investorId) {
  if (investorId) return walletState.positions.filter(p => p.investorId === investorId);
  return [...walletState.positions];
}

export function getTradeHistory(investorId) {
  if (investorId) return walletState.tradeHistory.filter(t => t.investorId === investorId);
  return [...walletState.tradeHistory];
}

export function getAgentLeaderboard() {
  return Object.values(walletState.agentStats)
    .sort((a, b) => b.totalPnL - a.totalPnL);
}

export function getMarketPrices() {
  return { ...walletState.marketPrices };
}

export function getAllSymbols() {
  return Object.keys(walletState.marketPrices);
}

export function getGroupStats() {
  const wallets = Object.values(walletState.wallets);
  if (wallets.length === 0) {
    return {
      totalEquity: 0, totalInitial: 0, totalRealizedPnL: 0,
      totalUnrealizedPnL: 0, totalPnL: 0, returnPct: 0,
      openPositions: 0, closedTrades: 0, investorCount: 0,
    };
  }
  const totalEquity = wallets.reduce((s, w) => s + w.equity, 0);
  const totalRealizedPnL = wallets.reduce((s, w) => s + w.realizedPnL, 0);
  const totalUnrealizedPnL = wallets.reduce((s, w) => s + w.unrealizedPnL, 0);
  const totalInitial = wallets.reduce((s, w) => s + w.initialBalance, 0);
  return {
    totalEquity,
    totalInitial,
    totalRealizedPnL,
    totalUnrealizedPnL,
    totalPnL: totalRealizedPnL + totalUnrealizedPnL,
    returnPct: totalInitial > 0 ? ((totalEquity / totalInitial) - 1) * 100 : 0,
    openPositions: walletState.positions.length,
    closedTrades: walletState.tradeHistory.length,
    investorCount: wallets.length,
  };
}

// ═══════ LIVE PRICE INTEGRATION ═══════
export function updateLivePrices(livePrices) {
  let updated = 0;
  Object.entries(livePrices).forEach(([symbol, data]) => {
    const price = typeof data === 'number' ? data : data?.price;
    if (price && walletState.marketPrices[symbol] !== undefined) {
      walletState.marketPrices[symbol] = parseFloat(
        price < 10 ? price.toFixed(4) : price.toFixed(2)
      );
      updated++;
    }
  });
  if (updated > 0) {
    walletState.lastUpdate = Date.now();
    walletState.dataSource = 'live';
    updatePositionValues();
  }
  return updated;
}

export function getDataSource() {
  return walletState.dataSource || 'simulated';
}

// ═══════ SERVER SYNC — Single Source of Truth ═══════
const SYNC_API_BASE = (() => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return `http://${hostname}:4000/api`;
})();

function getSyncToken() {
  try { return localStorage.getItem('12tribes_auth_token') || null; } catch { return null; }
}

/**
 * Hydrate local walletState from server database.
 * Call this on every login / page load so any device sees the same data.
 */
export async function syncFromServer(userId) {
  const token = getSyncToken();
  if (!token) return false;

  const headers = { 'Authorization': `Bearer ${token}` };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    // Parallel fetch: wallet, positions, trade history, agent stats, prices
    const [walletRes, posRes, histRes, agentRes, priceRes] = await Promise.allSettled([
      fetch(`${SYNC_API_BASE}/wallet`, { headers, signal: controller.signal }),
      fetch(`${SYNC_API_BASE}/trading/positions`, { headers, signal: controller.signal }),
      fetch(`${SYNC_API_BASE}/trading/history`, { headers, signal: controller.signal }),
      fetch(`${SYNC_API_BASE}/market/agents`, { headers, signal: controller.signal }),
      fetch(`${SYNC_API_BASE}/market/prices`, { headers, signal: controller.signal }),
    ]);

    // Wallet
    if (walletRes.status === 'fulfilled' && walletRes.value.ok) {
      const w = await walletRes.value.json();
      walletState.wallets[userId] = {
        id: userId,
        name: w.name || '',
        avatar: w.avatar || '',
        balance: w.balance ?? INITIAL_BALANCE,
        initialBalance: w.initialBalance ?? INITIAL_BALANCE,
        equity: w.equity ?? w.balance ?? INITIAL_BALANCE,
        unrealizedPnL: w.unrealizedPnL ?? 0,
        realizedPnL: w.realizedPnL ?? 0,
        tradeCount: w.tradeCount ?? 0,
        winCount: w.winCount ?? 0,
        lossCount: w.lossCount ?? 0,
        depositAmount: w.initialBalance ?? INITIAL_BALANCE,
        depositTimestamp: w.depositTimestamp || new Date().toISOString(),
        createdAt: w.depositTimestamp || new Date().toISOString(),
      };
      persistWallets();
    }

    // Positions (server uses snake_case)
    if (posRes.status === 'fulfilled' && posRes.value.ok) {
      const positions = await posRes.value.json();
      walletState.positions = positions.map(p => ({
        id: p.id,
        symbol: p.symbol,
        side: p.side,
        quantity: p.quantity,
        entryPrice: p.entry_price,
        currentPrice: p.current_price || p.entry_price,
        investorId: userId,
        agent: p.agent || 'Oracle',
        openTime: new Date(p.opened_at).getTime(),
        openTimestamp: p.opened_at,
        unrealizedPnL: p.unrealized_pnl || 0,
        returnPct: p.return_pct || 0,
        status: 'OPEN',
      }));
      persistPositions();
    }

    // Trade history — server returns { total, offset, limit, trades }
    if (histRes.status === 'fulfilled' && histRes.value.ok) {
      const histData = await histRes.value.json();
      const trades = Array.isArray(histData) ? histData : (histData.trades || []);
      walletState.tradeHistory = trades.map(t => ({
        id: t.id || t.position_id,
        symbol: t.symbol,
        side: t.side,
        quantity: t.quantity,
        entryPrice: t.entry_price,
        closePrice: t.close_price,
        investorId: userId,
        agent: t.agent || 'Oracle',
        openTime: new Date(t.opened_at).getTime(),
        closeTime: new Date(t.closed_at).getTime(),
        closeTimestamp: t.closed_at,
        realizedPnL: t.realized_pnl || 0,
        returnPct: parseFloat(t.return_pct) || 0,
        status: 'CLOSED',
      }));
      persistHistory();
    }

    // Agent stats
    if (agentRes.status === 'fulfilled' && agentRes.value.ok) {
      const agents = await agentRes.value.json();
      if (Array.isArray(agents)) {
        agents.forEach(a => {
          walletState.agentStats[a.agent_name] = {
            name: a.agent_name,
            totalTrades: a.total_trades || 0,
            wins: a.wins || 0,
            losses: a.losses || 0,
            totalPnL: a.total_pnl || 0,
            bestTrade: a.best_trade || 0,
            worstTrade: a.worst_trade || 0,
            avgReturn: a.avg_return || 0,
          };
        });
        persistAgentStats();
      }
    }

    // Market prices
    if (priceRes.status === 'fulfilled' && priceRes.value.ok) {
      const prices = await priceRes.value.json();
      if (prices && typeof prices === 'object') {
        Object.entries(prices).forEach(([symbol, price]) => {
          if (typeof price === 'number') walletState.marketPrices[symbol] = price;
        });
      }
    }

    clearTimeout(timeout);
    console.log('[WalletStore] Server sync complete — wallet, positions, history, agents hydrated');
    return true;
  } catch (err) {
    clearTimeout(timeout);
    console.warn('[WalletStore] Server sync failed (using local cache):', err.message);
    return false;
  }
}

export { executeTrade, closePosition, tickPrices, INITIAL_BALANCE, AI_AGENTS };
