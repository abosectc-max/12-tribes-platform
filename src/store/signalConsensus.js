/**
 * Signal Consensus Engine v1.0
 * 12 Tribes AI Trading Platform
 *
 * Manages consensus-based trading signals from 7 specialized agents:
 * Viper, Oracle, Spectre, Sentinel, Phoenix, Titan, and Debugger
 *
 * Features:
 * - Multi-agent consensus scoring with dynamic weighting
 * - Auto-execute rules with conflict resolution
 * - Performance tracking and regime-based agent allocation
 * - Comprehensive signal history and analytics
 * - Platform error logging and health monitoring (Debugger agent)
 */

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const AGENT_IDS = ['viper', 'oracle', 'spectre', 'sentinel', 'phoenix', 'titan', 'debugger'];

const MARKET_REGIMES = {
  bull: 'bull',
  bear: 'bear',
  neutral: 'neutral',
  crisis: 'crisis'
};

const SIGNAL_DIRECTIONS = {
  LONG: 'LONG',
  SHORT: 'SHORT',
  NEUTRAL: 'NEUTRAL'
};

const URGENCY_LEVELS = {
  low: 'low',
  normal: 'normal',
  elevated: 'elevated',
  critical: 'critical'
};

const STORAGE_KEYS = {
  agentAccuracy: '12tribes_agent_accuracy',
  signalHistory: '12tribes_signal_history',
  autoExecuteRules: '12tribes_auto_execute_rules',
  errorLog: '12tribes_error_log',
  tradeOutcomes: '12tribes_trade_outcomes'
};

const DEFAULT_AUTO_EXECUTE_RULES = {
  minConsensusScore: 75,
  minAgentAgreement: 4,
  maxPositionSize: 0.05,
  requireSentinel: true,
  cooldownMinutes: 15
};

const ERROR_PATTERNS = {
  nullAccess: 'nullAccess',
  apiTimeout: 'apiTimeout',
  websocketDisconnect: 'websocketDisconnect',
  renderCrash: 'renderCrash',
  stateCorruption: 'stateCorruption'
};

// ============================================================================
// INTERNAL STATE
// ============================================================================

let signalQueue = [];
let lastTradeTimestamp = {};
let currentMarketRegime = MARKET_REGIMES.neutral;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Safe JSON parse with fallback
 * @param {string} json
 * @param {*} fallback
 * @returns {*}
 */
function safeParse(json, fallback = null) {
  try {
    return JSON.parse(json);
  } catch (e) {
    return fallback;
  }
}

/**
 * Get current timestamp
 * @returns {number}
 */
function now() {
  return Date.now();
}

/**
 * Validate signal object structure
 * @param {Object} signal
 * @returns {boolean}
 */
function isValidSignal(signal) {
  if (!signal || typeof signal !== 'object') return false;
  if (!AGENT_IDS.includes(signal.agentId)) return false;
  if (!signal.symbol || typeof signal.symbol !== 'string') return false;
  if (!Object.values(SIGNAL_DIRECTIONS).includes(signal.direction)) return false;
  if (typeof signal.conviction !== 'number' || signal.conviction < 0 || signal.conviction > 1) return false;
  if (!Object.values(URGENCY_LEVELS).includes(signal.urgency)) return false;
  return true;
}

/**
 * Calculate recent accuracy for an agent
 * @param {string} agentId
 * @returns {number} 0-1
 */
function getRecentAccuracy(agentId) {
  try {
    const accuracyData = safeParse(localStorage.getItem(STORAGE_KEYS.agentAccuracy), {});
    const agentStats = accuracyData[agentId] || { wins: 0, losses: 0, total: 0 };

    if (agentStats.total === 0) return 0.5; // Neutral default
    return Math.min(1, agentStats.wins / agentStats.total);
  } catch (e) {
    reportError(e, { context: 'getRecentAccuracy', agentId });
    return 0.5;
  }
}

/**
 * Get regime-specific weight for an agent
 * @param {string} agentId
 * @returns {number}
 */
function getRegimeWeight(agentId) {
  try {
    const accuracyData = safeParse(localStorage.getItem(STORAGE_KEYS.agentAccuracy), {});
    const agentStats = accuracyData[agentId] || {};
    const regimePerf = agentStats.regimePerformance || {};

    const regimeScore = regimePerf[currentMarketRegime] || 0.5;
    return Math.max(0.3, Math.min(1.2, regimeScore)); // Clamp between 0.3 and 1.2
  } catch (e) {
    reportError(e, { context: 'getRegimeWeight', agentId });
    return 1.0;
  }
}

/**
 * Calculate weighted consensus score
 * @param {Object[]} signals - array of signals for a symbol
 * @returns {Object}
 */
function calculateConsensusScore(signals) {
  if (!signals || signals.length === 0) {
    return {
      direction: SIGNAL_DIRECTIONS.NEUTRAL,
      score: 0,
      confidence: 0,
      agentVotes: [],
      reasoning: 'No signals received',
      recommendation: 'HOLD'
    };
  }

  try {
    const votes = signals.map(signal => ({
      agentId: signal.agentId,
      direction: signal.direction,
      weight: signal.conviction * getRecentAccuracy(signal.agentId) * getRegimeWeight(signal.agentId),
      conviction: signal.conviction,
      urgency: signal.urgency
    }));

    const longWeight = votes
      .filter(v => v.direction === SIGNAL_DIRECTIONS.LONG)
      .reduce((sum, v) => sum + v.weight, 0);

    const shortWeight = votes
      .filter(v => v.direction === SIGNAL_DIRECTIONS.SHORT)
      .reduce((sum, v) => sum + v.weight, 0);

    const totalWeight = longWeight + shortWeight || 1;
    const longScore = (longWeight / totalWeight) * 100;
    const shortScore = (shortWeight / totalWeight) * 100;

    let direction = SIGNAL_DIRECTIONS.NEUTRAL;
    let score = 0;

    if (Math.abs(longScore - shortScore) < 15) {
      direction = SIGNAL_DIRECTIONS.NEUTRAL;
      score = 50;
    } else if (longScore > shortScore) {
      direction = SIGNAL_DIRECTIONS.LONG;
      score = longScore;
    } else {
      direction = SIGNAL_DIRECTIONS.SHORT;
      score = shortScore;
    }

    const confidence = Math.min(100, (Math.max(longScore, shortScore) / 100) * 100);
    const agentAgreement = votes.filter(v => v.direction === direction).length;
    const totalAgents = votes.length;

    return {
      direction,
      score: Math.round(score),
      confidence: Math.round(confidence),
      agentVotes: votes,
      agentAgreement,
      totalAgents,
      recommendation: score >= 75 ? 'BUY/SHORT' : score >= 50 ? 'HOLD' : 'AVOID',
      timestamp: now()
    };
  } catch (e) {
    reportError(e, { context: 'calculateConsensusScore', signalCount: signals.length });
    return {
      direction: SIGNAL_DIRECTIONS.NEUTRAL,
      score: 0,
      confidence: 0,
      agentVotes: [],
      recommendation: 'HOLD',
      error: true
    };
  }
}

// ============================================================================
// SIGNAL SUBMISSION & CONSENSUS
// ============================================================================

/**
 * Submit a signal from an agent
 * @param {Object} signal
 * @returns {boolean} Success
 */
export function submitSignal(signal) {
  if (!isValidSignal(signal)) {
    reportError(new Error('Invalid signal structure'), { signal });
    return false;
  }

  try {
    const enrichedSignal = {
      ...signal,
      timestamp: signal.timestamp || now(),
      metadata: signal.metadata || {}
    };

    signalQueue.push(enrichedSignal);

    // Keep only last 100 signals in queue
    if (signalQueue.length > 100) {
      signalQueue = signalQueue.slice(-100);
    }

    // Persist to localStorage
    const history = safeParse(localStorage.getItem(STORAGE_KEYS.signalHistory), []);
    history.push(enrichedSignal);

    // Keep only last 500 signals
    if (history.length > 500) {
      history.splice(0, history.length - 500);
    }

    localStorage.setItem(STORAGE_KEYS.signalHistory, JSON.stringify(history));

    return true;
  } catch (e) {
    reportError(e, { context: 'submitSignal', signal });
    return false;
  }
}

/**
 * Get consensus for a specific symbol
 * @param {string} symbol
 * @returns {Object}
 */
export function getConsensus(symbol) {
  if (!symbol || typeof symbol !== 'string') {
    reportError(new Error('Invalid symbol'), { symbol });
    return null;
  }

  try {
    const symbolSignals = signalQueue.filter(s => s.symbol === symbol);
    const consensus = calculateConsensusScore(symbolSignals);

    // Check Sentinel veto
    const sentinelSignal = symbolSignals.find(s => s.agentId === 'sentinel');
    if (sentinelSignal && sentinelSignal.direction === SIGNAL_DIRECTIONS.NEUTRAL) {
      consensus.sentinelVeto = true;
      consensus.recommendation = 'BLOCKED_BY_SENTINEL';
    }

    return consensus;
  } catch (e) {
    reportError(e, { context: 'getConsensus', symbol });
    return null;
  }
}

/**
 * Get consensus across all active symbols
 * @returns {Object}
 */
export function getConsensusAll() {
  try {
    const symbols = [...new Set(signalQueue.map(s => s.symbol))];
    const consensusMap = {};

    symbols.forEach(symbol => {
      consensusMap[symbol] = getConsensus(symbol);
    });

    return consensusMap;
  } catch (e) {
    reportError(e, { context: 'getConsensusAll' });
    return {};
  }
}

// ============================================================================
// AUTO-EXECUTE RULES
// ============================================================================

/**
 * Set auto-execute trading rules
 * @param {Object} rules
 * @returns {boolean}
 */
export function setAutoExecuteRules(rules) {
  try {
    const mergedRules = {
      ...DEFAULT_AUTO_EXECUTE_RULES,
      ...rules
    };

    // Validate rules
    if (mergedRules.minConsensusScore < 0 || mergedRules.minConsensusScore > 100) {
      throw new Error('minConsensusScore must be 0-100');
    }
    if (mergedRules.minAgentAgreement < 1 || mergedRules.minAgentAgreement > 7) {
      throw new Error('minAgentAgreement must be 1-7');
    }
    if (mergedRules.maxPositionSize <= 0 || mergedRules.maxPositionSize > 1) {
      throw new Error('maxPositionSize must be 0-1');
    }

    localStorage.setItem(STORAGE_KEYS.autoExecuteRules, JSON.stringify(mergedRules));
    return true;
  } catch (e) {
    reportError(e, { context: 'setAutoExecuteRules', rules });
    return false;
  }
}

/**
 * Get current auto-execute rules
 * @returns {Object}
 */
export function getAutoExecuteRules() {
  try {
    return safeParse(
      localStorage.getItem(STORAGE_KEYS.autoExecuteRules),
      DEFAULT_AUTO_EXECUTE_RULES
    );
  } catch (e) {
    reportError(e, { context: 'getAutoExecuteRules' });
    return DEFAULT_AUTO_EXECUTE_RULES;
  }
}

/**
 * Evaluate if a trade should auto-execute
 * @param {Object} consensus
 * @returns {Object}
 */
export function evaluateAutoExecute(consensus) {
  if (!consensus) {
    return {
      shouldExecute: false,
      reason: 'No consensus available'
    };
  }

  try {
    const rules = getAutoExecuteRules();

    // Check cooldown
    const lastTrade = lastTradeTimestamp[consensus.symbol] || 0;
    const timeSinceLastTrade = (now() - lastTrade) / (1000 * 60); // minutes

    if (timeSinceLastTrade < rules.cooldownMinutes) {
      return {
        shouldExecute: false,
        reason: `Cooldown active: ${Math.ceil(rules.cooldownMinutes - timeSinceLastTrade)}m remaining`
      };
    }

    // Check minimum score
    if (consensus.score < rules.minConsensusScore) {
      return {
        shouldExecute: false,
        reason: `Score ${consensus.score} < minimum ${rules.minConsensusScore}`
      };
    }

    // Check agent agreement
    if (consensus.agentAgreement < rules.minAgentAgreement) {
      return {
        shouldExecute: false,
        reason: `Only ${consensus.agentAgreement}/${consensus.totalAgents} agents agree (min: ${rules.minAgentAgreement})`
      };
    }

    // Check Sentinel veto
    if (rules.requireSentinel && consensus.sentinelVeto) {
      return {
        shouldExecute: false,
        reason: 'Sentinel veto active'
      };
    }

    // Check direction
    if (consensus.direction === SIGNAL_DIRECTIONS.NEUTRAL) {
      return {
        shouldExecute: false,
        reason: 'No clear direction (NEUTRAL)'
      };
    }

    return {
      shouldExecute: true,
      reason: 'All conditions met',
      direction: consensus.direction,
      position: rules.maxPositionSize
    };
  } catch (e) {
    reportError(e, { context: 'evaluateAutoExecute', consensus });
    return {
      shouldExecute: false,
      reason: 'Error evaluating auto-execute'
    };
  }
}

// ============================================================================
// TRADE OUTCOME & PERFORMANCE TRACKING
// ============================================================================

/**
 * Record trade outcome to update agent accuracy
 * @param {string} agentId
 * @param {string} symbol
 * @param {number} pnl - Profit/loss in dollars or percentage
 * @param {number} holdTime - Time held in minutes
 * @returns {boolean}
 */
export function recordTradeOutcome(agentId, symbol, pnl, holdTime) {
  try {
    if (!AGENT_IDS.includes(agentId)) {
      throw new Error(`Invalid agent: ${agentId}`);
    }

    const accuracyData = safeParse(localStorage.getItem(STORAGE_KEYS.agentAccuracy), {});

    if (!accuracyData[agentId]) {
      accuracyData[agentId] = {
        wins: 0,
        losses: 0,
        total: 0,
        totalPnL: 0,
        regimePerformance: {}
      };
    }

    const agent = accuracyData[agentId];
    agent.total += 1;
    agent.totalPnL += pnl;

    if (pnl > 0) {
      agent.wins += 1;
    } else if (pnl < 0) {
      agent.losses += 1;
    }

    // Track regime performance
    const regime = currentMarketRegime;
    if (!agent.regimePerformance[regime]) {
      agent.regimePerformance[regime] = 0;
    }
    agent.regimePerformance[regime] = getRecentAccuracy(agentId); // Update regime score

    // Also track outcomes separately
    const outcomes = safeParse(localStorage.getItem(STORAGE_KEYS.tradeOutcomes), []);
    outcomes.push({
      agentId,
      symbol,
      pnl,
      holdTime,
      timestamp: now(),
      regime
    });

    // Keep last 1000 outcomes
    if (outcomes.length > 1000) {
      outcomes.splice(0, outcomes.length - 1000);
    }

    localStorage.setItem(STORAGE_KEYS.agentAccuracy, JSON.stringify(accuracyData));
    localStorage.setItem(STORAGE_KEYS.tradeOutcomes, JSON.stringify(outcomes));

    return true;
  } catch (e) {
    reportError(e, { context: 'recordTradeOutcome', agentId, symbol, pnl });
    return false;
  }
}

/**
 * Get agent leaderboard ranked by Sharpe, win rate, profit factor
 * @returns {Object[]}
 */
export function getAgentLeaderboard() {
  try {
    const accuracyData = safeParse(localStorage.getItem(STORAGE_KEYS.agentAccuracy), {});

    const leaderboard = Object.entries(accuracyData).map(([agentId, stats]) => {
      const winRate = stats.total > 0 ? stats.wins / stats.total : 0;
      const avgPnL = stats.total > 0 ? stats.totalPnL / stats.total : 0;
      const profitFactor = stats.losses > 0 ? Math.abs(stats.wins > 0 ? stats.totalPnL / (stats.losses * Math.abs(avgPnL)) : 0) : 0;
      const sharpe = avgPnL > 0 ? avgPnL / (Math.sqrt(Math.max(1, stats.total)) * 0.01) : 0;

      return {
        agentId,
        totalTrades: stats.total,
        winRate: Math.round(winRate * 100),
        profitFactor: Math.round(profitFactor * 100) / 100,
        sharpe: Math.round(sharpe * 100) / 100,
        totalPnL: Math.round(stats.totalPnL * 100) / 100
      };
    });

    // Sort by Sharpe ratio
    leaderboard.sort((a, b) => b.sharpe - a.sharpe);

    return leaderboard;
  } catch (e) {
    reportError(e, { context: 'getAgentLeaderboard' });
    return [];
  }
}

/**
 * Get agent performance in each market regime
 * @param {string} agentId
 * @returns {Object}
 */
export function getAgentRegimePerformance(agentId) {
  try {
    if (!AGENT_IDS.includes(agentId)) {
      throw new Error(`Invalid agent: ${agentId}`);
    }

    const outcomes = safeParse(localStorage.getItem(STORAGE_KEYS.tradeOutcomes), []);
    const agentOutcomes = outcomes.filter(o => o.agentId === agentId);

    const regimeStats = {};
    Object.values(MARKET_REGIMES).forEach(regime => {
      const regimeOutcomes = agentOutcomes.filter(o => o.regime === regime);
      const winCount = regimeOutcomes.filter(o => o.pnl > 0).length;
      const totalPnL = regimeOutcomes.reduce((sum, o) => sum + o.pnl, 0);

      regimeStats[regime] = {
        trades: regimeOutcomes.length,
        winRate: regimeOutcomes.length > 0 ? Math.round((winCount / regimeOutcomes.length) * 100) : 0,
        totalPnL: Math.round(totalPnL * 100) / 100
      };
    });

    return regimeStats;
  } catch (e) {
    reportError(e, { context: 'getAgentRegimePerformance', agentId });
    return {};
  }
}

// ============================================================================
// SIGNAL HISTORY & ANALYTICS
// ============================================================================

/**
 * Query signal history with filters
 * @param {Object} filters - { agentId, symbol, direction, startTime, endTime }
 * @returns {Object[]}
 */
export function getSignalHistory(filters = {}) {
  try {
    let history = safeParse(localStorage.getItem(STORAGE_KEYS.signalHistory), []);

    if (filters.agentId) {
      history = history.filter(s => s.agentId === filters.agentId);
    }
    if (filters.symbol) {
      history = history.filter(s => s.symbol === filters.symbol);
    }
    if (filters.direction) {
      history = history.filter(s => s.direction === filters.direction);
    }
    if (filters.startTime) {
      history = history.filter(s => s.timestamp >= filters.startTime);
    }
    if (filters.endTime) {
      history = history.filter(s => s.timestamp <= filters.endTime);
    }

    return history;
  } catch (e) {
    reportError(e, { context: 'getSignalHistory', filters });
    return [];
  }
}

/**
 * Get consensus accuracy from trade outcomes
 * @returns {Object}
 */
export function getConsensusAccuracy() {
  try {
    const outcomes = safeParse(localStorage.getItem(STORAGE_KEYS.tradeOutcomes), []);

    if (outcomes.length === 0) {
      return { accuracy: 0, profitableTradesCount: 0, totalTradesCount: 0 };
    }

    const profitableCount = outcomes.filter(o => o.pnl > 0).length;
    const accuracy = profitableCount / outcomes.length;
    const totalPnL = outcomes.reduce((sum, o) => sum + o.pnl, 0);

    return {
      accuracy: Math.round(accuracy * 100),
      profitableTradesCount: profitableCount,
      totalTradesCount: outcomes.length,
      totalPnL: Math.round(totalPnL * 100) / 100,
      avgPnL: Math.round((totalPnL / outcomes.length) * 100) / 100
    };
  } catch (e) {
    reportError(e, { context: 'getConsensusAccuracy' });
    return { accuracy: 0, profitableTradesCount: 0, totalTradesCount: 0 };
  }
}

/**
 * Get correlation matrix between agent signals
 * @returns {Object}
 */
export function getAgentCorrelation() {
  try {
    const history = safeParse(localStorage.getItem(STORAGE_KEYS.signalHistory), []);

    if (history.length < 10) {
      return { message: 'Insufficient signal history for correlation analysis' };
    }

    const correlationMatrix = {};

    AGENT_IDS.forEach(agentA => {
      correlationMatrix[agentA] = {};
      AGENT_IDS.forEach(agentB => {
        if (agentA === agentB) {
          correlationMatrix[agentA][agentB] = 1.0;
        } else {
          // Simple correlation: count matching signals
          const signalsA = history.filter(s => s.agentId === agentA);
          const signalsB = history.filter(s => s.agentId === agentB);

          const commonSymbols = new Set([
            ...signalsA.map(s => s.symbol),
            ...signalsB.map(s => s.symbol)
          ]);

          let matches = 0;
          commonSymbols.forEach(symbol => {
            const lastA = signalsA.reverse().find(s => s.symbol === symbol);
            const lastB = signalsB.reverse().find(s => s.symbol === symbol);

            if (lastA && lastB && lastA.direction === lastB.direction) {
              matches++;
            }
          });

          const correlation = commonSymbols.size > 0 ? matches / commonSymbols.size : 0;
          correlationMatrix[agentA][agentB] = Math.round(correlation * 100) / 100;
        }
      });
    });

    return correlationMatrix;
  } catch (e) {
    reportError(e, { context: 'getAgentCorrelation' });
    return {};
  }
}

// ============================================================================
// DEBUGGER AGENT: ERROR LOGGING & HEALTH MONITORING
// ============================================================================

/**
 * Report platform error (Debugger agent integration)
 * @param {Error} error
 * @param {Object} context
 * @returns {void}
 */
export function reportError(error, context = {}) {
  try {
    const errorLog = safeParse(localStorage.getItem(STORAGE_KEYS.errorLog), []);

    const errorEntry = {
      timestamp: now(),
      message: error?.message || String(error),
      stack: error?.stack || '',
      context,
      pattern: classifyErrorPattern(error)
    };

    errorLog.push(errorEntry);

    // Keep last 500 errors
    if (errorLog.length > 500) {
      errorLog.splice(0, errorLog.length - 500);
    }

    localStorage.setItem(STORAGE_KEYS.errorLog, JSON.stringify(errorLog));

    // Log to console in development
    if (typeof console !== 'undefined') {
      console.error('[12Tribes Error]', errorEntry);
    }
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.error('[12Tribes Critical Error]', e);
    }
  }
}

/**
 * Classify error into known patterns
 * @param {Error} error
 * @returns {string}
 */
function classifyErrorPattern(error) {
  const msg = (error?.message || '').toLowerCase();

  if (msg.includes('null') || msg.includes('undefined') || msg.includes('cannot read')) {
    return ERROR_PATTERNS.nullAccess;
  }
  if (msg.includes('timeout') || msg.includes('abort')) {
    return ERROR_PATTERNS.apiTimeout;
  }
  if (msg.includes('websocket') || msg.includes('disconnect')) {
    return ERROR_PATTERNS.websocketDisconnect;
  }
  if (msg.includes('render') || msg.includes('react')) {
    return ERROR_PATTERNS.renderCrash;
  }
  if (msg.includes('state') || msg.includes('corrupt')) {
    return ERROR_PATTERNS.stateCorruption;
  }

  return 'unknown';
}

/**
 * Get error log with optional filters
 * @param {Object} filters - { pattern, startTime, endTime, limit }
 * @returns {Object[]}
 */
export function getErrorLog(filters = {}) {
  try {
    let errorLog = safeParse(localStorage.getItem(STORAGE_KEYS.errorLog), []);

    if (filters.pattern) {
      errorLog = errorLog.filter(e => e.pattern === filters.pattern);
    }
    if (filters.startTime) {
      errorLog = errorLog.filter(e => e.timestamp >= filters.startTime);
    }
    if (filters.endTime) {
      errorLog = errorLog.filter(e => e.timestamp <= filters.endTime);
    }

    const limit = filters.limit || 100;
    return errorLog.slice(-limit);
  } catch (e) {
    console.error('[12Tribes Critical Error]', e);
    return [];
  }
}

/**
 * Get platform health score (0-100)
 * @returns {number}
 */
export function getHealthScore() {
  try {
    const errorLog = safeParse(localStorage.getItem(STORAGE_KEYS.errorLog), []);
    const recentErrors = errorLog.filter(e => e.timestamp > now() - (15 * 60 * 1000)); // Last 15 min

    const errorCount = recentErrors.length;
    const errorPenalty = Math.min(50, errorCount * 5); // 5 points per error, max 50

    const signalQueueHealth = signalQueue.length > 0 ? 25 : 0; // Signals flowing = +25
    const storageHealth = localStorage.length > 0 ? 25 : 0; // Storage working = +25
    const baseHealth = 100 - errorPenalty;

    return Math.max(0, baseHealth);
  } catch (e) {
    console.error('[12Tribes Health Check Error]', e);
    return 50;
  }
}

/**
 * Suggest fix for known error patterns
 * @param {string} errorType
 * @returns {string}
 */
export function suggestFix(errorType) {
  const fixes = {
    [ERROR_PATTERNS.nullAccess]: 'Add null checks before accessing properties. Use optional chaining (?.) or nullish coalescing (??)',
    [ERROR_PATTERNS.apiTimeout]: 'Increase timeout threshold, implement exponential backoff, or check network connectivity',
    [ERROR_PATTERNS.websocketDisconnect]: 'Implement automatic reconnection with incremental backoff. Check firewall/proxy settings',
    [ERROR_PATTERNS.renderCrash]: 'Check React component lifecycle. Ensure state updates are immutable. Use error boundaries',
    [ERROR_PATTERNS.stateCorruption]: 'Verify state mutations are not happening outside reducer. Check localStorage synchronization'
  };

  return fixes[errorType] || 'Unknown error pattern. Check error log for details.';
}

// ============================================================================
// MARKET REGIME MANAGEMENT
// ============================================================================

/**
 * Set current market regime
 * @param {string} regime
 * @returns {boolean}
 */
export function setMarketRegime(regime) {
  if (!Object.values(MARKET_REGIMES).includes(regime)) {
    reportError(new Error(`Invalid regime: ${regime}`), { context: 'setMarketRegime' });
    return false;
  }

  currentMarketRegime = regime;
  return true;
}

/**
 * Get current market regime
 * @returns {string}
 */
export function getMarketRegime() {
  return currentMarketRegime;
}

// ============================================================================
// CLEARANCE & RESET (TESTING & MAINTENANCE)
// ============================================================================

/**
 * Clear all signal history and performance data (WARNING: destructive)
 * @param {boolean} confirm - Must explicitly pass true
 * @returns {boolean}
 */
export function clearAllData(confirm = false) {
  if (!confirm) {
    reportError(new Error('Destructive operation not confirmed'), { context: 'clearAllData' });
    return false;
  }

  try {
    signalQueue = [];
    lastTradeTimestamp = {};
    localStorage.removeItem(STORAGE_KEYS.signalHistory);
    localStorage.removeItem(STORAGE_KEYS.agentAccuracy);
    localStorage.removeItem(STORAGE_KEYS.errorLog);
    localStorage.removeItem(STORAGE_KEYS.tradeOutcomes);
    return true;
  } catch (e) {
    reportError(e, { context: 'clearAllData' });
    return false;
  }
}

// ============================================================================
// MODULE INITIALIZATION
// ============================================================================

/**
 * Initialize Signal Consensus Engine
 * @returns {void}
 */
export function initialize() {
  try {
    // Load signal history from storage
    const history = safeParse(localStorage.getItem(STORAGE_KEYS.signalHistory), []);
    signalQueue = history.slice(-100); // Load last 100 signals

    // Log initialization
    reportError(
      new Error('Engine initialized'),
      { context: 'initialize', signalsLoaded: signalQueue.length }
    );
  } catch (e) {
    reportError(e, { context: 'initialize' });
  }
}

/**
 * Get engine statistics for monitoring
 * @returns {Object}
 */
export function getEngineStats() {
  try {
    const history = safeParse(localStorage.getItem(STORAGE_KEYS.signalHistory), []);
    const errors = safeParse(localStorage.getItem(STORAGE_KEYS.errorLog), []);
    const outcomes = safeParse(localStorage.getItem(STORAGE_KEYS.tradeOutcomes), []);

    return {
      signalsInQueue: signalQueue.length,
      totalSignalsRecorded: history.length,
      totalErrorsLogged: errors.length,
      totalTradeOutcomes: outcomes.length,
      marketRegime: currentMarketRegime,
      healthScore: getHealthScore(),
      agentCount: AGENT_IDS.length,
      timestamp: now()
    };
  } catch (e) {
    reportError(e, { context: 'getEngineStats' });
    return null;
  }
}

// Auto-initialize on module load
if (typeof window !== 'undefined') {
  initialize();
}
