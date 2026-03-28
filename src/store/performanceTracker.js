// ═══════════════════════════════════════════
//   12 TRIBES — PERFORMANCE TRACKER v1.0
//   Daily/Weekly/Monthly/Annual Performance
//   Persistent equity snapshots via localStorage
// ═══════════════════════════════════════════

const STORAGE_KEY_SNAPSHOTS = '12tribes_equity_snapshots';
const STORAGE_KEY_PERF_CACHE = '12tribes_perf_cache';

function loadFromStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveToStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ═══════ SNAPSHOT STATE ═══════
// Structure: { [investorId]: [ { date: "2026-03-27", equity: 100500, balance: 99800, unrealized: 700, realized: 200, positions: 3, timestamp: ISO } ] }
let snapshots = loadFromStorage(STORAGE_KEY_SNAPSHOTS) || {};

function persistSnapshots() {
  saveToStorage(STORAGE_KEY_SNAPSHOTS, snapshots);
}

// ═══════ RECORD EQUITY SNAPSHOT ═══════
// Call this periodically (every tick or once per session) to record equity history
export function recordSnapshot(investorId, wallet) {
  if (!investorId || !wallet) return;

  const now = new Date();
  const dateKey = now.toISOString().split('T')[0]; // "2026-03-27"
  const hourKey = now.getHours();

  if (!snapshots[investorId]) snapshots[investorId] = [];

  const existing = snapshots[investorId];

  // For intraday: keep latest snapshot per hour, plus one per day for historical
  const todaySnapshots = existing.filter(s => s.date === dateKey);
  const latestHourSnap = todaySnapshots.find(s => s.hour === hourKey);

  const snap = {
    date: dateKey,
    hour: hourKey,
    equity: wallet.equity || 0,
    balance: wallet.balance || 0,
    unrealizedPnL: wallet.unrealizedPnL || 0,
    realizedPnL: wallet.realizedPnL || 0,
    positions: wallet.tradeCount || 0,
    timestamp: now.toISOString(),
  };

  if (latestHourSnap) {
    // Update existing hour snapshot
    const idx = existing.indexOf(latestHourSnap);
    existing[idx] = snap;
  } else {
    existing.push(snap);
  }

  // Cap history at 365 days of daily + 24h of hourly
  const cutoffDate = new Date(now);
  cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
  const cutoff = cutoffDate.toISOString().split('T')[0];
  snapshots[investorId] = existing.filter(s => s.date >= cutoff);

  persistSnapshots();
}

// ═══════ GET SNAPSHOTS ═══════
export function getSnapshots(investorId) {
  return snapshots[investorId] || [];
}

// Get the best (latest) snapshot for each unique date
function getDailySnapshots(investorId) {
  const raw = snapshots[investorId] || [];
  const byDate = {};
  raw.forEach(s => {
    if (!byDate[s.date] || s.hour > (byDate[s.date].hour || 0)) {
      byDate[s.date] = s;
    }
  });
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

// ═══════ PERFORMANCE CALCULATIONS ═══════

function getDateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function getDateNMonthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().split('T')[0];
}

function findClosestSnapshot(dailySnaps, targetDate) {
  if (dailySnaps.length === 0) return null;

  // Exact match first
  const exact = dailySnaps.find(s => s.date === targetDate);
  if (exact) return exact;

  // Find closest before targetDate
  let closest = null;
  for (const s of dailySnaps) {
    if (s.date <= targetDate) closest = s;
  }
  // If nothing before, use first available
  return closest || dailySnaps[0];
}

// Compute return between two equity values
function computeReturn(startEquity, endEquity) {
  if (!startEquity || startEquity === 0) return 0;
  return ((endEquity - startEquity) / startEquity) * 100;
}

// ═══════ MAIN PERFORMANCE API ═══════

export function getPerformanceMetrics(investorId, currentWallet) {
  const dailySnaps = getDailySnapshots(investorId);
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // Current equity (live from wallet)
  const currentEquity = currentWallet?.equity || 0;
  const initialBalance = currentWallet?.initialBalance || 100000;

  // If we have no snapshots at all, use initialBalance as the only reference
  const hasHistory = dailySnaps.length > 0;

  // ─── DAILY (today vs yesterday's close) ───
  const yesterdayDate = getDateNDaysAgo(1);
  const yesterdaySnap = hasHistory ? findClosestSnapshot(dailySnaps, yesterdayDate) : null;
  const dailyStartEquity = yesterdaySnap?.equity || initialBalance;
  const dailyReturn = computeReturn(dailyStartEquity, currentEquity);
  const dailyPnL = currentEquity - dailyStartEquity;

  // ─── WEEKLY (today vs 7 days ago) ───
  const weekAgoDate = getDateNDaysAgo(7);
  const weekAgoSnap = hasHistory ? findClosestSnapshot(dailySnaps, weekAgoDate) : null;
  const weeklyStartEquity = weekAgoSnap?.equity || initialBalance;
  const weeklyReturn = computeReturn(weeklyStartEquity, currentEquity);
  const weeklyPnL = currentEquity - weeklyStartEquity;

  // ─── MONTHLY (today vs 30 days ago) ───
  const monthAgoDate = getDateNDaysAgo(30);
  const monthAgoSnap = hasHistory ? findClosestSnapshot(dailySnaps, monthAgoDate) : null;
  const monthlyStartEquity = monthAgoSnap?.equity || initialBalance;
  const monthlyReturn = computeReturn(monthlyStartEquity, currentEquity);
  const monthlyPnL = currentEquity - monthlyStartEquity;

  // ─── ANNUAL (today vs 365 days ago) ───
  const yearAgoDate = getDateNDaysAgo(365);
  const yearAgoSnap = hasHistory ? findClosestSnapshot(dailySnaps, yearAgoDate) : null;
  const annualStartEquity = yearAgoSnap?.equity || initialBalance;
  const annualReturn = computeReturn(annualStartEquity, currentEquity);
  const annualPnL = currentEquity - annualStartEquity;

  // ─── ALL-TIME (from initial deposit) ───
  const allTimeReturn = computeReturn(initialBalance, currentEquity);
  const allTimePnL = currentEquity - initialBalance;

  // ─── STREAKS ───
  let winStreak = 0;
  let lossStreak = 0;
  let currentStreak = 0;
  let streakType = 'none';

  if (dailySnaps.length >= 2) {
    for (let i = dailySnaps.length - 1; i > 0; i--) {
      const dayReturn = computeReturn(dailySnaps[i - 1].equity, dailySnaps[i].equity);
      if (i === dailySnaps.length - 1) {
        streakType = dayReturn >= 0 ? 'win' : 'loss';
        currentStreak = 1;
      } else {
        const isWin = dayReturn >= 0;
        if ((streakType === 'win' && isWin) || (streakType === 'loss' && !isWin)) {
          currentStreak++;
        } else {
          break;
        }
      }
    }
    if (streakType === 'win') winStreak = currentStreak;
    else lossStreak = currentStreak;
  }

  // ─── BEST / WORST DAY ───
  let bestDay = { date: today, return: 0 };
  let worstDay = { date: today, return: 0 };
  for (let i = 1; i < dailySnaps.length; i++) {
    const ret = computeReturn(dailySnaps[i - 1].equity, dailySnaps[i].equity);
    if (ret > bestDay.return) bestDay = { date: dailySnaps[i].date, return: ret };
    if (ret < worstDay.return) worstDay = { date: dailySnaps[i].date, return: ret };
  }

  // ─── VOLATILITY (standard deviation of daily returns) ───
  let volatility = 0;
  if (dailySnaps.length >= 3) {
    const returns = [];
    for (let i = 1; i < dailySnaps.length; i++) {
      returns.push(computeReturn(dailySnaps[i - 1].equity, dailySnaps[i].equity));
    }
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
    volatility = Math.sqrt(variance);
  }

  // ─── SHARPE RATIO (simplified, risk-free rate = 0) ───
  const avgDailyReturn = dailySnaps.length >= 2
    ? computeReturn(dailySnaps[0].equity, dailySnaps[dailySnaps.length - 1].equity) / dailySnaps.length
    : 0;
  const sharpeRatio = volatility > 0 ? (avgDailyReturn / volatility) * Math.sqrt(252) : 0;

  // ─── MAX DRAWDOWN ───
  let maxDrawdown = 0;
  let peak = initialBalance;
  for (const snap of dailySnaps) {
    if (snap.equity > peak) peak = snap.equity;
    const drawdown = ((snap.equity - peak) / peak) * 100;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
  }
  // Include current equity
  if (currentEquity > peak) peak = currentEquity;
  const currentDrawdown = ((currentEquity - peak) / peak) * 100;
  if (currentDrawdown < maxDrawdown) maxDrawdown = currentDrawdown;

  return {
    // Period returns (%)
    daily: { return: dailyReturn, pnl: dailyPnL, startEquity: dailyStartEquity },
    weekly: { return: weeklyReturn, pnl: weeklyPnL, startEquity: weeklyStartEquity },
    monthly: { return: monthlyReturn, pnl: monthlyPnL, startEquity: monthlyStartEquity },
    annual: { return: annualReturn, pnl: annualPnL, startEquity: annualStartEquity },
    allTime: { return: allTimeReturn, pnl: allTimePnL, startEquity: initialBalance },

    // Current state
    currentEquity,
    initialBalance,

    // Risk metrics
    volatility,
    sharpeRatio,
    maxDrawdown,

    // Streaks
    winStreak,
    lossStreak,

    // Best / Worst
    bestDay,
    worstDay,

    // Chart data
    equityHistory: dailySnaps.map(s => ({ date: s.date, equity: s.equity })),
    intradayHistory: getIntradaySnapshots(investorId),
  };
}

// Get hourly snapshots for today (intraday chart)
function getIntradaySnapshots(investorId) {
  const raw = snapshots[investorId] || [];
  const today = new Date().toISOString().split('T')[0];
  return raw
    .filter(s => s.date === today)
    .sort((a, b) => a.hour - b.hour)
    .map(s => ({ time: `${String(s.hour).padStart(2, '0')}:00`, equity: s.equity }));
}

// ═══════ PERIOD EQUITY HISTORY FOR CHARTS ═══════

export function getEquityHistoryByPeriod(investorId, period, currentEquity, initialBalance) {
  const dailySnaps = getDailySnapshots(investorId);
  const init = initialBalance || 100000;

  let cutoffDate;
  switch (period) {
    case 'daily':
      // Return intraday hourly snapshots
      return getIntradaySnapshots(investorId);
    case 'weekly':
      cutoffDate = getDateNDaysAgo(7);
      break;
    case 'monthly':
      cutoffDate = getDateNDaysAgo(30);
      break;
    case 'annual':
      cutoffDate = getDateNDaysAgo(365);
      break;
    default:
      cutoffDate = '2020-01-01';
  }

  let filtered = dailySnaps.filter(s => s.date >= cutoffDate);

  // If we have very few data points, generate synthetic history for visualization
  if (filtered.length < 3) {
    filtered = generateSyntheticHistory(init, currentEquity || init, period);
  }

  return filtered.map(s => ({
    date: s.date || s.time,
    equity: s.equity,
  }));
}

// Generate synthetic history when real data is sparse
// This provides a plausible equity curve from initial to current
function generateSyntheticHistory(startEquity, endEquity, period) {
  const points = period === 'daily' ? 24 : period === 'weekly' ? 7 : period === 'monthly' ? 30 : 252;
  const dailyReturn = Math.pow(endEquity / startEquity, 1 / points) - 1;
  const volatility = Math.abs(dailyReturn) * 2 + 0.002;

  const history = [];
  let equity = startEquity;
  const startDate = new Date();

  for (let i = points; i >= 0; i--) {
    const d = new Date(startDate);
    if (period === 'daily') {
      d.setHours(d.getHours() - i);
      history.push({
        time: `${String(d.getHours()).padStart(2, '0')}:00`,
        equity: Math.round(equity * 100) / 100,
      });
    } else {
      d.setDate(d.getDate() - i);
      history.push({
        date: d.toISOString().split('T')[0],
        equity: Math.round(equity * 100) / 100,
      });
    }

    // Random walk with drift toward endEquity
    const noise = (Math.random() - 0.48) * volatility;
    equity = equity * (1 + dailyReturn + noise);
    // Prevent extreme divergence
    if (equity < startEquity * 0.7) equity = startEquity * 0.7 + Math.random() * startEquity * 0.05;
    if (equity > startEquity * 1.5) equity = startEquity * 1.5 - Math.random() * startEquity * 0.05;
  }

  // Ensure last point matches current equity
  if (history.length > 0) {
    history[history.length - 1].equity = endEquity;
  }

  return history;
}

// ═══════ POSITION PERFORMANCE BREAKDOWN ═══════

export function getPositionPerformance(positions, tradeHistory) {
  // By asset class
  const allTrades = [...positions, ...tradeHistory];
  const byAsset = {};
  const byAgent = {};

  allTrades.forEach(trade => {
    const asset = categorizeAsset(trade.symbol);
    const agent = trade.agent || 'Manual';
    const pnl = trade.realizedPnL || trade.unrealizedPnL || 0;

    if (!byAsset[asset]) byAsset[asset] = { asset, pnl: 0, trades: 0, wins: 0 };
    byAsset[asset].pnl += pnl;
    byAsset[asset].trades++;
    if (pnl >= 0) byAsset[asset].wins++;

    if (!byAgent[agent]) byAgent[agent] = { agent, pnl: 0, trades: 0, wins: 0 };
    byAgent[agent].pnl += pnl;
    byAgent[agent].trades++;
    if (pnl >= 0) byAgent[agent].wins++;
  });

  return {
    byAsset: Object.values(byAsset).sort((a, b) => b.pnl - a.pnl),
    byAgent: Object.values(byAgent).sort((a, b) => b.pnl - a.pnl),
  };
}

function categorizeAsset(symbol) {
  if (['BTC', 'ETH', 'SOL', 'AVAX'].includes(symbol)) return 'Crypto';
  if (symbol.includes('/')) return 'Forex';
  if (['SPY', 'QQQ', 'GLD', 'TLT'].includes(symbol)) return 'ETFs';
  return 'Stocks';
}
