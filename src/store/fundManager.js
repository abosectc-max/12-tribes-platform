/**
 * Fund Manager Module - localStorage-backed fund management for AI trading platform
 * Manages auto-trading state, fund distribution preferences, withdrawals, and simulated AI trading
 * Each investor gets $100K deposited
 */

import { executeTrade, closePosition, getPositions, getMarketPrices, getWallet } from './walletStore.js';

const STORAGE_KEY = '12tribes_fund_settings';
const INITIAL_DEPOSIT = 100000;

// ─── Server sync for cross-device settings ───
const API_BASE = (() => {
  // Production: VITE_API_URL points to Render backend
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
  // Local dev: same hostname, port 4000
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return `http://${hostname}:4000/api`;
})();

function getAuthToken() {
  try { return localStorage.getItem('12tribes_auth_token') || null; } catch { return null; }
}

async function syncSettingsToServer(settings) {
  const token = getAuthToken();
  if (!token) return;
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 3000);
    await fetch(`${API_BASE}/fund-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(settings),
      signal: controller.signal,
    });
  } catch { /* best-effort */ }
}

async function pullSettingsFromServer() {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${API_BASE}/fund-settings`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: controller.signal,
    });
    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch { /* best-effort */ }
  return null;
}

// Available AI agents with distinct trading personalities
const AI_AGENTS = [
  { name: 'Viper', personality: 'momentum' },
  { name: 'Oracle', personality: 'stable' },
  { name: 'Spectre', personality: 'volatile' },
  { name: 'Sentinel', personality: 'conservative' },
  { name: 'Phoenix', personality: 'recovery' },
  { name: 'Titan', personality: 'large_position' },
];

// Market symbols by agent personality preference
const MARKET_SYMBOLS = {
  momentum: ['NVDA', 'TSLA', 'META', 'AMD', 'PLTR', 'COIN'],
  stable: ['AAPL', 'MSFT', 'JPM', 'JNJ', 'SPY', 'VOO'],
  volatile: ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ADA'],
  recovery: ['F', 'BAC', 'WISH', 'RIOT', 'GE', 'CCIV'],
  large_position: ['SPY', 'QQQ', 'IWM', 'EEM', 'AAPL', 'MSFT'],
};

/**
 * Get default fund settings for a new investor
 */
const getDefaultSettings = (investorId) => ({
  investorId,
  createdAt: Date.now(),

  // Initial fund info
  initialDeposit: INITIAL_DEPOSIT,
  currentBalance: INITIAL_DEPOSIT,
  totalPnL: 0,

  // Auto-trading state
  autoTrading: {
    isAutoTrading: false,
    tradingStartedAt: null,
    tradingMode: 'balanced', // 'aggressive' | 'balanced' | 'conservative'
    agentsActive: [],
    totalTradesExecuted: 0,
    sessionPnL: 0,
  },

  // Fund distribution preferences
  distribution: {
    mode: 'compound', // 'compound' | 'withdraw' | 'hybrid'
    hybridCompoundPercent: 60, // used when mode is 'hybrid'
    hybridWithdrawPercent: 40, // used when mode is 'hybrid'
  },

  // Withdrawal configuration
  withdrawal: {
    schedule: 'monthly', // 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'custom'
    type: 'percentage_of_profits', // 'fixed_amount' | 'percentage_of_profits' | 'percentage_of_equity' | 'above_threshold'
    amount: 10, // dollar amount or percentage
    thresholdAmount: 120000, // for 'above_threshold' type
    minimumBalance: 50000,
    method: 'bank_transfer', // 'bank_transfer' | 'crypto_wallet' | 'reinvest_other' | 'hold_cash'
    bankDetails: null, // { bankName, lastFour, routingHint }
    cryptoWallet: null, // { network, addressPreview }
    nextScheduledWithdrawal: null, // calculated date
    history: [], // array of past withdrawals
  },
});

/**
 * Get all stored fund settings from localStorage
 */
const getAllFundSettings = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (err) {
    console.error('Error reading fund settings from localStorage:', err);
    return {};
  }
};

/**
 * Save all fund settings to localStorage + push to server for cross-device sync
 */
const saveFundSettings = (allSettings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allSettings));
    // Push to server (fire-and-forget) for cross-device sync
    // allSettings is keyed by investorId — push the first one found
    const ids = Object.keys(allSettings);
    for (const id of ids) {
      if (allSettings[id]?.distribution || allSettings[id]?.autoTrading) {
        syncSettingsToServer(allSettings[id]);
        break;
      }
    }
  } catch (err) {
    console.error('Error saving fund settings to localStorage:', err);
  }
};

// Track whether we've already pulled from server this session
let serverPullDone = false;

/**
 * Initialize default settings for an investor if not already present
 * Pulls from server on first load for cross-device sync
 */
export const initFundManager = (investorId) => {
  const allSettings = getAllFundSettings();

  if (!allSettings[investorId]) {
    allSettings[investorId] = getDefaultSettings(investorId);
    saveFundSettings(allSettings);
  }

  // Pull from server once per session to sync cross-device changes
  // This restores autoTrading state so trading resumes after cache clear / new device
  if (!serverPullDone) {
    serverPullDone = true;
    pullSettingsFromServer().then(serverSettings => {
      if (serverSettings && typeof serverSettings === 'object') {
        const localSettings = getAllFundSettings();
        const localData = localSettings[investorId];
        if (serverSettings.distribution || serverSettings.autoTrading) {
          localSettings[investorId] = {
            ...localData,
            distribution: serverSettings.distribution || localData.distribution,
            withdrawal: serverSettings.withdrawal || localData.withdrawal,
            autoTrading: {
              ...localData.autoTrading,
              // Server is source of truth for persistent trading state
              isAutoTrading: serverSettings.autoTrading?.isAutoTrading ?? localData.autoTrading.isAutoTrading,
              tradingMode: serverSettings.autoTrading?.tradingMode ?? localData.autoTrading.tradingMode,
              tradingStartedAt: serverSettings.autoTrading?.tradingStartedAt ?? localData.autoTrading.tradingStartedAt,
              agentsActive: serverSettings.autoTrading?.agentsActive?.length
                ? serverSettings.autoTrading.agentsActive
                : localData.autoTrading.agentsActive,
            },
          };
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(localSettings)); } catch {}
        }
      }
    });
  }

  return allSettings[investorId];
};

/**
 * Get complete fund settings for an investor
 */
export const getFundSettings = (investorId) => {
  const allSettings = getAllFundSettings();

  if (!allSettings[investorId]) {
    return initFundManager(investorId);
  }

  return allSettings[investorId];
};

/**
 * Update fund settings for an investor (partial update)
 */
export const updateFundSettings = (investorId, updates) => {
  const allSettings = getAllFundSettings();

  if (!allSettings[investorId]) {
    allSettings[investorId] = getDefaultSettings(investorId);
  }

  // Deep merge updates
  const current = allSettings[investorId];
  allSettings[investorId] = {
    ...current,
    ...updates,
    autoTrading: { ...current.autoTrading, ...updates.autoTrading },
    distribution: { ...current.distribution, ...updates.distribution },
    withdrawal: { ...current.withdrawal, ...updates.withdrawal },
  };

  saveFundSettings(allSettings);
  return allSettings[investorId];
};

/**
 * Start auto-trading for an investor
 */
export const startAutoTrading = (investorId, mode = 'balanced') => {
  const settings = getFundSettings(investorId);

  const activeAgents = AI_AGENTS.map(agent => agent.name);

  const updates = {
    autoTrading: {
      ...settings.autoTrading,
      isAutoTrading: true,
      tradingStartedAt: Date.now(),
      tradingMode: mode,
      agentsActive: activeAgents,
      totalTradesExecuted: 0,
      sessionPnL: 0,
    },
  };

  return updateFundSettings(investorId, updates);
};

/**
 * Stop auto-trading for an investor
 */
export const stopAutoTrading = (investorId) => {
  const settings = getFundSettings(investorId);

  const updates = {
    autoTrading: {
      ...settings.autoTrading,
      isAutoTrading: false,
      agentsActive: [],
    },
  };

  return updateFundSettings(investorId, updates);
};

/**
 * Get current auto-trading status for an investor
 */
export const getAutoTradingStatus = (investorId) => {
  const settings = getFundSettings(investorId);
  return {
    ...settings.autoTrading,
    currentBalance: settings.currentBalance,
    totalPnL: settings.totalPnL,
  };
};

/**
 * Simulate one AI agent making a trade decision
 * Each agent has distinct trading personality and preferences
 */
export const simulateAgentTrade = (investorId) => {
  const settings = getFundSettings(investorId);

  if (!settings.autoTrading.isAutoTrading) {
    return null;
  }

  // Pick a random active agent
  const activeAgents = settings.autoTrading.agentsActive;
  if (activeAgents.length === 0) {
    return null;
  }

  const agentName = activeAgents[Math.floor(Math.random() * activeAgents.length)];
  const agent = AI_AGENTS.find(a => a.name === agentName);

  // Get symbols for this agent's personality — only use symbols that have market prices
  const preferredSymbols = MARKET_SYMBOLS[agent.personality] || MARKET_SYMBOLS.stable;
  const marketPrices = getMarketPrices();
  const tradableSymbols = preferredSymbols.filter(s => marketPrices[s] !== undefined);
  if (tradableSymbols.length === 0) return null;

  const symbol = tradableSymbols[Math.floor(Math.random() * tradableSymbols.length)];

  // Conservative agent: 50% chance of no trade
  if (agent.personality === 'conservative' && Math.random() < 0.5) {
    return {
      agent: agentName, symbol, side: 'NONE', quantity: 0, price: 0,
      reason: 'Market conditions not ideal for trading',
    };
  }

  // ─── CLOSE EXISTING POSITIONS (50% chance if we have open ones) ───
  const openPositions = getPositions(investorId);
  const agentPositions = openPositions.filter(p => p.agent === agentName);
  if (agentPositions.length > 0 && Math.random() < 0.5) {
    const posToClose = agentPositions[Math.floor(Math.random() * agentPositions.length)];
    const closeResult = closePosition(posToClose.id);
    if (closeResult.success) {
      const trade = closeResult.trade;
      const newSettings = getFundSettings(investorId);
      newSettings.autoTrading.totalTradesExecuted += 1;
      newSettings.autoTrading.sessionPnL += trade.realizedPnL || 0;
      // Sync fund balance with wallet
      const wallet = getWallet(investorId);
      if (wallet) {
        newSettings.currentBalance = wallet.equity;
        newSettings.totalPnL = wallet.realizedPnL + wallet.unrealizedPnL;
      }
      saveFundSettings({ [investorId]: newSettings });
      return {
        agent: agentName, symbol: trade.symbol,
        side: 'CLOSE', quantity: trade.quantity,
        price: trade.closePrice, reason: 'Taking profits / cutting loss',
        pnl: trade.realizedPnL, executedAt: Date.now(),
      };
    }
  }

  // ─── OPEN NEW POSITION ───
  // Determine trade side based on agent personality
  const randomDecision = Math.random();
  let side, reason;

  if (agent.personality === 'momentum') {
    side = randomDecision < 0.65 ? 'LONG' : 'SHORT';
    reason = randomDecision < 0.65 ? 'Momentum detected' : 'Taking profits';
  } else if (agent.personality === 'stable') {
    side = randomDecision < 0.55 ? 'LONG' : 'SHORT';
    reason = randomDecision < 0.55 ? 'Buying dip' : 'Rebalancing';
  } else if (agent.personality === 'volatile') {
    side = randomDecision < 0.6 ? 'LONG' : 'SHORT';
    reason = randomDecision < 0.6 ? 'Volatility opportunity' : 'Risk reduction';
  } else if (agent.personality === 'recovery') {
    side = randomDecision < 0.52 ? 'LONG' : 'SHORT';
    reason = randomDecision < 0.52 ? 'Recovery signal' : 'Exit position';
  } else {
    side = randomDecision < 0.5 ? 'LONG' : 'SHORT';
    reason = randomDecision < 0.5 ? 'Position entry' : 'Position exit';
  }

  // Quantity — keep positions small relative to balance (1-3% of equity)
  const wallet = getWallet(investorId);
  const equity = wallet ? wallet.equity : INITIAL_DEPOSIT;
  const currentPrice = marketPrices[symbol];
  const maxPositionValue = equity * 0.03; // 3% max per position
  let quantity = Math.max(1, Math.floor(maxPositionValue / currentPrice));
  // Cap open positions at 8 to prevent over-trading
  if (openPositions.length >= 8) {
    // Close oldest position instead of opening new one
    const oldest = openPositions[0];
    const closeResult = closePosition(oldest.id);
    if (closeResult.success) {
      const newSettings = getFundSettings(investorId);
      newSettings.autoTrading.totalTradesExecuted += 1;
      newSettings.autoTrading.sessionPnL += closeResult.trade.realizedPnL || 0;
      const updatedWallet = getWallet(investorId);
      if (updatedWallet) {
        newSettings.currentBalance = updatedWallet.equity;
        newSettings.totalPnL = updatedWallet.realizedPnL + updatedWallet.unrealizedPnL;
      }
      saveFundSettings({ [investorId]: newSettings });
    }
    return {
      agent: agentName, symbol: oldest.symbol,
      side: 'CLOSE', quantity: oldest.quantity,
      price: oldest.currentPrice, reason: 'Max positions reached — closing oldest',
      executedAt: Date.now(),
    };
  }

  // Execute real trade through walletStore
  const tradeResult = executeTrade({
    symbol, side, quantity, investorId, agent: agentName,
  });

  if (!tradeResult.success) {
    // Insufficient balance or other issue — skip
    return {
      agent: agentName, symbol, side: 'NONE', quantity: 0, price: 0,
      reason: `Skipped: ${tradeResult.error}`, executedAt: Date.now(),
    };
  }

  // Update fund settings to stay in sync
  const newSettings = getFundSettings(investorId);
  newSettings.autoTrading.totalTradesExecuted += 1;
  const updatedWallet = getWallet(investorId);
  if (updatedWallet) {
    newSettings.currentBalance = updatedWallet.equity;
    newSettings.totalPnL = updatedWallet.realizedPnL + updatedWallet.unrealizedPnL;
  }
  saveFundSettings({ [investorId]: newSettings });

  return {
    agent: agentName, symbol, side,
    quantity, price: currentPrice,
    reason, executedAt: Date.now(),
  };
};

/**
 * Calculate next withdrawal date based on schedule
 */
const calculateNextWithdrawalDate = (lastWithdrawalTime, schedule) => {
  const date = new Date(lastWithdrawalTime);

  switch (schedule) {
    case 'weekly':
      date.setDate(date.getDate() + 7);
      break;
    case 'biweekly':
      date.setDate(date.getDate() + 14);
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    case 'quarterly':
      date.setMonth(date.getMonth() + 3);
      break;
    default:
      return null;
  }

  return date.getTime();
};

/**
 * Check if a withdrawal is scheduled and process it
 */
export const processScheduledWithdrawal = (investorId) => {
  const settings = getFundSettings(investorId);
  const { distribution, withdrawal, currentBalance, totalPnL } = settings;

  // Only process if not in compound mode
  if (distribution.mode === 'compound') {
    return null;
  }

  const now = Date.now();
  const nextWithdrawal = withdrawal.nextScheduledWithdrawal;

  // Check if withdrawal is due
  if (!nextWithdrawal || nextWithdrawal > now) {
    return null;
  }

  // Calculate withdrawal amount
  let withdrawalAmount = 0;

  switch (withdrawal.type) {
    case 'fixed_amount':
      withdrawalAmount = withdrawal.amount;
      break;
    case 'percentage_of_profits':
      withdrawalAmount = totalPnL * (withdrawal.amount / 100);
      break;
    case 'percentage_of_equity':
      withdrawalAmount = currentBalance * (withdrawal.amount / 100);
      break;
    case 'above_threshold':
      if (currentBalance > withdrawal.thresholdAmount) {
        withdrawalAmount = currentBalance - withdrawal.thresholdAmount;
      }
      break;
  }

  // Ensure we don't go below minimum balance
  const finalBalance = currentBalance - withdrawalAmount;
  if (finalBalance < withdrawal.minimumBalance) {
    withdrawalAmount = Math.max(0, currentBalance - withdrawal.minimumBalance);
  }

  if (withdrawalAmount <= 0) {
    return null;
  }

  // Create withdrawal record
  const withdrawalRecord = {
    amount: withdrawalAmount,
    type: withdrawal.type,
    method: withdrawal.method,
    processedAt: now,
    balanceBefore: currentBalance,
    balanceAfter: currentBalance - withdrawalAmount,
  };

  // Update settings
  const updates = {
    currentBalance: currentBalance - withdrawalAmount,
    withdrawal: {
      ...withdrawal,
      history: [...withdrawal.history, withdrawalRecord],
      nextScheduledWithdrawal: calculateNextWithdrawalDate(now, withdrawal.schedule),
    },
  };

  updateFundSettings(investorId, updates);

  return withdrawalRecord;
};

/**
 * Get withdrawal history for an investor
 */
export const getWithdrawalHistory = (investorId) => {
  const settings = getFundSettings(investorId);
  return settings.withdrawal.history || [];
};

/**
 * Add a manual withdrawal record
 */
export const addWithdrawal = (investorId, withdrawalData) => {
  const settings = getFundSettings(investorId);
  const { currentBalance, withdrawal } = settings;

  const withdrawalRecord = {
    ...withdrawalData,
    processedAt: Date.now(),
    balanceBefore: currentBalance,
    balanceAfter: currentBalance - withdrawalData.amount,
  };

  // Update settings
  const updates = {
    currentBalance: currentBalance - withdrawalData.amount,
    withdrawal: {
      ...withdrawal,
      history: [...withdrawal.history, withdrawalRecord],
    },
  };

  return updateFundSettings(investorId, updates);
};

/**
 * Get the next scheduled withdrawal date
 */
export const getNextWithdrawalDate = (investorId) => {
  const settings = getFundSettings(investorId);
  return settings.withdrawal.nextScheduledWithdrawal;
};

/**
 * Calculate compound growth projection
 * @param {number} principal - Starting amount
 * @param {number} monthlyReturn - Expected monthly return percentage (e.g., 2 for 2%)
 * @param {number} months - Number of months to project
 * @param {number} compoundPct - Percentage that gets compounded (0-100)
 */
export const calculateCompoundGrowth = (principal, monthlyReturn, months, compoundPct = 100) => {
  const monthlyRate = monthlyReturn / 100;
  const compoundRate = (compoundPct / 100) * monthlyRate;

  let balance = principal;
  const projections = [{ month: 0, balance: principal }];

  for (let i = 1; i <= months; i++) {
    balance = balance * (1 + compoundRate);
    projections.push({ month: i, balance: Math.round(balance) });
  }

  return projections;
};

/**
 * Get 12-month compound growth projection based on current fund settings
 */
export const getCompoundProjection = (investorId) => {
  const settings = getFundSettings(investorId);
  const { distribution, autoTrading } = settings;
  // Use live wallet equity as starting balance (falls back to fund settings)
  const walletData = getWallet(investorId);
  const currentBalance = walletData?.equity || settings.currentBalance;

  // Estimate monthly return based on trading mode
  let estimatedMonthlyReturn = 1.5; // default 1.5%

  if (autoTrading.tradingMode === 'aggressive') {
    estimatedMonthlyReturn = 3;
  } else if (autoTrading.tradingMode === 'balanced') {
    estimatedMonthlyReturn = 2;
  } else if (autoTrading.tradingMode === 'conservative') {
    estimatedMonthlyReturn = 1;
  }

  // Determine compound percentage
  let compoundPct = 100;
  if (distribution.mode === 'hybrid') {
    compoundPct = distribution.hybridCompoundPercent;
  } else if (distribution.mode === 'withdraw') {
    compoundPct = 0;
  }

  return calculateCompoundGrowth(currentBalance, estimatedMonthlyReturn, 12, compoundPct);
};
