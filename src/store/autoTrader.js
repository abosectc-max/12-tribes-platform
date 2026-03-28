/**
 * 24/7 Autonomous Trading Engine - Continuous Algorithmic Trading
 * Manages market sessions, executes trades autonomously, monitors positions,
 * and maintains daily/weekly operational summaries.
 *
 * @module autoTrader
 * @description Pure ES module for autonomous trading across multiple asset classes
 * with 24/7/365 operation, risk management, and comprehensive logging.
 */

// ============================================================================
// DEPENDENCIES (Relative imports from src/store/)
// ============================================================================

// NOTE: Import these when integrating with actual store modules:
// import { executeTrade, getWalletState } from './walletStore.js';
// import { getConsensusSignal, getAgentAccuracy } from './signalConsensus.js';
// import { emergencyStop as monitorEmergencyStop } from './healthMonitor.js';

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let autoTradingActive = false;
let autoTradingInterval = null;
let autoTraderConfig = {
  enabled: false,
  mode: 'paper', // 'paper' | 'live'
  investorId: null,
  maxDailyTrades: 20,
  maxDailyLoss: 500, // USD
  tradingHours: { start: 0, end: 24 }, // UTC hours
  allowedAssets: ['BTC', 'ETH', 'AAPL', 'GOOGL', 'SPY'],
};

const activePositions = new Map();
const dailyTradeLog = [];
let dailyStats = {
  tradesExecuted: 0,
  totalPnL: 0,
  winCount: 0,
  lossCount: 0,
  winRate: 0,
  bestTrade: null,
  worstTrade: null,
  largestGain: 0,
  largestLoss: 0,
};

let weeklyStats = {
  week: new Date().getUTCDate(),
  trades: 0,
  totalPnL: 0,
  avgWinRate: 0,
};

let killSwitchState = {
  active: false,
  reason: null,
  timestamp: null,
  triggered: false,
};

let tickCount = 0;
let sessionTickInterval = {
  crypto: 30000, // 30 seconds (always open)
  forex: 30000, // 30 seconds (always open)
  stocks: 60000, // 60 seconds (market hours only)
  futures: 30000, // 30 seconds
};

// ============================================================================
// MARKET SESSION MANAGER
// ============================================================================

/**
 * Market session definitions with opening/closing times
 * @typedef {Object} MarketSession
 * @property {string} name - Market name
 * @property {Array<number>} openTime - [hour, minute] in specified timezone
 * @property {Array<number>} closeTime - [hour, minute] in specified timezone
 * @property {string} timezone - Timezone code (e.g., 'ET', 'UTC')
 * @property {Array<number>} tradingDays - [0-6] where 0=Sunday, 6=Saturday
 * @property {boolean} is24h - Whether market is open 24/7
 */

const marketSessions = [
  {
    name: 'US Stocks',
    assetClass: 'stocks',
    openTime: [9, 30],
    closeTime: [16, 0],
    preMarketOpen: [4, 0],
    afterHoursClose: [20, 0],
    timezone: 'ET',
    tradingDays: [1, 2, 3, 4, 5], // Mon-Fri
    is24h: false,
  },
  {
    name: 'Crypto',
    assetClass: 'crypto',
    is24h: true,
    timezone: 'UTC',
  },
  {
    name: 'Forex',
    assetClass: 'forex',
    openTime: [17, 0], // Sun 17:00 ET = Mon 00:00 UTC
    closeTime: [17, 0], // Fri 17:00 ET = Fri 22:00 UTC
    timezone: 'ET',
    is24h: true,
    note: 'Sun 17:00 ET - Fri 17:00 ET',
  },
  {
    name: 'Futures',
    assetClass: 'futures',
    openTime: [18, 0], // Sun 18:00 ET = Mon 01:00 UTC
    closeTime: [17, 0], // Fri 17:00 ET
    dailyBreak: [1, 0], // 1 hour break daily
    timezone: 'ET',
    is24h: false,
  },
];

/**
 * Gets current market session status
 * @returns {Object} Market session information for all asset classes
 */
export function getMarketSessions() {
  const now = new Date();
  const results = {};

  for (const market of marketSessions) {
    results[market.assetClass] = {
      name: market.name,
      isOpen: isMarketOpen(market.assetClass),
      nextEvent: getNextMarketEvent(market.assetClass),
      timezone: market.timezone,
    };
  }

  return results;
}

/**
 * Checks if a specific market is currently open
 * @param {string} assetClass - Asset class to check ('stocks'|'crypto'|'forex'|'futures')
 * @returns {boolean} Whether market is open
 */
export function isMarketOpen(assetClass) {
  const market = marketSessions.find((m) => m.assetClass === assetClass);
  if (!market) return false;

  if (market.is24h) {
    // For 24/7 markets, check if in daily break (if applicable)
    if (assetClass === 'futures') {
      const now = new Date();
      const hour = now.getUTCHours();
      const minute = now.getUTCMinutes();

      // Futures has 1-hour daily break
      if (hour === 1 && minute >= 0) {
        // 01:00-02:00 UTC = 20:00-21:00 ET
        return false;
      }
    }
    return true;
  }

  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const hour = now.getUTCHours();
  const minute = now.getUTCMinutes();

  // Check if today is a trading day
  if (!market.tradingDays.includes(dayOfWeek)) {
    return false;
  }

  // For US stocks: check pre-market, regular hours, and after-hours
  if (assetClass === 'stocks') {
    const timeInMinutes = hour * 60 + minute;
    const preMarketStart = 4 * 60; // 04:00 ET
    const regularStart = 9.5 * 60; // 09:30 ET
    const regularEnd = 16 * 60; // 16:00 ET
    const afterHoursEnd = 20 * 60; // 20:00 ET

    // Convert to ET (UTC-4 or UTC-5 depending on DST, using UTC+5 as approximation)
    // For simplicity, assume ET = UTC - 5
    const etTime = timeInMinutes - 300; // Rough conversion
    return etTime >= preMarketStart && etTime < afterHoursEnd;
  }

  // For Forex: open Sun 17:00 ET to Fri 17:00 ET
  if (assetClass === 'forex') {
    if (dayOfWeek === 0) {
      // Sunday, check if after 17:00 ET
      return hour >= 21; // 17:00 ET = 21:00 UTC
    }
    if (dayOfWeek >= 1 && dayOfWeek <= 4) {
      // Mon-Thu, always open
      return true;
    }
    if (dayOfWeek === 5) {
      // Friday, check if before 21:00 UTC (17:00 ET)
      return hour < 21;
    }
    return false;
  }

  return false;
}

/**
 * Gets the next market open/close event
 * @param {string} assetClass - Asset class to check
 * @returns {Object} Next event information
 */
export function getNextMarketEvent(assetClass) {
  // Stub: In real implementation, calculate from current time
  return {
    event: 'market_open',
    asset: assetClass,
    timestamp: Date.now() + 3600000,
    hoursUntil: 1,
  };
}

// ============================================================================
// TRADING SCHEDULER
// ============================================================================

/**
 * Starts the autonomous trading engine
 * @param {Object} config - Trading configuration
 * @param {boolean} config.enabled - Enable/disable trading
 * @param {string} config.mode - 'paper' or 'live'
 * @param {string} config.investorId - Investor identifier
 * @param {number} config.maxDailyTrades - Max trades per day (default: 20)
 * @param {number} config.maxDailyLoss - Max daily loss in USD (default: 500)
 * @param {Object} config.tradingHours - Trading hours { start: 0, end: 24 }
 * @param {Array<string>} config.allowedAssets - Array of allowed asset symbols
 * @returns {Function} Cleanup function to stop trading
 */
export function startAutoTrader(config = {}) {
  autoTraderConfig = { ...autoTraderConfig, ...config };

  if (autoTradingActive) {
    console.warn('[AutoTrader] Trading already active');
    return () => stopAutoTrader();
  }

  if (!autoTraderConfig.enabled) {
    console.warn('[AutoTrader] Trading disabled in config');
    return () => stopAutoTrader();
  }

  autoTradingActive = true;
  tickCount = 0;
  dailyTradeLog.length = 0;
  resetDailyStats();

  console.log('[AutoTrader] Starting autonomous trading engine', {
    mode: autoTraderConfig.mode,
    investorId: autoTraderConfig.investorId,
    maxDailyTrades: autoTraderConfig.maxDailyTrades,
  });

  // Start trading loop with appropriate tick interval
  const tickInterval = determineTickInterval();
  autoTradingInterval = setInterval(() => {
    if (autoTradingActive) {
      runTradingTick();
    }
  }, tickInterval);

  return () => stopAutoTrader();
}

/**
 * Stops the trading engine
 */
export function stopAutoTrader() {
  if (autoTradingInterval) {
    clearInterval(autoTradingInterval);
    autoTradingInterval = null;
  }
  autoTradingActive = false;
  console.log('[AutoTrader] Autonomous trading stopped');
}

/**
 * Determines appropriate tick interval based on market sessions
 * @private
 */
function determineTickInterval() {
  const cryptoOpen = isMarketOpen('crypto');
  const forexOpen = isMarketOpen('forex');
  const stocksOpen = isMarketOpen('stocks');

  // Use fastest available interval
  if (cryptoOpen || forexOpen) {
    return sessionTickInterval.crypto; // 30s for always-open markets
  }

  return sessionTickInterval.stocks; // 60s for regular markets
}

/**
 * Main trading tick - runs every interval
 * @private
 */
async function runTradingTick() {
  tickCount++;

  try {
    // 1. Check kill switch
    if (killSwitchState.active) {
      console.warn('[AutoTrader] Kill switch active, aborting tick');
      return;
    }

    // 2. Check if any markets are open
    const sessions = getMarketSessions();
    const anyMarketOpen = Object.values(sessions).some((s) => s.isOpen);

    if (!anyMarketOpen) {
      console.debug('[AutoTrader] No markets open, skipping tick');
      return;
    }

    // 3. Check daily trade limits
    if (dailyStats.tradesExecuted >= autoTraderConfig.maxDailyTrades) {
      console.warn('[AutoTrader] Daily trade limit reached');
      return;
    }

    // 4. Get consensus signal (stub: would call signalConsensus module)
    const consensusSignal = getStubConsensusSignal();

    if (!consensusSignal || consensusSignal.score < 0.5) {
      console.debug('[AutoTrader] Consensus signal below threshold');
      return;
    }

    // 5. Execute trade pipeline
    const tradeResult = await executeTradePipeline(
      consensusSignal,
      consensusSignal
    );

    if (tradeResult.executed) {
      // Log successful trade
      const trade = {
        tickNumber: tickCount,
        timestamp: Date.now(),
        orderId: tradeResult.orderId,
        asset: consensusSignal.asset,
        signal: consensusSignal,
        position: tradeResult.position,
        pnl: 0,
        status: 'open',
      };

      dailyTradeLog.push(trade);
      dailyStats.tradesExecuted++;
    }
  } catch (error) {
    console.error('[AutoTrader] Error in trading tick:', error);
  }
}

/**
 * Gets stub consensus signal for testing
 * @private
 */
function getStubConsensusSignal() {
  // In real implementation, call signalConsensus.getConsensus()
  return {
    asset: 'BTC',
    action: 'buy',
    score: 0.75,
    confidence: 0.82,
    agents: { bullish: 3, bearish: 1, neutral: 1 },
    timestamp: Date.now(),
  };
}

// ============================================================================
// TRADE EXECUTION PIPELINE
// ============================================================================

/**
 * Executes complete trade pipeline with risk checks, sizing, and logging
 * @param {Object} signal - Trading signal
 * @param {Object} consensus - Consensus information
 * @returns {Promise<Object>} Trade result { executed, reason, orderId, position }
 */
export async function executeTradePipeline(signal, consensus) {
  const pipelineResult = {
    executed: false,
    reason: null,
    orderId: null,
    position: null,
    errors: [],
  };

  try {
    // Step 1: Pre-trade risk checks
    const riskCheck = performPreTradeRiskCheck(signal, consensus);
    if (!riskCheck.passed) {
      pipelineResult.reason = riskCheck.reason;
      pipelineResult.errors.push(riskCheck.reason);
      console.warn('[AutoTrader] Pre-trade risk check failed:', riskCheck.reason);
      return pipelineResult;
    }

    // Step 2: Consensus validation
    const consensusValid = validateConsensus(consensus);
    if (!consensusValid.valid) {
      pipelineResult.reason = consensusValid.reason;
      pipelineResult.errors.push(consensusValid.reason);
      console.warn('[AutoTrader] Consensus validation failed:', consensusValid.reason);
      return pipelineResult;
    }

    // Step 3: Sentinel veto check (stub)
    const sentinelCheck = await checkSentinelVeto(signal);
    if (sentinelCheck.vetoed) {
      pipelineResult.reason = `Sentinel veto: ${sentinelCheck.reason}`;
      console.warn('[AutoTrader] Trade vetoed by Sentinel:', sentinelCheck.reason);
      return pipelineResult;
    }

    // Step 4: Position sizing via Titan agent (Kelly criterion)
    const positionSize = calculatePositionSize(signal, consensus);
    if (positionSize <= 0) {
      pipelineResult.reason = 'Invalid position size calculated';
      return pipelineResult;
    }

    // Step 5: Order placement
    const order = await placeOrder(signal, positionSize);
    if (!order.success) {
      pipelineResult.reason = order.error;
      pipelineResult.errors.push(order.error);
      console.error('[AutoTrader] Order placement failed:', order.error);
      return pipelineResult;
    }

    pipelineResult.orderId = order.orderId;
    pipelineResult.position = {
      asset: signal.asset,
      quantity: positionSize,
      entryPrice: order.executedPrice,
      entryTime: Date.now(),
      orderId: order.orderId,
    };

    // Step 6: Set stop-loss and take-profit orders
    await placeStopLossOrder(order.orderId, signal, order.executedPrice);
    await placeTakeProfitOrder(order.orderId, signal, order.executedPrice);

    // Step 7: Update agent accuracy and log
    updateAgentAccuracy(signal, consensus);
    logTradeExecution(signal, order, positionSize);

    pipelineResult.executed = true;
    console.log('[AutoTrader] Trade executed successfully:', {
      asset: signal.asset,
      size: positionSize,
      orderId: order.orderId,
    });
  } catch (error) {
    pipelineResult.reason = error.message;
    pipelineResult.errors.push(error.message);
    console.error('[AutoTrader] Pipeline error:', error);
  }

  return pipelineResult;
}

/**
 * Performs pre-trade risk checks
 * @private
 */
function performPreTradeRiskCheck(signal, consensus) {
  // Check daily loss limit
  if (
    dailyStats.totalPnL < -autoTraderConfig.maxDailyLoss
  ) {
    return {
      passed: false,
      reason: `Daily loss limit exceeded: $${Math.abs(dailyStats.totalPnL)}`,
    };
  }

  // Check position correlation
  const correlation = calculatePortfolioCorrelation(signal.asset);
  if (correlation > 0.9) {
    return {
      passed: false,
      reason: `High portfolio correlation: ${(correlation * 100).toFixed(1)}%`,
    };
  }

  // Check asset is allowed
  if (!autoTraderConfig.allowedAssets.includes(signal.asset)) {
    return {
      passed: false,
      reason: `Asset ${signal.asset} not in allowed list`,
    };
  }

  return { passed: true };
}

/**
 * Validates consensus quality
 * @private
 */
function validateConsensus(consensus) {
  if (!consensus) {
    return { valid: false, reason: 'No consensus signal' };
  }

  if (consensus.score < 0.5) {
    return { valid: false, reason: `Consensus score too low: ${consensus.score}` };
  }

  if (!consensus.agents || Object.keys(consensus.agents).length < 3) {
    return { valid: false, reason: 'Insufficient agent agreement' };
  }

  return { valid: true };
}

/**
 * Checks Sentinel veto (stub)
 * @private
 */
async function checkSentinelVeto(signal) {
  // In real implementation, call Sentinel monitoring service
  return { vetoed: false, reason: null };
}

/**
 * Calculates position size using Kelly criterion
 * @private
 */
function calculatePositionSize(signal, consensus) {
  // Simplified Kelly: f* = (p * b - q) / b
  // where p = win probability, q = loss probability, b = ratio of wins to losses
  const confidenceAsWinProb = consensus.confidence || 0.6;
  const avgWinRatio = dailyStats.bestTrade
    ? dailyStats.bestTrade / Math.abs(dailyStats.worstTrade || 1)
    : 1.5;

  const kellyFraction = (confidenceAsWinProb * avgWinRatio - (1 - confidenceAsWinProb))
    / avgWinRatio;

  // Apply conservative scaling (use 25% of Kelly)
  const scaledFraction = Math.max(0.01, Math.min(0.05, kellyFraction * 0.25));

  // Return position size as percentage of account (stub)
  return Math.round(scaledFraction * 10000) / 100; // As % of account
}

/**
 * Places order via wallet (stub)
 * @private
 */
async function placeOrder(signal, quantity) {
  try {
    // In real implementation: call walletStore.executeTrade()
    // For now, stub successful order
    return {
      success: true,
      orderId: `ORDER_${Date.now()}`,
      asset: signal.asset,
      quantity,
      executedPrice: 45000, // Stub price
      timestamp: Date.now(),
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Places stop-loss order
 * @private
 */
async function placeStopLossOrder(orderId, signal, entryPrice) {
  const stopLossPrice = entryPrice * (signal.action === 'buy' ? 0.95 : 1.05); // 5% stop

  console.log('[AutoTrader] Stop-loss set:', {
    orderId,
    price: stopLossPrice,
    asset: signal.asset,
  });

  // In real implementation: place actual SL order via broker API
}

/**
 * Places take-profit order
 * @private
 */
async function placeTakeProfitOrder(orderId, signal, entryPrice) {
  const takeProfitPrice = entryPrice * (signal.action === 'buy' ? 1.1 : 0.9); // 10% target

  console.log('[AutoTrader] Take-profit set:', {
    orderId,
    price: takeProfitPrice,
    asset: signal.asset,
  });

  // In real implementation: place actual TP order via broker API
}

/**
 * Updates agent accuracy metrics
 * @private
 */
function updateAgentAccuracy(signal, consensus) {
  // In real implementation: call signalConsensus.updateAccuracy()
  console.debug('[AutoTrader] Agent accuracy updated for signal:', signal.asset);
}

/**
 * Logs trade execution
 * @private
 */
function logTradeExecution(signal, order, quantity) {
  try {
    const logsStr = localStorage.getItem('12tribes_trading_log') || '[]';
    const logs = JSON.parse(logsStr);

    logs.push({
      timestamp: Date.now(),
      mode: autoTraderConfig.mode,
      asset: signal.asset,
      action: signal.action,
      quantity,
      entryPrice: order.executedPrice,
      orderId: order.orderId,
      consensus: {
        score: 0.75, // Stub
      },
    });

    // Keep last 1000 trades
    if (logs.length > 1000) {
      logs.shift();
    }

    localStorage.setItem('12tribes_trading_log', JSON.stringify(logs));
  } catch (error) {
    console.error('[AutoTrader] Error logging trade:', error);
  }
}

/**
 * Calculates portfolio correlation with new position
 * @private
 */
function calculatePortfolioCorrelation(asset) {
  // Stub: In real implementation, calculate actual correlation
  return 0.6;
}

// ============================================================================
// POSITION MANAGER
// ============================================================================

/**
 * Monitors all active positions continuously
 */
export async function monitorPositions() {
  for (const [posId, position] of activePositions) {
    try {
      // Check stop-loss
      if (isStopLossHit(position)) {
        await closePosition(posId, 'stop_loss', position.currentPrice);
        continue;
      }

      // Check take-profit
      if (isTakeProfitHit(position)) {
        await closePosition(posId, 'take_profit', position.currentPrice);
        continue;
      }

      // Check trailing stop
      if (position.trailingStop) {
        updateTrailingStop(position);
      }

      // Check time-based exit
      const holdTime = Date.now() - position.entryTime;
      if (holdTime > position.maxHoldTime) {
        await closePosition(posId, 'time_exit', position.currentPrice);
      }

      // Check correlation exit
      const correlation = calculatePortfolioCorrelation(position.asset);
      if (correlation > 0.95) {
        await closePosition(posId, 'correlation_exit', position.currentPrice);
      }
    } catch (error) {
      console.error(`[AutoTrader] Error monitoring position ${posId}:`, error);
    }
  }
}

/**
 * Checks if stop-loss is hit
 * @private
 */
function isStopLossHit(position) {
  if (!position.stopLoss) return false;

  if (position.action === 'buy') {
    return position.currentPrice <= position.stopLoss;
  }
  return position.currentPrice >= position.stopLoss;
}

/**
 * Checks if take-profit is hit
 * @private
 */
function isTakeProfitHit(position) {
  if (!position.takeProfit) return false;

  if (position.action === 'buy') {
    return position.currentPrice >= position.takeProfit;
  }
  return position.currentPrice <= position.takeProfit;
}

/**
 * Updates trailing stop
 * @private
 */
function updateTrailingStop(position) {
  const trailPercent = 0.05; // 5% trail

  if (position.action === 'buy') {
    const newStop = position.currentPrice * (1 - trailPercent);
    if (newStop > position.stopLoss) {
      position.stopLoss = newStop;
    }
  } else {
    const newStop = position.currentPrice * (1 + trailPercent);
    if (newStop < position.stopLoss) {
      position.stopLoss = newStop;
    }
  }
}

/**
 * Closes a position
 * @private
 */
async function closePosition(posId, reason, exitPrice) {
  const position = activePositions.get(posId);
  if (!position) return;

  const pnl = calculatePositionPnL(position, exitPrice);

  // Update daily stats
  dailyStats.totalPnL += pnl;
  if (pnl > 0) {
    dailyStats.winCount++;
  } else {
    dailyStats.lossCount++;
  }

  const totalTrades = dailyStats.winCount + dailyStats.lossCount;
  dailyStats.winRate = (dailyStats.winCount / totalTrades) * 100;

  if (!dailyStats.bestTrade || pnl > dailyStats.bestTrade) {
    dailyStats.bestTrade = pnl;
  }
  if (!dailyStats.worstTrade || pnl < dailyStats.worstTrade) {
    dailyStats.worstTrade = pnl;
  }

  console.log('[AutoTrader] Position closed:', {
    asset: position.asset,
    reason,
    pnl: pnl.toFixed(2),
  });

  activePositions.delete(posId);
}

/**
 * Calculates P&L for a position
 * @private
 */
function calculatePositionPnL(position, exitPrice) {
  if (position.action === 'buy') {
    return (exitPrice - position.entryPrice) * position.quantity;
  }
  return (position.entryPrice - exitPrice) * position.quantity;
}

/**
 * Gets summary of all active positions
 * @returns {Array} Active positions with P&L
 */
export function getActivePositionSummary() {
  const positions = [];

  for (const [posId, position] of activePositions) {
    const pnl = calculatePositionPnL(position, position.currentPrice);

    positions.push({
      id: posId,
      asset: position.asset,
      quantity: position.quantity,
      entryPrice: position.entryPrice,
      currentPrice: position.currentPrice,
      pnl,
      pnlPercent: (pnl / (position.entryPrice * position.quantity)) * 100,
      entryTime: position.entryTime,
      holdDuration: Date.now() - position.entryTime,
    });
  }

  return positions;
}

// ============================================================================
// DAILY & WEEKLY OPERATIONS
// ============================================================================

/**
 * Resets daily statistics
 * @private
 */
function resetDailyStats() {
  dailyStats = {
    tradesExecuted: 0,
    totalPnL: 0,
    winCount: 0,
    lossCount: 0,
    winRate: 0,
    bestTrade: null,
    worstTrade: null,
    largestGain: 0,
    largestLoss: 0,
  };
}

/**
 * Generates end-of-day trading summary
 * @returns {Object} Daily recap with stats and positions
 */
export function runDailyRecap() {
  const recap = {
    date: new Date().toISOString().split('T')[0],
    tradesExecuted: dailyStats.tradesExecuted,
    totalPnL: dailyStats.totalPnL,
    winCount: dailyStats.winCount,
    lossCount: dailyStats.lossCount,
    winRate: `${dailyStats.winRate.toFixed(1)}%`,
    bestTrade: dailyStats.bestTrade ? `$${dailyStats.bestTrade.toFixed(2)}` : 'N/A',
    worstTrade: dailyStats.worstTrade ? `$${dailyStats.worstTrade.toFixed(2)}` : 'N/A',
    activePositions: getActivePositionSummary(),
    agentPerformance: getStubAgentPerformance(),
    riskEvents: [],
    portfolioState: {
      totalValue: 100000, // Stub
      cash: 95000, // Stub
      invested: 5000, // Stub
    },
  };

  // Persist to localStorage
  try {
    const recapsStr = localStorage.getItem('12tribes_daily_recaps') || '[]';
    const recaps = JSON.parse(recapsStr);
    recaps.push(recap);

    // Keep last 30 days
    if (recaps.length > 30) {
      recaps.shift();
    }

    localStorage.setItem('12tribes_daily_recaps', JSON.stringify(recaps));
  } catch (error) {
    console.error('[AutoTrader] Error saving daily recap:', error);
  }

  console.log('[AutoTrader] Daily recap generated:', recap);
  return recap;
}

/**
 * Gets stub agent performance (real implementation would aggregate agent accuracy)
 * @private
 */
function getStubAgentPerformance() {
  return {
    bullishAgent: { accuracy: 0.72, signals: 5 },
    bearishAgent: { accuracy: 0.68, signals: 3 },
    neutralAgent: { accuracy: 0.65, signals: 2 },
  };
}

/**
 * Generates weekly review with recalibration suggestions
 * @returns {Object} Weekly review
 */
export function runWeeklyReview() {
  const review = {
    week: new Date().toISOString().split('T')[0],
    totalTrades: 0, // Aggregate from daily recaps
    weeklyPnL: 0,
    avgWinRate: 0,
    agentAccuracyRecalibration: [
      {
        agent: 'bullish',
        currentAccuracy: 0.72,
        suggested: 0.75,
        reason: 'Trending market bias detected',
      },
    ],
    parameterAdjustments: [
      {
        param: 'positionSize',
        current: 0.05,
        suggested: 0.06,
        reason: 'Conservative Kelly scaling increased with confidence',
      },
    ],
  };

  console.log('[AutoTrader] Weekly review generated:', review);
  return review;
}

// ============================================================================
// KILL SWITCH & EMERGENCY STOP
// ============================================================================

/**
 * Triggers emergency stop - halts trading and closes all positions
 * @param {string} reason - Reason for emergency stop
 */
export async function emergencyStop(reason = 'Manual trigger') {
  console.error('[AutoTrader] EMERGENCY STOP TRIGGERED:', reason);

  killSwitchState.active = true;
  killSwitchState.reason = reason;
  killSwitchState.timestamp = Date.now();
  killSwitchState.triggered = true;

  // Stop all trading
  await stopAutoTrader();

  // Close all positions immediately
  const positionsToClose = Array.from(activePositions.keys());
  for (const posId of positionsToClose) {
    const position = activePositions.get(posId);
    await closePosition(posId, 'emergency_stop', position.currentPrice);
  }

  // Log incident
  try {
    const incidentsStr = localStorage.getItem('12tribes_incidents') || '[]';
    const incidents = JSON.parse(incidentsStr);

    incidents.push({
      timestamp: Date.now(),
      type: 'emergency_stop',
      reason,
      positionsClosed: positionsToClose.length,
    });

    localStorage.setItem('12tribes_incidents', JSON.stringify(incidents));
  } catch (error) {
    console.error('[AutoTrader] Error logging incident:', error);
  }

  // Dispatch event for external notification
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('12tribes:emergency-stop', {
        detail: {
          reason,
          timestamp: killSwitchState.timestamp,
        },
      })
    );
  }
}

/**
 * Checks if kill switch is active
 * @returns {boolean} Kill switch state
 */
export function isKillSwitchActive() {
  return killSwitchState.active;
}

/**
 * Automatic triggers for emergency stop
 * Called from external monitoring
 * @private
 */
export function checkAutoKillSwitchTriggers() {
  // Check daily loss > 5%
  if (dailyStats.totalPnL < -5000) {
    emergencyStop('Daily loss exceeded 5%');
    return true;
  }

  // Check drawdown > 15%
  const portfolioValue = 100000; // Stub
  if (dailyStats.totalPnL < portfolioValue * -0.15) {
    emergencyStop('Portfolio drawdown exceeded 15%');
    return true;
  }

  // Check if circuit breaker is open (would be called by healthMonitor)
  // if (healthMonitor.getCircuitBreakerStatus().state === 'open') {
  //   emergencyStop('Circuit breaker tripped');
  //   return true;
  // }

  return false;
}

// ============================================================================
// DEBUG & STATE EXPORT
// ============================================================================

/**
 * Gets trading engine state for debugging
 * @returns {Object} Complete state snapshot
 */
export function getAutoTraderState() {
  return {
    active: autoTradingActive,
    tickCount,
    config: autoTraderConfig,
    dailyStats,
    weeklyStats,
    activePositions: Array.from(activePositions.entries()),
    killSwitch: killSwitchState,
    tradeLog: dailyTradeLog.slice(-50),
  };
}
