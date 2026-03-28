/**
 * backtestUI.js
 * Data layer for visual backtesting interface in 12 Tribes AI platform
 *
 * Features:
 * - Strategy library with predefined strategies
 * - Parameter configuration for each strategy
 * - Backtest run management and result storage
 * - Comparison mode for multiple strategies
 * - Equity curve generation for charting
 * - Trade list formatting
 * - Statistics formatting for display
 * - Benchmark comparison (vs buy-and-hold SPY)
 * - Results persistence
 */

const STORAGE_KEYS = {
  BACKTEST_RUNS: '12tribes_backtest_runs',
  STRATEGY_LIBRARY: '12tribes_strategy_library',
  BACKTEST_RESULTS: '12tribes_backtest_results',
};

/**
 * Get default strategy library
 */
function getDefaultStrategyLibrary() {
  return [
    {
      id: 'ma_crossover',
      name: 'Moving Average Crossover',
      description: 'Buy when fast MA crosses above slow MA, sell on reverse',
      category: 'trend_following',
      parameters: [
        {
          id: 'fast_period',
          name: 'Fast MA Period',
          type: 'number',
          min: 5,
          max: 50,
          default: 10,
          step: 1,
        },
        {
          id: 'slow_period',
          name: 'Slow MA Period',
          type: 'number',
          min: 20,
          max: 200,
          default: 50,
          step: 5,
        },
        {
          id: 'position_size',
          name: 'Position Size %',
          type: 'number',
          min: 10,
          max: 100,
          default: 100,
          step: 10,
        },
      ],
    },
    {
      id: 'rsi_mean_reversion',
      name: 'RSI Mean Reversion',
      description: 'Trade oversold/overbought RSI levels',
      category: 'mean_reversion',
      parameters: [
        {
          id: 'rsi_period',
          name: 'RSI Period',
          type: 'number',
          min: 5,
          max: 30,
          default: 14,
          step: 1,
        },
        {
          id: 'oversold_level',
          name: 'Oversold Threshold',
          type: 'number',
          min: 10,
          max: 40,
          default: 30,
          step: 5,
        },
        {
          id: 'overbought_level',
          name: 'Overbought Threshold',
          type: 'number',
          min: 60,
          max: 90,
          default: 70,
          step: 5,
        },
        {
          id: 'position_size',
          name: 'Position Size %',
          type: 'number',
          min: 10,
          max: 100,
          default: 50,
          step: 10,
        },
      ],
    },
    {
      id: 'bollinger_bands',
      name: 'Bollinger Bands',
      description: 'Trade price reversions from Bollinger Band extremes',
      category: 'volatility',
      parameters: [
        {
          id: 'bb_period',
          name: 'BB Period',
          type: 'number',
          min: 10,
          max: 50,
          default: 20,
          step: 1,
        },
        {
          id: 'bb_stddev',
          name: 'Std Dev Multiple',
          type: 'number',
          min: 1,
          max: 3,
          default: 2,
          step: 0.5,
        },
        {
          id: 'position_size',
          name: 'Position Size %',
          type: 'number',
          min: 10,
          max: 100,
          default: 75,
          step: 10,
        },
      ],
    },
    {
      id: 'macd_crossover',
      name: 'MACD Crossover',
      description: 'Buy when MACD line crosses above signal line',
      category: 'momentum',
      parameters: [
        {
          id: 'fast_ema',
          name: 'Fast EMA Period',
          type: 'number',
          min: 5,
          max: 15,
          default: 12,
          step: 1,
        },
        {
          id: 'slow_ema',
          name: 'Slow EMA Period',
          type: 'number',
          min: 20,
          max: 40,
          default: 26,
          step: 1,
        },
        {
          id: 'signal_period',
          name: 'Signal Period',
          type: 'number',
          min: 5,
          max: 15,
          default: 9,
          step: 1,
        },
        {
          id: 'position_size',
          name: 'Position Size %',
          type: 'number',
          min: 10,
          max: 100,
          default: 100,
          step: 10,
        },
      ],
    },
    {
      id: 'breakout',
      name: 'Breakout Strategy',
      description: 'Trade breakouts from recent highs/lows with stop loss',
      category: 'breakout',
      parameters: [
        {
          id: 'lookback_period',
          name: 'Lookback Period',
          type: 'number',
          min: 10,
          max: 60,
          default: 20,
          step: 5,
        },
        {
          id: 'stop_loss_pct',
          name: 'Stop Loss %',
          type: 'number',
          min: 1,
          max: 10,
          default: 2,
          step: 0.5,
        },
        {
          id: 'profit_target_pct',
          name: 'Profit Target %',
          type: 'number',
          min: 2,
          max: 20,
          default: 5,
          step: 0.5,
        },
        {
          id: 'position_size',
          name: 'Position Size %',
          type: 'number',
          min: 10,
          max: 100,
          default: 75,
          step: 10,
        },
      ],
    },
  ];
}

/**
 * Get strategy library from storage
 */
function getStoredStrategyLibrary() {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.STRATEGY_LIBRARY);
    return stored ? JSON.parse(stored) : getDefaultStrategyLibrary();
  } catch (error) {
    console.error('Failed to retrieve strategy library:', error);
    return getDefaultStrategyLibrary();
  }
}

/**
 * Get all backtest runs metadata
 */
function getBacktestRuns() {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.BACKTEST_RUNS);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Failed to retrieve backtest runs:', error);
    return [];
  }
}

/**
 * Save backtest runs
 */
function saveBacktestRuns(runs) {
  try {
    localStorage.setItem(STORAGE_KEYS.BACKTEST_RUNS, JSON.stringify(runs));
  } catch (error) {
    console.error('Failed to save backtest runs:', error);
  }
}

/**
 * Get all backtest results
 */
function getBacktestResults() {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.BACKTEST_RESULTS);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error('Failed to retrieve backtest results:', error);
    return {};
  }
}

/**
 * Save backtest results
 */
function saveBacktestResults(results) {
  try {
    localStorage.setItem(STORAGE_KEYS.BACKTEST_RESULTS, JSON.stringify(results));
  } catch (error) {
    console.error('Failed to save backtest results:', error);
  }
}

/**
 * Generate unique result ID
 */
function generateResultId() {
  return `backtest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get strategy library
 * @returns {Array} All available strategies
 */
export function getStrategyLibrary() {
  return getStoredStrategyLibrary();
}

/**
 * Get strategy parameters
 * @param {string} strategyId - Strategy ID
 * @returns {Array} Parameter definitions
 */
export function getStrategyParams(strategyId) {
  const library = getStoredStrategyLibrary();
  const strategy = library.find(s => s.id === strategyId);
  return strategy ? strategy.parameters : [];
}

/**
 * Run backtest with parameters
 * @param {string} strategyId - Strategy ID
 * @param {Object} params - Parameter values
 * @param {string} symbol - Trading symbol
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Object} Formatted backtest results
 */
export function runBacktestWithParams(strategyId, params, symbol, startDate, endDate) {
  const resultId = generateResultId();
  const library = getStoredStrategyLibrary();
  const strategy = library.find(s => s.id === strategyId);

  if (!strategy) {
    return { error: 'Strategy not found' };
  }

  // Simulate backtest execution
  // In production, would call actual backtestEngine
  const mockResults = generateMockBacktestResults(
    strategyId,
    symbol,
    startDate,
    endDate,
    params
  );

  // Store results
  const results = getBacktestResults();
  results[resultId] = {
    resultId,
    strategyId,
    strategyName: strategy.name,
    symbol,
    params,
    startDate,
    endDate,
    executedAt: new Date().toISOString(),
    ...mockResults,
  };
  saveBacktestResults(results);

  // Add to runs list
  const runs = getBacktestRuns();
  runs.push({
    resultId,
    strategyId,
    strategyName: strategy.name,
    symbol,
    startDate,
    endDate,
    executedAt: new Date().toISOString(),
  });
  saveBacktestRuns(runs);

  return results[resultId];
}

/**
 * Generate mock backtest results for demo
 */
function generateMockBacktestResults(strategyId, symbol, startDate, endDate, params) {
  const dayCount = 252; // ~1 year
  const startPrice = 100;
  let currentPrice = startPrice;
  const equityCurve = [];
  const trades = [];

  // Generate mock equity curve
  for (let i = 0; i < dayCount; i++) {
    const dailyReturn = (Math.random() - 0.48) * 0.02; // Slight upward bias
    currentPrice = currentPrice * (1 + dailyReturn);
    equityCurve.push({
      date: new Date(new Date(startDate).getTime() + i * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      value: currentPrice,
      drawdown: Math.random() * -0.15,
    });
  }

  // Generate mock trades
  for (let i = 0; i < Math.floor(Math.random() * 20) + 10; i++) {
    const entryIndex = Math.floor(Math.random() * (dayCount - 10));
    const exitIndex = entryIndex + Math.floor(Math.random() * 10) + 5;
    const entryPrice = equityCurve[entryIndex].value;
    const exitPrice = equityCurve[Math.min(exitIndex, dayCount - 1)].value;
    const pnl = exitPrice - entryPrice;
    const pnlPct = (pnl / entryPrice) * 100;

    trades.push({
      tradeId: `trade_${i}`,
      entryDate: equityCurve[entryIndex].date,
      exitDate: equityCurve[Math.min(exitIndex, dayCount - 1)].date,
      entryPrice,
      exitPrice,
      quantity: 100,
      pnl,
      pnlPct,
      side: Math.random() > 0.5 ? 'long' : 'short',
    });
  }

  const finalPrice = equityCurve[equityCurve.length - 1].value;
  const totalReturn = ((finalPrice - startPrice) / startPrice) * 100;
  const winningTrades = trades.filter(t => t.pnl > 0).length;
  const winRate = trades.length > 0 ? (winningTrades / trades.length) * 100 : 0;

  return {
    equityCurve,
    trades,
    statistics: {
      totalReturn,
      totalTrades: trades.length,
      winningTrades,
      losingTrades: trades.length - winningTrades,
      winRate,
      avgWin: trades.filter(t => t.pnl > 0).length > 0
        ? trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0) /
          trades.filter(t => t.pnl > 0).length
        : 0,
      avgLoss: trades.filter(t => t.pnl < 0).length > 0
        ? trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0) /
          trades.filter(t => t.pnl < 0).length
        : 0,
      maxDrawdown: Math.min(...equityCurve.map(e => e.drawdown)),
      profitFactor: calculateProfitFactor(trades),
      sharpeRatio: calculateSharpeRatio(equityCurve),
      sortino: calculateSortino(equityCurve),
    },
  };
}

/**
 * Calculate profit factor
 */
function calculateProfitFactor(trades) {
  const gains = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
  const losses = Math.abs(
    trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0)
  );
  return losses > 0 ? gains / losses : 0;
}

/**
 * Calculate Sharpe ratio
 */
function calculateSharpeRatio(equityCurve) {
  const returns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const ret = (equityCurve[i].value - equityCurve[i - 1].value) / equityCurve[i - 1].value;
    returns.push(ret);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  return stdDev > 0 ? mean / stdDev * Math.sqrt(252) : 0;
}

/**
 * Calculate Sortino ratio
 */
function calculateSortino(equityCurve) {
  const returns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const ret = (equityCurve[i].value - equityCurve[i - 1].value) / equityCurve[i - 1].value;
    returns.push(ret);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const downside = returns.filter(r => r < 0);
  const downsideVariance =
    downside.length > 0
      ? downside.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downside.length
      : 0;
  const downsideStdDev = Math.sqrt(downsideVariance);
  return downsideStdDev > 0 ? mean / downsideStdDev * Math.sqrt(252) : 0;
}

/**
 * Get equity curve for charting
 * @param {string} resultId - Result ID
 * @returns {Array} Chart-ready data
 */
export function getBacktestEquityCurve(resultId) {
  const results = getBacktestResults();
  const result = results[resultId];
  return result ? result.equityCurve : [];
}

/**
 * Get trade list
 * @param {string} resultId - Result ID
 * @returns {Array} Individual trades
 */
export function getBacktestTradeList(resultId) {
  const results = getBacktestResults();
  const result = results[resultId];
  return result ? result.trades : [];
}

/**
 * Get formatted statistics
 * @param {string} resultId - Result ID
 * @returns {Object} Formatted stats for display
 */
export function getBacktestStats(resultId) {
  const results = getBacktestResults();
  const result = results[resultId];

  if (!result || !result.statistics) {
    return {};
  }

  const stats = result.statistics;
  return {
    'Total Return': `${stats.totalReturn.toFixed(2)}%`,
    'Win Rate': `${stats.winRate.toFixed(2)}%`,
    'Profit Factor': stats.profitFactor.toFixed(2),
    'Sharpe Ratio': stats.sharpeRatio.toFixed(2),
    'Sortino Ratio': stats.sortino.toFixed(2),
    'Max Drawdown': `${(stats.maxDrawdown * 100).toFixed(2)}%`,
    'Total Trades': stats.totalTrades,
    'Winning Trades': stats.winningTrades,
    'Avg Win': `$${stats.avgWin.toFixed(2)}`,
    'Avg Loss': `$${stats.avgLoss.toFixed(2)}`,
  };
}

/**
 * Compare strategies
 * @param {Array} resultIds - Result IDs to compare
 * @returns {Object} Side-by-side comparison
 */
export function compareStrategies(resultIds) {
  const results = getBacktestResults();
  const comparison = {};

  resultIds.forEach(resultId => {
    const result = results[resultId];
    if (result) {
      comparison[resultId] = {
        strategy: result.strategyName,
        symbol: result.symbol,
        stats: result.statistics,
        equityCurve: result.equityCurve,
      };
    }
  });

  return comparison;
}

/**
 * Get benchmark comparison (vs SPY buy-and-hold)
 * @param {string} resultId - Result ID
 * @returns {Object} Strategy vs benchmark comparison
 */
export function getBenchmarkComparison(resultId) {
  const results = getBacktestResults();
  const result = results[resultId];

  if (!result) {
    return {};
  }

  // Generate mock SPY benchmark data
  const spyReturn = result.statistics.totalReturn * 0.7; // Assume SPY performs 70% as well
  const spySharpe = result.statistics.sharpeRatio * 0.8;

  return {
    strategy: {
      name: result.strategyName,
      return: result.statistics.totalReturn,
      sharpe: result.statistics.sharpeRatio,
      maxDrawdown: result.statistics.maxDrawdown,
      winRate: result.statistics.winRate,
    },
    benchmark: {
      name: 'SPY Buy & Hold',
      return: spyReturn,
      sharpe: spySharpe,
      maxDrawdown: Math.random() * -0.2 - 0.08,
      winRate: 60,
    },
    outperformance: result.statistics.totalReturn - spyReturn,
  };
}

/**
 * Get all saved backtests
 * @returns {Array} Metadata of all saved runs
 */
export function getSavedBacktests() {
  return getBacktestRuns();
}

/**
 * Delete backtest result
 * @param {string} resultId - Result ID
 */
export function deleteBacktest(resultId) {
  const results = getBacktestResults();
  delete results[resultId];
  saveBacktestResults(results);

  const runs = getBacktestRuns();
  const filtered = runs.filter(r => r.resultId !== resultId);
  saveBacktestRuns(filtered);
}

/**
 * Initialize strategy library in storage if empty
 */
export function initializeStrategyLibrary() {
  const library = getStoredStrategyLibrary();
  if (library.length === 0) {
    localStorage.setItem(STORAGE_KEYS.STRATEGY_LIBRARY, JSON.stringify(getDefaultStrategyLibrary()));
  }
}
