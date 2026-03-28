/**
 * 12 Tribes AI Trading Platform - Tier 3 Advanced Features
 *
 * Comprehensive system for strategy attribution, alerts, tax optimization,
 * alternative data, trade journaling, and paper-to-live graduation.
 *
 * ES Module | No external dependencies | localStorage persisted
 * ~800 lines | Full JSDoc coverage
 */

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM 1: STRATEGY PERFORMANCE ATTRIBUTION (~120 lines)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Analyze trade performance attribution across multiple dimensions
 * @param {Array<Object>} tradeHistory - Array of {symbol, entryPrice, exitPrice, quantity, entryTime, exitTime, agentId, pnl}
 * @param {Array<Object>} agents - Array of {id, name, strategy}
 * @returns {Object} Attribution breakdown by agent, asset class, time of day, day of week
 */
export function attributePerformance(tradeHistory, agents) {
  if (!Array.isArray(tradeHistory) || !Array.isArray(agents)) {
    return { byAgent: {}, byAssetClass: {}, byTimeOfDay: {}, byDayOfWeek: {} };
  }

  const byAgent = {};
  const byAssetClass = {};
  const byTimeOfDay = { '00-06': [], '06-12': [], '12-18': [], '18-24': [] };
  const byDayOfWeek = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };

  tradeHistory.forEach(trade => {
    if (!trade || typeof trade.pnl !== 'number') return;

    // By Agent
    if (!byAgent[trade.agentId]) {
      byAgent[trade.agentId] = { trades: [], pnl: 0, wins: 0 };
    }
    byAgent[trade.agentId].trades.push(trade);
    byAgent[trade.agentId].pnl += trade.pnl || 0;
    if ((trade.pnl || 0) > 0) byAgent[trade.agentId].wins += 1;

    // By Asset Class
    const assetClass = trade.symbol?.split('-')[0] || 'OTHER';
    if (!byAssetClass[assetClass]) {
      byAssetClass[assetClass] = { trades: [], pnl: 0, wins: 0 };
    }
    byAssetClass[assetClass].trades.push(trade);
    byAssetClass[assetClass].pnl += trade.pnl || 0;
    if ((trade.pnl || 0) > 0) byAssetClass[assetClass].wins += 1;

    // By Time of Day
    const entryDate = new Date(trade.entryTime);
    const hour = !isNaN(entryDate.getTime()) ? entryDate.getHours() : 12;
    const period = hour < 6 ? '00-06' : hour < 12 ? '06-12' : hour < 18 ? '12-18' : '18-24';
    byTimeOfDay[period].push(trade);

    // By Day of Week
    const dow = !isNaN(entryDate.getTime()) ? entryDate.getDay() : 0;
    byDayOfWeek[dow].push(trade);
  });

  // Compute metrics
  const computeMetrics = (trades) => {
    if (trades.length === 0) return { pnl: 0, winRate: 0, sharpe: 0, trades: 0, avgHold: 0, best: 0, worst: 0 };

    const pnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const wins = trades.filter(t => (t.pnl || 0) > 0).length;
    const winRate = trades.length > 0 ? wins / trades.length : 0;

    const returns = trades.map(t => t.pnl || 0);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length || 0;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length || 1;
    const stdDev = Math.sqrt(variance) || 1;
    const sharpe = stdDev !== 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

    const avgHold = trades.reduce((sum, t) => {
      const hold = new Date(t.exitTime) - new Date(t.entryTime);
      return sum + (isNaN(hold) ? 0 : hold / (1000 * 60 * 60));
    }, 0) / trades.length || 0;

    return {
      pnl: isFinite(pnl) ? pnl : 0,
      winRate: isFinite(winRate) ? winRate : 0,
      sharpe: isFinite(sharpe) ? sharpe : 0,
      trades: trades.length,
      avgHold: isFinite(avgHold) ? avgHold : 0,
      best: Math.max(...returns),
      worst: Math.min(...returns)
    };
  };

  const agentMetrics = {};
  Object.entries(byAgent).forEach(([agentId, data]) => {
    agentMetrics[agentId] = computeMetrics(data.trades);
  });

  const assetMetrics = {};
  Object.entries(byAssetClass).forEach(([asset, data]) => {
    assetMetrics[asset] = computeMetrics(data.trades);
  });

  const timeMetrics = {};
  Object.entries(byTimeOfDay).forEach(([period, trades]) => {
    timeMetrics[period] = computeMetrics(trades);
  });

  const dayMetrics = {};
  Object.entries(byDayOfWeek).forEach(([dow, trades]) => {
    dayMetrics[dow] = computeMetrics(trades);
  });

  return { byAgent: agentMetrics, byAssetClass: assetMetrics, byTimeOfDay: timeMetrics, byDayOfWeek: dayMetrics };
}

/**
 * Generate capital allocation recommendation based on performance
 * @param {Object} attribution - Output from attributePerformance
 * @returns {Object} {allocations, reasoning, benchedAgents}
 */
export function getAgentAllocationRecommendation(attribution) {
  if (!attribution || typeof attribution !== 'object') {
    return { allocations: {}, reasoning: ['Invalid attribution data'], benchedAgents: [] };
  }

  const byAgent = attribution.byAgent || {};
  const allocations = {};
  const reasoning = [];
  const benchedAgents = [];

  const sharpes = Object.entries(byAgent)
    .map(([id, metrics]) => ({ id, sharpe: metrics.sharpe || 0 }))
    .filter(x => x.sharpe !== null && !isNaN(x.sharpe));

  const totalSharpe = sharpes.reduce((sum, x) => sum + Math.max(x.sharpe, 0), 0) || 1;

  sharpes.forEach(({ id, sharpe }) => {
    if (sharpe < 0) {
      allocations[id] = 0;
      benchedAgents.push(id);
      reasoning.push(`Agent ${id} benched: negative Sharpe (${sharpe.toFixed(2)})`);
    } else {
      allocations[id] = totalSharpe > 0 ? sharpe / totalSharpe : 0.5;
    }
  });

  reasoning.push(`Total agents: ${Object.keys(byAgent).length}, Benched: ${benchedAgents.length}`);

  return { allocations, reasoning, benchedAgents };
}

/**
 * Generate monthly performance heatmap
 * @param {Array<Object>} tradeHistory - Trade array
 * @returns {Object} {months, bestMonth, worstMonth, avgMonthly}
 */
export function getPerformanceHeatmap(tradeHistory) {
  if (!Array.isArray(tradeHistory)) return { months: [], bestMonth: null, worstMonth: null, avgMonthly: 0 };

  const monthlyData = {};

  tradeHistory.forEach(trade => {
    if (!trade || typeof trade.pnl !== 'number') return;
    const exitDate = new Date(trade.exitTime);
    if (isNaN(exitDate.getTime())) return;

    const key = `${exitDate.getFullYear()}-${String(exitDate.getMonth() + 1).padStart(2, '0')}`;
    if (!monthlyData[key]) {
      monthlyData[key] = { year: exitDate.getFullYear(), month: exitDate.getMonth() + 1, trades: [], pnl: 0 };
    }
    monthlyData[key].trades.push(trade);
    monthlyData[key].pnl += trade.pnl || 0;
  });

  const months = Object.values(monthlyData).map(m => ({
    year: m.year,
    month: m.month,
    return: m.pnl || 0,
    trades: m.trades.length,
    winRate: m.trades.length > 0 ? m.trades.filter(t => (t.pnl || 0) > 0).length / m.trades.length : 0
  })).sort((a, b) => a.year - b.year || a.month - b.month);

  const returns = months.map(m => m.return);
  const bestMonth = months.length > 0 ? months.reduce((best, m) => m.return > best.return ? m : best) : null;
  const worstMonth = months.length > 0 ? months.reduce((worst, m) => m.return < worst.return ? m : worst) : null;
  const avgMonthly = months.length > 0 ? returns.reduce((a, b) => a + b, 0) / months.length : 0;

  return { months, bestMonth, worstMonth, avgMonthly: isFinite(avgMonthly) ? avgMonthly : 0 };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM 2: ALERT & NOTIFICATION SYSTEM (~130 lines)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a new alert rule
 * @param {Object} config - {type, condition, threshold, message, priority, repeat}
 * @returns {string} Alert rule ID
 */
export function createAlert(config) {
  if (!config || typeof config !== 'object') return null;

  const rule = {
    id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    type: config.type || 'price',
    condition: config.condition || 'above',
    threshold: typeof config.threshold === 'number' ? config.threshold : 0,
    message: config.message || 'Alert triggered',
    priority: config.priority || 'medium',
    repeat: config.repeat !== false,
    createdAt: new Date().toISOString(),
    active: true
  };

  try {
    const rules = JSON.parse(localStorage.getItem('12tribes_alert_rules') || '[]');
    rules.push(rule);
    localStorage.setItem('12tribes_alert_rules', JSON.stringify(rules));
  } catch (e) {
    return null;
  }

  return rule.id;
}

/**
 * Evaluate all alerts against current market state
 * @param {Object} marketState - {prices, portfolio, riskMetrics, systemHealth}
 * @returns {Object} {triggered, pending}
 */
export function evaluateAlerts(marketState) {
  if (!marketState || typeof marketState !== 'object') return { triggered: [], pending: 0 };

  let rules = [];
  try {
    rules = JSON.parse(localStorage.getItem('12tribes_alert_rules') || '[]');
  } catch (e) {
    return { triggered: [], pending: 0 };
  }

  const triggered = [];
  const now = new Date();

  rules.forEach(rule => {
    if (!rule.active) return;

    let conditionMet = false;
    const { prices = {}, portfolio = {}, riskMetrics = {} } = marketState;

    switch (rule.type) {
      case 'price':
        const price = prices[rule.symbol] || 0;
        conditionMet = rule.condition === 'above' ? price > rule.threshold : price < rule.threshold;
        break;
      case 'drawdown':
        const dd = Math.abs(riskMetrics.maxDrawdown || 0);
        conditionMet = dd > rule.threshold;
        break;
      case 'risk':
        const risk = riskMetrics.currentRisk || 0;
        conditionMet = risk > rule.threshold;
        break;
      case 'system':
        conditionMet = riskMetrics.systemHealth !== 'healthy';
        break;
      default:
        conditionMet = false;
    }

    if (conditionMet) {
      const alert = {
        alertId: rule.id,
        message: rule.message,
        priority: rule.priority,
        timestamp: now.toISOString()
      };
      triggered.push(alert);
      _addAlertToHistory(alert);
    }
  });

  return { triggered, pending: rules.filter(r => r.active).length };
}

/**
 * Get recent alert history
 * @param {number} limit - Number of alerts to return
 * @returns {Array} Recent alerts
 */
export function getAlertHistory(limit = 50) {
  if (typeof limit !== 'number' || limit < 1) limit = 50;

  try {
    const history = JSON.parse(localStorage.getItem('12tribes_alert_history') || '[]');
    return history.slice(-limit);
  } catch (e) {
    return [];
  }
}

/**
 * Dismiss/acknowledge an alert
 * @param {string} alertId - Alert ID to dismiss
 * @returns {boolean} Success
 */
export function dismissAlert(alertId) {
  if (!alertId || typeof alertId !== 'string') return false;

  try {
    const history = JSON.parse(localStorage.getItem('12tribes_alert_history') || '[]');
    const alert = history.find(a => a.alertId === alertId);
    if (alert) alert.dismissedAt = new Date().toISOString();
    localStorage.setItem('12tribes_alert_history', JSON.stringify(history));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Delete an alert rule
 * @param {string} alertId - Rule ID to delete
 * @returns {boolean} Success
 */
export function deleteAlertRule(alertId) {
  if (!alertId || typeof alertId !== 'string') return false;

  try {
    let rules = JSON.parse(localStorage.getItem('12tribes_alert_rules') || '[]');
    rules = rules.filter(r => r.id !== alertId);
    localStorage.setItem('12tribes_alert_rules', JSON.stringify(rules));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Get all active alert rules
 * @returns {Array} Active rules
 */
export function getActiveRules() {
  try {
    const rules = JSON.parse(localStorage.getItem('12tribes_alert_rules') || '[]');
    return rules.filter(r => r.active !== false);
  } catch (e) {
    return [];
  }
}

/**
 * Format alert for display
 * @param {Object} alert - Alert object
 * @returns {Object} {icon, color, title, body, timeAgo}
 */
export function formatAlertForDisplay(alert) {
  if (!alert || typeof alert !== 'object') {
    return { icon: '⚪', color: '#ccc', title: 'Unknown', body: '', timeAgo: '' };
  }

  const priorityMap = {
    critical: { icon: '🔴', color: '#d32f2f' },
    high: { icon: '🟡', color: '#f57c00' },
    medium: { icon: '🔵', color: '#1976d2' },
    low: { icon: '⚪', color: '#757575' }
  };

  const p = priorityMap[alert.priority] || priorityMap.low;
  const ts = new Date(alert.timestamp);
  const now = new Date();
  const diff = !isNaN(ts.getTime()) ? now.getTime() - ts.getTime() : 0;
  const mins = Math.floor(diff / 60000);
  const timeAgo = mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;

  return {
    icon: p.icon,
    color: p.color,
    title: `${alert.priority.toUpperCase()} ALERT`,
    body: alert.message || 'Alert triggered',
    timeAgo
  };
}

// Helper
function _addAlertToHistory(alert) {
  try {
    const history = JSON.parse(localStorage.getItem('12tribes_alert_history') || '[]');
    history.push(alert);
    if (history.length > 1000) history.shift();
    localStorage.setItem('12tribes_alert_history', JSON.stringify(history));
  } catch (e) {
    // Silent fail
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM 3: TAX-LOSS HARVESTING (~120 lines)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Identify tax-loss harvesting opportunities
 * @param {Array<Object>} positions - Array of {symbol, shares, costBasis, currentPrice, acquiredDate}
 * @returns {Object} {opportunities, totalPotentialSavings}
 */
export function identifyTaxLossOpportunities(positions) {
  if (!Array.isArray(positions)) return { opportunities: [], totalPotentialSavings: 0 };

  const opportunities = [];
  let totalSavings = 0;

  positions.forEach(pos => {
    if (!pos || typeof pos.currentPrice !== 'number' || typeof pos.costBasis !== 'number') return;

    const unrealizedLoss = (pos.costBasis - pos.currentPrice) * (pos.shares || 0);

    if (unrealizedLoss > 100) {
      const holdDays = new Date() - new Date(pos.acquiredDate || 0);
      const substitute = _findSubstituteSecurity(pos.symbol);

      opportunities.push({
        symbol: pos.symbol,
        unrealizedLoss: Math.max(0, unrealizedLoss),
        holdDays: Math.floor(holdDays / (1000 * 60 * 60 * 24)),
        substitute,
        estimatedTaxSaving: Math.max(0, unrealizedLoss) * 0.37
      });

      totalSavings += Math.max(0, unrealizedLoss) * 0.37;
    }
  });

  return { opportunities, totalPotentialSavings: isFinite(totalSavings) ? totalSavings : 0 };
}

/**
 * Calculate tax saving from harvest
 * @param {Object} opportunity - Opportunity object
 * @param {number} taxRate - Tax rate (default 0.37)
 * @returns {Object} {taxSaving, costBasis, proceedsEstimate, washSaleWarning}
 */
export function executeHarvest(opportunity, taxRate = 0.37) {
  if (!opportunity || typeof opportunity !== 'object') {
    return { taxSaving: 0, costBasis: 0, proceedsEstimate: 0, washSaleWarning: false };
  }

  if (typeof taxRate !== 'number' || taxRate < 0 || taxRate > 1) taxRate = 0.37;

  const taxSaving = isFinite(opportunity.unrealizedLoss) ? opportunity.unrealizedLoss * taxRate : 0;
  const washSaleWarning = (opportunity.holdDays || 0) < 365;

  return {
    taxSaving: Math.max(0, taxSaving),
    costBasis: opportunity.unrealizedLoss || 0,
    proceedsEstimate: Math.max(0, opportunity.unrealizedLoss),
    washSaleWarning
  };
}

/**
 * Get wash sale calendar
 * @param {Array<Object>} tradeHistory - Trade history
 * @returns {Object} {restricted}
 */
export function getWashSaleCalendar(tradeHistory) {
  if (!Array.isArray(tradeHistory)) return { restricted: [] };

  const restricted = [];
  const now = new Date();

  tradeHistory.forEach(trade => {
    if (!trade || trade.pnl >= 0) return;
    const soldDate = new Date(trade.exitTime);
    if (isNaN(soldDate.getTime())) return;

    const restrictedUntil = new Date(soldDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const daysRemaining = Math.max(0, Math.ceil((restrictedUntil - now) / (1000 * 60 * 60 * 24)));

    if (daysRemaining > 0) {
      restricted.push({
        symbol: trade.symbol,
        soldDate: soldDate.toISOString().split('T')[0],
        restrictedUntil: restrictedUntil.toISOString().split('T')[0],
        daysRemaining
      });
    }
  });

  return { restricted };
}

/**
 * Get annual tax summary
 * @param {Array<Object>} tradeHistory - Trade history
 * @param {number} year - Tax year
 * @returns {Object} Tax summary with gains/losses
 */
export function getAnnualTaxSummary(tradeHistory, year) {
  if (!Array.isArray(tradeHistory) || typeof year !== 'number') {
    return { shortTermGains: 0, shortTermLosses: 0, longTermGains: 0, longTermLosses: 0, netGainLoss: 0, estimatedTax: 0, harvestedSavings: 0 };
  }

  let stGains = 0, stLosses = 0, ltGains = 0, ltLosses = 0;

  tradeHistory.forEach(trade => {
    if (!trade || typeof trade.pnl !== 'number') return;
    const exitDate = new Date(trade.exitTime);
    if (isNaN(exitDate.getTime()) || exitDate.getFullYear() !== year) return;

    const holdDays = new Date(trade.exitTime) - new Date(trade.entryTime);
    const isLongTerm = holdDays > 365 * 24 * 60 * 60 * 1000;

    if (trade.pnl > 0) {
      isLongTerm ? (ltGains += trade.pnl) : (stGains += trade.pnl);
    } else {
      isLongTerm ? (ltLosses += Math.abs(trade.pnl)) : (stLosses += Math.abs(trade.pnl));
    }
  });

  const netGainLoss = (stGains - stLosses) + (ltGains - ltLosses);
  const taxableST = Math.max(0, stGains - stLosses);
  const taxableLT = Math.max(0, ltGains - ltLosses);
  const estimatedTax = (taxableST * 0.37) + (taxableLT * 0.20);

  return {
    shortTermGains: isFinite(stGains) ? stGains : 0,
    shortTermLosses: isFinite(stLosses) ? stLosses : 0,
    longTermGains: isFinite(ltGains) ? ltGains : 0,
    longTermLosses: isFinite(ltLosses) ? ltLosses : 0,
    netGainLoss: isFinite(netGainLoss) ? netGainLoss : 0,
    estimatedTax: isFinite(estimatedTax) ? estimatedTax : 0,
    harvestedSavings: 0
  };
}

// Helpers
function _findSubstituteSecurity(symbol) {
  const substitutes = {
    'SPY': 'VOO', 'VOO': 'SPY', 'QQQ': 'QQQM',
    'IVV': 'VOO', 'SPLG': 'SPY', 'AGG': 'BND'
  };
  return substitutes[symbol] || null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM 4: ALTERNATIVE DATA PIPELINE (~130 lines)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get social sentiment for a symbol
 * @param {string} symbol - Stock symbol
 * @returns {Object} {score, volume, trend, topKeywords, bullishPct, bearishPct}
 */
export function getSocialSentiment(symbol) {
  if (!symbol || typeof symbol !== 'string') return { score: 0, volume: 0, trend: 'stable', topKeywords: [], bullishPct: 50, bearishPct: 50 };

  // Synthetic data generation for demo
  const seed = symbol.charCodeAt(0) + symbol.length;
  const score = (Math.sin(seed * 0.1) * 0.5 + 0.5) * 2 - 1;
  const volume = Math.floor(Math.random() * 50000) + 1000;
  const trend = score > 0.3 ? 'rising' : score < -0.3 ? 'falling' : 'stable';
  const bullishPct = Math.floor((score * 25 + 50) * 100) / 100;
  const bearishPct = 100 - bullishPct;

  const keywords = [
    ['bullish', 'strong', 'undervalued'], ['bearish', 'risk', 'decline'], ['earnings', 'growth', 'momentum']
  ];
  const topKeywords = keywords[Math.floor(Math.random() * keywords.length)];

  return { score: isFinite(score) ? score : 0, volume, trend, topKeywords, bullishPct, bearishPct };
}

/**
 * Get unusual options activity
 * @param {string} symbol - Stock symbol
 * @returns {Object} {putCallRatio, unusualActivity, smartMoneySignal}
 */
export function getOptionsFlow(symbol) {
  if (!symbol || typeof symbol !== 'string') {
    return { putCallRatio: 1.0, unusualActivity: [], smartMoneySignal: 'neutral' };
  }

  const putCallRatio = parseFloat((Math.random() * 2 + 0.5).toFixed(2));
  const signals = putCallRatio < 0.8 ? 'bullish' : putCallRatio > 1.2 ? 'bearish' : 'neutral';

  const unusualActivity = [];
  for (let i = 0; i < Math.floor(Math.random() * 3); i++) {
    unusualActivity.push({
      type: Math.random() > 0.5 ? 'call' : 'put',
      strike: Math.floor(Math.random() * 50) + 100,
      expiry: `${Math.floor(Math.random() * 3) + 1}W`,
      volume: Math.floor(Math.random() * 10000),
      sentiment: Math.random() > 0.5 ? 'bullish' : 'bearish'
    });
  }

  return { putCallRatio, unusualActivity, smartMoneySignal: signals };
}

/**
 * Get dark pool activity simulation
 * @param {string} symbol - Stock symbol
 * @returns {Object} {darkPoolPct, largePrints, netFlow}
 */
export function getDarkPoolActivity(symbol) {
  if (!symbol || typeof symbol !== 'string') {
    return { darkPoolPct: 0, largePrints: [], netFlow: 'mixed' };
  }

  const darkPoolPct = Math.floor(Math.random() * 20) + 5;
  const netFlow = ['buying', 'selling', 'mixed'][Math.floor(Math.random() * 3)];

  const largePrints = [];
  for (let i = 0; i < Math.floor(Math.random() * 4); i++) {
    largePrints.push({
      price: parseFloat((Math.random() * 50 + 100).toFixed(2)),
      size: Math.floor(Math.random() * 100000) + 10000,
      time: new Date(Date.now() - Math.random() * 3600000).toISOString()
    });
  }

  return { darkPoolPct, largePrints, netFlow };
}

/**
 * Get insider transaction data
 * @param {string} symbol - Stock symbol
 * @returns {Object} {recent, netInsiderSentiment, insiderScore}
 */
export function getInsiderTransactions(symbol) {
  if (!symbol || typeof symbol !== 'string') {
    return { recent: [], netInsiderSentiment: 'neutral', insiderScore: 50 };
  }

  const recent = [];
  const names = ['Smith', 'Johnson', 'Chen', 'Williams', 'Brown'];
  const sentiment = Math.random() > 0.5 ? 'BUY' : 'SELL';

  for (let i = 0; i < Math.floor(Math.random() * 3); i++) {
    recent.push({
      name: names[Math.floor(Math.random() * names.length)],
      title: ['CEO', 'CFO', 'Director', 'VP'][Math.floor(Math.random() * 4)],
      type: i === 0 ? sentiment : Math.random() > 0.5 ? 'BUY' : 'SELL',
      shares: Math.floor(Math.random() * 100000),
      value: Math.floor(Math.random() * 500000),
      date: new Date(Date.now() - Math.random() * 86400000 * 30).toISOString().split('T')[0]
    });
  }

  const netScore = sentiment === 'BUY' ? 50 + Math.random() * 50 : 50 - Math.random() * 50;
  const netSentiment = netScore > 60 ? 'bullish' : netScore < 40 ? 'bearish' : 'neutral';

  return { recent, netInsiderSentiment: netSentiment, insiderScore: Math.floor(netScore) };
}

/**
 * Get composite alternative data score
 * @param {string} symbol - Stock symbol
 * @returns {Object} {score, signal, confidence, components}
 */
export function getAlternativeDataComposite(symbol) {
  if (!symbol || typeof symbol !== 'string') {
    return { score: 50, signal: 'HOLD', confidence: 0, components: {} };
  }

  const social = getSocialSentiment(symbol);
  const options = getOptionsFlow(symbol);
  const darkPool = getDarkPoolActivity(symbol);
  const insider = getInsiderTransactions(symbol);

  const socialScore = (social.score + 1) * 50;
  const optionsScore = options.smartMoneySignal === 'bullish' ? 75 : options.smartMoneySignal === 'bearish' ? 25 : 50;
  const darkPoolScore = darkPool.netFlow === 'buying' ? 70 : darkPool.netFlow === 'selling' ? 30 : 50;
  const insiderScore = insider.insiderScore;

  const composite = (socialScore + optionsScore + darkPoolScore + insiderScore) / 4;
  const signal = composite > 60 ? 'BUY' : composite < 40 ? 'SELL' : 'HOLD';
  const confidence = Math.abs(composite - 50) / 50;

  return {
    score: Math.floor(composite),
    signal,
    confidence: isFinite(confidence) ? confidence : 0,
    components: { socialScore, optionsScore, darkPoolScore, insiderScore }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM 5: TRADE JOURNAL & ANALYTICS (~150 lines)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Add trade to journal
 * @param {Object} trade - Trade object
 * @param {string} notes - User notes
 * @returns {string} Journal entry ID
 */
export function addJournalEntry(trade, notes = '') {
  if (!trade || typeof trade !== 'object') return null;

  const entry = {
    id: `je_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    symbol: trade.symbol || '',
    entryPrice: typeof trade.entryPrice === 'number' ? trade.entryPrice : 0,
    exitPrice: typeof trade.exitPrice === 'number' ? trade.exitPrice : 0,
    quantity: typeof trade.quantity === 'number' ? trade.quantity : 0,
    pnl: typeof trade.pnl === 'number' ? trade.pnl : 0,
    entryTime: trade.entryTime || new Date().toISOString(),
    exitTime: trade.exitTime || new Date().toISOString(),
    agentId: trade.agentId || '',
    notes: notes || '',
    emotionalState: '',
    rationale: '',
    lessons: '',
    tags: [],
    createdAt: new Date().toISOString()
  };

  const holdTime = new Date(entry.exitTime) - new Date(entry.entryTime);
  entry.holdHours = Math.floor(holdTime / (1000 * 60 * 60));
  entry.holdDays = Math.floor(holdTime / (1000 * 60 * 60 * 24));

  try {
    const journal = JSON.parse(localStorage.getItem('12tribes_trade_journal') || '[]');
    journal.push(entry);
    localStorage.setItem('12tribes_trade_journal', JSON.stringify(journal));
  } catch (e) {
    return null;
  }

  return entry.id;
}

/**
 * Query journal entries with filters
 * @param {Object} filters - {startDate, endDate, symbol, agent, minPnl, maxPnl, tags}
 * @returns {Array} Matching entries
 */
export function getJournalEntries(filters = {}) {
  let entries = [];
  try {
    entries = JSON.parse(localStorage.getItem('12tribes_trade_journal') || '[]');
  } catch (e) {
    return [];
  }

  if (!filters || typeof filters !== 'object') return entries;

  return entries.filter(e => {
    if (filters.startDate && new Date(e.createdAt) < new Date(filters.startDate)) return false;
    if (filters.endDate && new Date(e.createdAt) > new Date(filters.endDate)) return false;
    if (filters.symbol && e.symbol !== filters.symbol) return false;
    if (filters.agent && e.agentId !== filters.agent) return false;
    if (typeof filters.minPnl === 'number' && e.pnl < filters.minPnl) return false;
    if (typeof filters.maxPnl === 'number' && e.pnl > filters.maxPnl) return false;
    return true;
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Analyze behavioral patterns in trades
 * @param {Array<Object>} entries - Journal entries
 * @returns {Object} {patterns, behaviorScore}
 */
export function analyzePatterns(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { patterns: [], behaviorScore: 0 };
  }

  const patterns = [];
  let score = 50;

  // Overtrading detection
  const tradesPerDay = {};
  entries.forEach(e => {
    const day = new Date(e.entryTime).toDateString();
    tradesPerDay[day] = (tradesPerDay[day] || 0) + 1;
  });

  const avgPerDay = Object.values(tradesPerDay).reduce((a, b) => a + b, 0) / Object.keys(tradesPerDay).length || 0;
  if (avgPerDay > 10) {
    patterns.push({
      name: 'Overtrading',
      description: `Average ${avgPerDay.toFixed(1)} trades/day may indicate overtrading`,
      impact: 'negative',
      recommendation: 'Implement stricter trade limits'
    });
    score -= 10;
  }

  // Revenge trading detection
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const curr = entries[i];
    const timeDiff = new Date(curr.entryTime) - new Date(prev.exitTime);

    if (prev.pnl < -100 && timeDiff < 3600000 && curr.quantity > prev.quantity * 1.5) {
      patterns.push({
        name: 'Revenge Trading',
        description: 'Large loss followed by oversized position suggests emotional trading',
        impact: 'negative',
        recommendation: 'Add cool-off period after losses'
      });
      score -= 15;
      break;
    }
  }

  // Time of day patterns
  const byHour = {};
  entries.forEach(e => {
    const hour = new Date(e.entryTime).getHours();
    if (!byHour[hour]) byHour[hour] = { trades: 0, pnl: 0 };
    byHour[hour].trades += 1;
    byHour[hour].pnl += e.pnl || 0;
  });

  const bestHour = Object.entries(byHour).reduce((best, [h, d]) => d.pnl / d.trades > best.pnl / best.trades ? { h, ...d } : best);
  if (bestHour && bestHour.trades > 0) {
    patterns.push({
      name: 'Time-of-Day Bias',
      description: `Best performance during hour ${bestHour.h}:00`,
      impact: 'positive',
      recommendation: 'Focus trading during high-probability hours'
    });
    score += 5;
  }

  return { patterns, behaviorScore: Math.max(0, Math.min(100, score)) };
}

/**
 * Get aggregate trade statistics
 * @param {Array<Object>} entries - Journal entries
 * @returns {Object} Trade statistics
 */
export function getTradeStats(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { totalTrades: 0, winRate: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, avgHoldTime: 0, largestWin: 0, largestLoss: 0, currentStreak: 0, bestStreak: 0, avgTradesPerDay: 0 };
  }

  const wins = entries.filter(e => (e.pnl || 0) > 0);
  const losses = entries.filter(e => (e.pnl || 0) < 0);

  const totalWinAmount = wins.reduce((sum, e) => sum + (e.pnl || 0), 0);
  const totalLossAmount = Math.abs(losses.reduce((sum, e) => sum + (e.pnl || 0), 0));

  const avgWin = wins.length > 0 ? totalWinAmount / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLossAmount / losses.length : 0;
  const profitFactor = avgLoss !== 0 ? avgWin / avgLoss : 0;

  const avgHold = entries.reduce((sum, e) => sum + (e.holdHours || 0), 0) / entries.length || 0;

  // Streak calculation
  let currentStreak = 0, bestStreak = 0;
  for (const e of entries) {
    if ((e.pnl || 0) > 0) {
      currentStreak += 1;
      bestStreak = Math.max(bestStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  const daysTraded = new Set(entries.map(e => new Date(e.entryTime).toDateString())).size;
  const avgPerDay = entries.length / (daysTraded || 1);

  return {
    totalTrades: entries.length,
    winRate: entries.length > 0 ? wins.length / entries.length : 0,
    avgWin: isFinite(avgWin) ? avgWin : 0,
    avgLoss: isFinite(avgLoss) ? avgLoss : 0,
    profitFactor: isFinite(profitFactor) ? profitFactor : 0,
    avgHoldTime: isFinite(avgHold) ? avgHold : 0,
    largestWin: Math.max(0, ...entries.map(e => e.pnl || 0)),
    largestLoss: Math.min(0, ...entries.map(e => e.pnl || 0)),
    currentStreak,
    bestStreak,
    avgTradesPerDay: isFinite(avgPerDay) ? avgPerDay : 0
  };
}

/**
 * Export journal to JSON or CSV
 * @param {string} format - 'json' or 'csv'
 * @returns {string} Serialized journal
 */
export function exportJournal(format = 'json') {
  let entries = [];
  try {
    entries = JSON.parse(localStorage.getItem('12tribes_trade_journal') || '[]');
  } catch (e) {
    return '';
  }

  if (format === 'csv') {
    const headers = ['Symbol', 'EntryPrice', 'ExitPrice', 'Quantity', 'PnL', 'HoldHours', 'Agent', 'Timestamp'];
    const rows = entries.map(e => [
      e.symbol,
      e.entryPrice,
      e.exitPrice,
      e.quantity,
      e.pnl,
      e.holdHours,
      e.agentId,
      e.createdAt
    ]);
    return [headers, ...rows].map(row => row.map(v => `"${v}"`).join(',')).join('\n');
  }

  return JSON.stringify(entries, null, 2);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM 6: PAPER-TO-LIVE GRADUATION SYSTEM (~150 lines)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Evaluate if agent is ready for live trading
 * @param {string} agentId - Agent ID
 * @returns {Object} {ready, score, criteria, recommendation, estimatedLiveAllocation}
 */
export function evaluateGraduationReadiness(agentId) {
  if (!agentId || typeof agentId !== 'string') {
    return { ready: false, score: 0, criteria: [], recommendation: 'Invalid agent', estimatedLiveAllocation: 0 };
  }

  // Retrieve paper trading metrics (simulated)
  const metrics = _getAgentMetrics(agentId);

  const criteria = [
    { name: 'Min 30 Paper Trades', required: 30, actual: metrics.trades, passed: metrics.trades >= 30 },
    { name: 'Win Rate > 45%', required: 0.45, actual: metrics.winRate, passed: metrics.winRate > 0.45 },
    { name: 'Sharpe Ratio > 0.5', required: 0.5, actual: metrics.sharpe, passed: metrics.sharpe > 0.5 },
    { name: 'Max Drawdown < 20%', required: 0.2, actual: metrics.maxDrawdown, passed: metrics.maxDrawdown < 0.2 },
    { name: 'Profit Factor > 1.2', required: 1.2, actual: metrics.profitFactor, passed: metrics.profitFactor > 1.2 },
    { name: 'Min 14 Days Paper', required: 14, actual: metrics.daysPaper, passed: metrics.daysPaper >= 14 }
  ];

  const passed = criteria.filter(c => c.passed).length;
  const score = (passed / criteria.length) * 100;
  const ready = passed === criteria.length;

  let recommendation = 'Not ready';
  if (score >= 80) recommendation = 'Ready for small live allocation';
  if (score >= 90) recommendation = 'Ready for medium live allocation';
  if (score === 100) recommendation = 'Excellent - ready for full live';

  const estimatedAllocation = ready ? Math.min(50000, 10000 + (score / 100) * 40000) : 0;

  return { ready, score: Math.floor(score), criteria, recommendation, estimatedLiveAllocation: Math.floor(estimatedAllocation) };
}

/**
 * Get graduation dashboard for all agents
 * @returns {Object} {agents}
 */
export function getGraduationDashboard() {
  let agentIds = [];
  try {
    const rules = JSON.parse(localStorage.getItem('12tribes_agent_list') || '[]');
    agentIds = rules.map(r => r.id);
  } catch (e) {
    agentIds = ['agent_1', 'agent_2', 'agent_3'];
  }

  const agents = agentIds.map(id => {
    const readiness = evaluateGraduationReadiness(id);
    const metrics = _getAgentMetrics(id);

    let status = 'paper';
    if (readiness.score >= 100) status = 'graduated';
    else if (readiness.score >= 80) status = 'qualifying';
    else if (readiness.score < 40) status = 'suspended';

    return {
      id,
      name: `Agent ${id}`,
      paperDays: metrics.daysPaper,
      trades: metrics.trades,
      winRate: (metrics.winRate * 100).toFixed(1),
      sharpe: metrics.sharpe.toFixed(2),
      drawdown: (metrics.maxDrawdown * 100).toFixed(1),
      status,
      progress: readiness.score
    };
  });

  return { agents };
}

/**
 * Promote agent to live trading
 * @param {string} agentId - Agent ID
 * @returns {Object} {promoted, initialAllocation, restrictions}
 */
export function promoteToLive(agentId) {
  if (!agentId || typeof agentId !== 'string') {
    return { promoted: false, initialAllocation: 0, restrictions: ['Invalid agent ID'] };
  }

  const readiness = evaluateGraduationReadiness(agentId);

  if (!readiness.ready) {
    return { promoted: false, initialAllocation: 0, restrictions: readiness.criteria.filter(c => !c.passed).map(c => c.name) };
  }

  try {
    const status = JSON.parse(localStorage.getItem('12tribes_agent_status') || '{}');
    status[agentId] = { liveStatus: 'live', promotedAt: new Date().toISOString() };
    localStorage.setItem('12tribes_agent_status', JSON.stringify(status));
  } catch (e) {
    return { promoted: false, initialAllocation: 0, restrictions: ['Storage error'] };
  }

  const restrictions = [
    'Max 5% of portfolio per trade',
    'Daily loss limit $10k',
    'Monitor closely first 7 days',
    'Reduce if Sharpe drops below 0.5'
  ];

  return { promoted: true, initialAllocation: readiness.estimatedLiveAllocation, restrictions };
}

/**
 * Demote agent from live trading
 * @param {string} agentId - Agent ID
 * @param {string} reason - Reason for demotion
 * @returns {Object} {demoted, reason, cooldownDays}
 */
export function demoteFromLive(agentId, reason = '') {
  if (!agentId || typeof agentId !== 'string') {
    return { demoted: false, reason: 'Invalid agent ID', cooldownDays: 0 };
  }

  try {
    const status = JSON.parse(localStorage.getItem('12tribes_agent_status') || '{}');
    status[agentId] = { liveStatus: 'paper', demotedAt: new Date().toISOString(), reason };
    localStorage.setItem('12tribes_agent_status', JSON.stringify(status));
  } catch (e) {
    return { demoted: false, reason: 'Storage error', cooldownDays: 0 };
  }

  return { demoted: true, reason: reason || 'Performance degradation', cooldownDays: 14 };
}

/**
 * Compare paper vs live performance
 * @param {string} agentId - Agent ID
 * @returns {Object} Paper vs live metrics
 */
export function getLiveVsPaperComparison(agentId) {
  if (!agentId || typeof agentId !== 'string') {
    return { paper: {}, live: {}, slippageCost: 0, executionQuality: 'unknown', divergenceScore: 0 };
  }

  const paperMetrics = _getAgentMetrics(agentId, 'paper');
  const liveMetrics = _getAgentMetrics(agentId, 'live');

  const slippageCost = paperMetrics.avgReturn - liveMetrics.avgReturn;
  const executionQuality = slippageCost < 0.2 ? 'excellent' : slippageCost < 0.5 ? 'good' : 'poor';
  const divergenceScore = Math.abs(paperMetrics.sharpe - liveMetrics.sharpe) / Math.max(paperMetrics.sharpe, 0.1);

  return {
    paper: { sharpe: paperMetrics.sharpe, winRate: paperMetrics.winRate, avgReturn: paperMetrics.avgReturn },
    live: { sharpe: liveMetrics.sharpe, winRate: liveMetrics.winRate, avgReturn: liveMetrics.avgReturn },
    slippageCost: isFinite(slippageCost) ? slippageCost : 0,
    executionQuality,
    divergenceScore: isFinite(divergenceScore) ? divergenceScore : 0
  };
}

// Helpers
function _getAgentMetrics(agentId, mode = 'paper') {
  // Simulate agent metrics
  const seed = agentId.charCodeAt(0) + agentId.length;
  const trades = Math.floor(Math.random() * 100) + 15;
  const winRate = Math.random() * 0.6 + 0.35;
  const sharpe = Math.random() * 2 + 0.3;
  const maxDrawdown = Math.random() * 0.25;
  const profitFactor = Math.random() * 2 + 0.8;
  const daysPaper = Math.floor(Math.random() * 60) + 14;
  const avgReturn = Math.random() * 0.02;

  return { trades, winRate, sharpe, maxDrawdown, profitFactor, daysPaper, avgReturn };
}

export default {
  attributePerformance,
  getAgentAllocationRecommendation,
  getPerformanceHeatmap,
  createAlert,
  evaluateAlerts,
  getAlertHistory,
  dismissAlert,
  deleteAlertRule,
  getActiveRules,
  formatAlertForDisplay,
  identifyTaxLossOpportunities,
  executeHarvest,
  getWashSaleCalendar,
  getAnnualTaxSummary,
  getSocialSentiment,
  getOptionsFlow,
  getDarkPoolActivity,
  getInsiderTransactions,
  getAlternativeDataComposite,
  addJournalEntry,
  getJournalEntries,
  analyzePatterns,
  getTradeStats,
  exportJournal,
  evaluateGraduationReadiness,
  getGraduationDashboard,
  promoteToLive,
  demoteFromLive,
  getLiveVsPaperComparison
};
