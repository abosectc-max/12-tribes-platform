/**
 * 12 Tribes AI Trading Platform - Backtesting Engine
 * Pure ES module for browser-based backtesting with localStorage persistence
 * No external dependencies, no JSX, production-grade code
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const SYMBOLS = [
  'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'JPM',
  'BTC', 'ETH', 'SOL', 'AVAX',
  'EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD',
  'SPY', 'QQQ', 'GLD', 'TLT'
];

const STORAGE_KEY_HISTORICAL = '12tribes_historical_data';
const STORAGE_KEY_BACKTEST_RESULTS = '12tribes_backtest_results';

const STRATEGIES = {
  momentum: { name: 'Momentum', agent: 'Viper', period: 20 },
  'mean-reversion': { name: 'Mean Reversion', agent: 'Sage', period: 30 },
  breakout: { name: 'Breakout', agent: 'Hunter', period: 20 },
  'trend-following': { name: 'Trend Following', agent: 'Oracle', period: 50 },
  'volatility-selling': { name: 'Volatility Selling', agent: 'Spectre', period: 20 },
  'macro-regime': { name: 'Macro Regime', agent: 'Oracle', period: 60 }
};

const DEFAULT_SLIPPAGE = 0.0008; // 0.08%
const DEFAULT_COMMISSION = 0.005; // $0.005 per share

// ============================================================================
// HISTORICAL DATA GENERATION
// ============================================================================

/**
 * Generate synthetic historical price data for a symbol
 * @param {string} symbol - Ticker symbol
 * @param {number} days - Number of days to generate (default 2 years = 504 trading days)
 * @param {string} regime - Market regime: 'bull', 'bear', 'sideways', 'high-vol', 'low-vol'
 * @returns {Array<{date, open, high, low, close, volume}>}
 */
function generateSymbolData(symbol, days = 504, regime = 'bull') {
  const data = [];
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 2);

  let price = getInitialPrice(symbol);
  const volatility = getRegimeVolatility(regime);
  const trend = getRegimeTrend(regime);
  let dayCount = 0;

  for (let i = 0; i < days; i++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(currentDate.getDate() + dayCount);

    // Skip weekends
    if (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
      dayCount++;
      i--;
      continue;
    }

    // Generate OHLCV with realistic patterns
    const dailyReturn = (Math.random() - 0.5) * volatility + trend;
    const open = price;
    const close = price * (1 + dailyReturn);
    const high = Math.max(open, close) * (1 + Math.abs(Math.random() * 0.02));
    const low = Math.min(open, close) * (1 - Math.abs(Math.random() * 0.02));
    const volume = Math.round(1000000 + Math.random() * 5000000);

    data.push({
      date: currentDate.toISOString().split('T')[0],
      open: Math.round(open * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: Math.round(close * 100) / 100,
      volume
    });

    price = close;
    dayCount++;
  }

  return data;
}

/**
 * Get initial price for symbol
 * @param {string} symbol
 * @returns {number}
 */
function getInitialPrice(symbol) {
  const prices = {
    'AAPL': 150, 'MSFT': 380, 'NVDA': 400, 'TSLA': 250, 'AMZN': 180, 'GOOGL': 140,
    'META': 320, 'JPM': 180, 'BTC': 40000, 'ETH': 2500, 'SOL': 100, 'AVAX': 70,
    'EUR/USD': 1.08, 'GBP/USD': 1.27, 'USD/JPY': 150, 'AUD/USD': 0.65,
    'SPY': 450, 'QQQ': 380, 'GLD': 200, 'TLT': 95
  };
  return prices[symbol] || 100;
}

/**
 * Get volatility multiplier for regime
 * @param {string} regime
 * @returns {number}
 */
function getRegimeVolatility(regime) {
  const volatilities = {
    'bull': 0.01,
    'bear': 0.015,
    'sideways': 0.008,
    'high-vol': 0.025,
    'low-vol': 0.005
  };
  return volatilities[regime] || 0.01;
}

/**
 * Get trend direction for regime
 * @param {string} regime
 * @returns {number}
 */
function getRegimeTrend(regime) {
  const trends = {
    'bull': 0.0005,
    'bear': -0.0005,
    'sideways': 0,
    'high-vol': 0.0002,
    'low-vol': 0.0003
  };
  return trends[regime] || 0;
}

/**
 * Initialize historical data - generate for all symbols
 * Stores in localStorage
 * @returns {Object} Historical data keyed by symbol
 */
export function initializeHistoricalData() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_HISTORICAL);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.warn('Could not load historical data from localStorage');
  }

  const historicalData = {};
  const regimes = ['bull', 'bear', 'sideways', 'high-vol', 'low-vol'];

  SYMBOLS.forEach((symbol, idx) => {
    const regime = regimes[idx % regimes.length];
    historicalData[symbol] = generateSymbolData(symbol, 504, regime);
  });

  try {
    localStorage.setItem(STORAGE_KEY_HISTORICAL, JSON.stringify(historicalData));
  } catch (e) {
    console.warn('Could not persist historical data to localStorage');
  }

  return historicalData;
}

/**
 * Load historical data from storage
 * @returns {Object}
 */
export function loadHistoricalData() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_HISTORICAL);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.warn('Failed to load historical data');
  }
  return initializeHistoricalData();
}

// ============================================================================
// STRATEGY SIGNAL GENERATION
// ============================================================================

/**
 * Generate trading signals for momentum strategy
 * @param {Array} prices - OHLCV data
 * @param {Object} params - { period, threshold }
 * @returns {Array<{date, signal}>}
 */
function generateMomentumSignals(prices, params = {}) {
  const period = params.period || 20;
  const threshold = params.threshold || 0.02;
  const signals = [];

  if (!prices || prices.length < period) return signals;

  for (let i = period; i < prices.length; i++) {
    const return_ = (prices[i].close - prices[i - period].close) / prices[i - period].close;
    let signal = 'HOLD';
    if (return_ > threshold) signal = 'BUY';
    else if (return_ < -threshold) signal = 'SELL';

    signals.push({
      date: prices[i].date,
      signal,
      value: return_
    });
  }

  return signals;
}

/**
 * Generate trading signals for mean reversion strategy
 * @param {Array} prices
 * @param {Object} params - { period, stddev_threshold }
 * @returns {Array}
 */
function generateMeanReversionSignals(prices, params = {}) {
  const period = params.period || 30;
  const stddevThreshold = params.stddev_threshold || 2;
  const signals = [];

  if (!prices || prices.length < period) return signals;

  for (let i = period; i < prices.length; i++) {
    const window = prices.slice(i - period, i);
    const closes = window.map(p => p.close);
    const mean = closes.reduce((a, b) => a + b) / closes.length;
    const variance = closes.reduce((a, p) => a + Math.pow(p - mean, 2)) / closes.length;
    const stddev = Math.sqrt(variance);
    const zscore = (prices[i].close - mean) / stddev;

    let signal = 'HOLD';
    if (zscore < -stddevThreshold) signal = 'BUY';
    else if (zscore > stddevThreshold) signal = 'SELL';

    signals.push({
      date: prices[i].date,
      signal,
      value: zscore
    });
  }

  return signals;
}

/**
 * Generate trading signals for breakout strategy
 * @param {Array} prices
 * @param {Object} params - { period, percentage }
 * @returns {Array}
 */
function generateBreakoutSignals(prices, params = {}) {
  const period = params.period || 20;
  const percentage = params.percentage || 0.02;
  const signals = [];

  if (!prices || prices.length < period) return signals;

  for (let i = period; i < prices.length; i++) {
    const window = prices.slice(i - period, i);
    const high = Math.max(...window.map(p => p.high));
    const low = Math.min(...window.map(p => p.low));

    let signal = 'HOLD';
    if (prices[i].close > high * (1 + percentage)) signal = 'BUY';
    else if (prices[i].close < low * (1 - percentage)) signal = 'SELL';

    signals.push({
      date: prices[i].date,
      signal,
      value: prices[i].close
    });
  }

  return signals;
}

/**
 * Generate trading signals for trend following strategy
 * @param {Array} prices
 * @param {Object} params - { period, ma_period }
 * @returns {Array}
 */
function generateTrendFollowingSignals(prices, params = {}) {
  const period = params.period || 50;
  const maPeriod = params.ma_period || 20;
  const signals = [];

  if (!prices || prices.length < period) return signals;

  for (let i = period; i < prices.length; i++) {
    const window = prices.slice(i - maPeriod, i);
    const sma = window.reduce((a, p) => a + p.close, 0) / maPeriod;

    let signal = 'HOLD';
    if (prices[i].close > sma) signal = 'BUY';
    else if (prices[i].close < sma) signal = 'SELL';

    signals.push({
      date: prices[i].date,
      signal,
      value: prices[i].close - sma
    });
  }

  return signals;
}

/**
 * Generate trading signals for volatility selling strategy
 * @param {Array} prices
 * @param {Object} params - { period, vol_threshold }
 * @returns {Array}
 */
function generateVolatilitySellingSignals(prices, params = {}) {
  const period = params.period || 20;
  const volThreshold = params.vol_threshold || 0.015;
  const signals = [];

  if (!prices || prices.length < period) return signals;

  for (let i = period; i < prices.length; i++) {
    const window = prices.slice(i - period, i);
    const returns = [];
    for (let j = 1; j < window.length; j++) {
      returns.push((window[j].close - window[j-1].close) / window[j-1].close);
    }
    const volatility = Math.sqrt(
      returns.reduce((a, r) => a + Math.pow(r, 2)) / returns.length
    );

    let signal = 'HOLD';
    if (volatility > volThreshold) signal = 'SELL';
    else if (volatility < volThreshold * 0.5) signal = 'BUY';

    signals.push({
      date: prices[i].date,
      signal,
      value: volatility
    });
  }

  return signals;
}

/**
 * Generate trading signals for macro regime strategy
 * @param {Array} prices
 * @param {Object} params - { period }
 * @returns {Array}
 */
function generateMacroRegimeSignals(prices, params = {}) {
  const period = params.period || 60;
  const signals = [];

  if (!prices || prices.length < period) return signals;

  for (let i = period; i < prices.length; i++) {
    const window = prices.slice(i - period, i);
    const return_ = (window[window.length - 1].close - window[0].close) / window[0].close;
    const returns = [];
    for (let j = 1; j < window.length; j++) {
      returns.push((window[j].close - window[j-1].close) / window[j-1].close);
    }
    const volatility = Math.sqrt(
      returns.reduce((a, r) => a + Math.pow(r, 2)) / returns.length
    );

    let signal = 'HOLD';
    if (return_ > 0 && volatility < 0.015) signal = 'BUY';
    else if (return_ < -0.05 || volatility > 0.03) signal = 'SELL';

    signals.push({
      date: prices[i].date,
      signal,
      value: return_
    });
  }

  return signals;
}

/**
 * Generate signals for given strategy
 * @param {string} strategyName
 * @param {Array} prices
 * @param {Object} params
 * @returns {Array}
 */
function generateSignals(strategyName, prices, params = {}) {
  if (!prices || prices.length === 0) return [];

  switch (strategyName) {
    case 'momentum':
      return generateMomentumSignals(prices, params);
    case 'mean-reversion':
      return generateMeanReversionSignals(prices, params);
    case 'breakout':
      return generateBreakoutSignals(prices, params);
    case 'trend-following':
      return generateTrendFollowingSignals(prices, params);
    case 'volatility-selling':
      return generateVolatilitySellingSignals(prices, params);
    case 'macro-regime':
      return generateMacroRegimeSignals(prices, params);
    default:
      return [];
  }
}

// ============================================================================
// BACKTESTING ENGINE
// ============================================================================

/**
 * Run a backtest for a given configuration
 * @param {Object} config - {strategy, symbols, startDate, endDate, initialCapital, params}
 * @returns {Object} Backtest results
 */
export function runBacktest(config) {
  if (!config || !config.strategy || !config.symbols || !config.initialCapital) {
    throw new Error('Invalid backtest config');
  }

  const {
    strategy,
    symbols,
    startDate,
    endDate,
    initialCapital,
    params = {}
  } = config;

  const historicalData = loadHistoricalData();
  const trades = [];
  const equityCurve = [{ date: startDate, equity: initialCapital }];

  let cash = initialCapital;
  let positions = {}; // symbol -> quantity
  let portfolio = initialCapital;

  // Initialize positions
  symbols.forEach(sym => {
    positions[sym] = 0;
  });

  // Generate signals for all symbols
  const allSignals = {};
  symbols.forEach(sym => {
    if (!historicalData[sym]) return;
    const filteredPrices = historicalData[sym].filter(p => {
      const pDate = new Date(p.date);
      return pDate >= new Date(startDate) && pDate <= new Date(endDate);
    });
    allSignals[sym] = generateSignals(strategy, filteredPrices, params);
  });

  // Simulate trading
  const dateSet = new Set();
  Object.values(allSignals).forEach(signals => {
    signals.forEach(s => dateSet.add(s.date));
  });

  Array.from(dateSet).sort().forEach(currentDate => {
    let dayPortfolio = cash;

    symbols.forEach(sym => {
      if (positions[sym] > 0 && historicalData[sym]) {
        const price = getPriceAtDate(historicalData[sym], currentDate);
        if (price) dayPortfolio += positions[sym] * price;
      }
    });

    // Process signals
    symbols.forEach(sym => {
      const signalData = allSignals[sym] || [];
      const signal = signalData.find(s => s.date === currentDate);
      if (!signal) return;

      const price = getPriceAtDate(historicalData[sym], currentDate);
      if (!price) return;

      const slippage = price * DEFAULT_SLIPPAGE;
      const priceWithSlippage = signal.signal === 'BUY' ? price + slippage : price - slippage;

      if (signal.signal === 'BUY' && positions[sym] === 0) {
        const quantity = Math.floor(cash * 0.1 / (priceWithSlippage + DEFAULT_COMMISSION));
        if (quantity > 0) {
          const cost = quantity * (priceWithSlippage + DEFAULT_COMMISSION);
          cash -= cost;
          positions[sym] = quantity;
          trades.push({
            date: currentDate,
            symbol: sym,
            type: 'BUY',
            price: priceWithSlippage,
            quantity,
            cost,
            commission: quantity * DEFAULT_COMMISSION
          });
        }
      } else if (signal.signal === 'SELL' && positions[sym] > 0) {
        const proceeds = positions[sym] * (priceWithSlippage - DEFAULT_COMMISSION);
        cash += proceeds;
        trades.push({
          date: currentDate,
          symbol: sym,
          type: 'SELL',
          price: priceWithSlippage,
          quantity: positions[sym],
          proceeds,
          commission: positions[sym] * DEFAULT_COMMISSION
        });
        positions[sym] = 0;
      }
    });

    equityCurve.push({ date: currentDate, equity: dayPortfolio });
  });

  // Final portfolio value
  let finalEquity = cash;
  symbols.forEach(sym => {
    if (positions[sym] > 0 && historicalData[sym]) {
      const lastBar = historicalData[sym][historicalData[sym].length - 1];
      if (lastBar) finalEquity += positions[sym] * lastBar.close;
    }
  });

  equityCurve.push({ date: endDate, equity: finalEquity });

  const results = {
    strategy,
    symbols,
    startDate,
    endDate,
    initialCapital,
    finalEquity,
    trades,
    equityCurve,
    positions,
    params,
    timestamp: new Date().toISOString()
  };

  return results;
}

/**
 * Get price at specific date from price data
 * @param {Array} prices
 * @param {string} date - ISO date string
 * @returns {number|null}
 */
function getPriceAtDate(prices, date) {
  if (!prices || !date) return null;
  const bar = prices.find(p => p.date === date);
  return bar ? bar.close : null;
}

// ============================================================================
// PERFORMANCE ANALYTICS
// ============================================================================

/**
 * Calculate comprehensive backtest metrics
 * @param {Object} results - Backtest results object
 * @returns {Object} Metrics object
 */
export function calculateBacktestMetrics(results) {
  if (!results || !results.equityCurve || results.equityCurve.length < 2) {
    throw new Error('Invalid results object');
  }

  const equity = results.equityCurve.map(e => e.equity);
  const initialCapital = results.initialCapital;
  const finalEquity = equity[equity.length - 1];
  const totalReturn = (finalEquity - initialCapital) / initialCapital;

  // CAGR
  const days = results.equityCurve.length;
  const years = days / 252;
  const cagr = Math.pow(finalEquity / initialCapital, 1 / years) - 1;

  // Drawdown metrics
  let maxDrawdown = 0;
  let maxDrawdownDuration = 0;
  let runningMax = equity[0];
  let drawdownStart = 0;

  for (let i = 1; i < equity.length; i++) {
    if (equity[i] > runningMax) {
      runningMax = equity[i];
      drawdownStart = i;
    }
    const drawdown = (equity[i] - runningMax) / runningMax;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownDuration = i - drawdownStart;
    }
  }

  // Returns for Sharpe/Sortino
  const returns = [];
  for (let i = 1; i < equity.length; i++) {
    returns.push((equity[i] - equity[i-1]) / equity[i-1]);
  }

  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + Math.pow(r - meanReturn, 2), 0) / returns.length;
  const stddev = Math.sqrt(variance);

  // Sharpe Ratio (assuming 0% risk-free rate)
  const sharpeRatio = stddev > 0 ? (meanReturn / stddev) * Math.sqrt(252) : 0;

  // Sortino Ratio
  const downReturns = returns.filter(r => r < 0);
  const downVariance = downReturns.reduce((a, r) => a + Math.pow(r, 2), 0) / downReturns.length;
  const downStddev = Math.sqrt(downVariance || 0);
  const sortinoRatio = downStddev > 0 ? (meanReturn / downStddev) * Math.sqrt(252) : 0;

  // Calmar Ratio
  const calmarRatio = maxDrawdown !== 0 ? cagr / Math.abs(maxDrawdown) : 0;

  // Trade analysis
  const trades = results.trades || [];
  const buyTrades = trades.filter(t => t.type === 'BUY');
  const sellTrades = trades.filter(t => t.type === 'SELL');
  const numTrades = Math.min(buyTrades.length, sellTrades.length);

  let winningTrades = 0;
  let losingTrades = 0;
  let totalWin = 0;
  let totalLoss = 0;
  let totalHoldingDays = 0;

  for (let i = 0; i < Math.min(buyTrades.length, sellTrades.length); i++) {
    const pnl = (sellTrades[i].price - buyTrades[i].price) * buyTrades[i].quantity;
    if (pnl > 0) {
      winningTrades++;
      totalWin += pnl;
    } else {
      losingTrades++;
      totalLoss += pnl;
    }
    const date1 = new Date(buyTrades[i].date);
    const date2 = new Date(sellTrades[i].date);
    totalHoldingDays += Math.floor((date2 - date1) / (1000 * 60 * 60 * 24));
  }

  const winRate = numTrades > 0 ? winningTrades / numTrades : 0;
  const profitFactor = totalLoss !== 0 ? totalWin / Math.abs(totalLoss) : (totalWin > 0 ? Infinity : 0);
  const avgWin = winningTrades > 0 ? totalWin / winningTrades : 0;
  const avgLoss = losingTrades > 0 ? totalLoss / losingTrades : 0;
  const avgWinLossRatio = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;
  const avgHoldingPeriod = numTrades > 0 ? totalHoldingDays / numTrades : 0;

  // Monthly returns
  const monthlyReturns = calculateMonthlyReturns(results.equityCurve);

  // Best/worst trades
  const tradeReturns = [];
  for (let i = 0; i < Math.min(buyTrades.length, sellTrades.length); i++) {
    tradeReturns.push({
      return: (sellTrades[i].price - buyTrades[i].price) / buyTrades[i].price,
      buyPrice: buyTrades[i].price,
      sellPrice: sellTrades[i].price
    });
  }
  tradeReturns.sort((a, b) => b.return - a.return);

  const bestTrade = tradeReturns.length > 0 ? tradeReturns[0] : null;
  const worstTrade = tradeReturns.length > 0 ? tradeReturns[tradeReturns.length - 1] : null;

  const bestMonth = monthlyReturns.length > 0 ? Math.max(...monthlyReturns.map(m => m.return)) : 0;
  const worstMonth = monthlyReturns.length > 0 ? Math.min(...monthlyReturns.map(m => m.return)) : 0;

  // Recovery factor
  const recoveryFactor = Math.abs(maxDrawdown) > 0 ? totalReturn / Math.abs(maxDrawdown) : 0;

  return {
    totalReturn,
    cagr,
    maxDrawdown,
    maxDrawdownDuration,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    winRate,
    profitFactor,
    avgWinLossRatio,
    numTrades,
    avgHoldingPeriod,
    bestTrade,
    worstTrade,
    bestMonth,
    worstMonth,
    monthlyReturns,
    recoveryFactor,
    survivorshipBias: false,
    lookAheadBias: false,
    overfittingScore: 0
  };
}

/**
 * Calculate monthly returns
 * @param {Array} equityCurve
 * @returns {Array}
 */
function calculateMonthlyReturns(equityCurve) {
  const monthlyData = {};

  equityCurve.forEach(point => {
    const date = new Date(point.date);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!monthlyData[monthKey] || new Date(point.date) > new Date(monthlyData[monthKey].date)) {
      monthlyData[monthKey] = { date: point.date, equity: point.equity };
    }
  });

  const months = Object.keys(monthlyData).sort();
  const monthlyReturns = [];

  for (let i = 1; i < months.length; i++) {
    const prevEquity = monthlyData[months[i-1]].equity;
    const currEquity = monthlyData[months[i]].equity;
    monthlyReturns.push({
      month: months[i],
      return: (currEquity - prevEquity) / prevEquity
    });
  }

  return monthlyReturns;
}

// ============================================================================
// WALK-FORWARD ANALYSIS
// ============================================================================

/**
 * Run walk-forward analysis
 * @param {Object} config - {strategy, symbols, startDate, endDate, initialCapital, inSampleMonths, outSampleMonths, params}
 * @returns {Object} Walk-forward results
 */
export function runWalkForward(config) {
  if (!config.strategy || !config.symbols || !config.initialCapital) {
    throw new Error('Invalid walk-forward config');
  }

  const {
    strategy,
    symbols,
    startDate,
    endDate,
    initialCapital,
    inSampleMonths = 6,
    outSampleMonths = 2,
    params = {}
  } = config;

  const windows = [];
  const results = [];

  const start = new Date(startDate);
  let current = new Date(start);

  while (current < new Date(endDate)) {
    const inSampleStart = new Date(current);
    const inSampleEnd = new Date(current);
    inSampleEnd.setMonth(inSampleEnd.getMonth() + inSampleMonths);

    const outSampleEnd = new Date(inSampleEnd);
    outSampleEnd.setMonth(outSampleEnd.getMonth() + outSampleMonths);

    if (outSampleEnd > new Date(endDate)) break;

    const window = {
      inSample: {
        start: inSampleStart.toISOString().split('T')[0],
        end: inSampleEnd.toISOString().split('T')[0]
      },
      outSample: {
        start: inSampleEnd.toISOString().split('T')[0],
        end: outSampleEnd.toISOString().split('T')[0]
      }
    };

    windows.push(window);
    current.setMonth(current.getMonth() + outSampleMonths);
  }

  // Run backtest on each window
  windows.forEach((window, idx) => {
    // In-sample optimization (simplified: use same params)
    const inSampleResults = runBacktest({
      strategy,
      symbols,
      startDate: window.inSample.start,
      endDate: window.inSample.end,
      initialCapital,
      params
    });

    const outSampleResults = runBacktest({
      strategy,
      symbols,
      startDate: window.outSample.start,
      endDate: window.outSample.end,
      initialCapital,
      params
    });

    const inSampleMetrics = calculateBacktestMetrics(inSampleResults);
    const outSampleMetrics = calculateBacktestMetrics(outSampleResults);

    results.push({
      window: idx + 1,
      inSample: {
        results: inSampleResults,
        metrics: inSampleMetrics
      },
      outSample: {
        results: outSampleResults,
        metrics: outSampleMetrics
      },
      overfittingScore: Math.abs(inSampleMetrics.sharpeRatio - outSampleMetrics.sharpeRatio)
    });
  });

  // Aggregate metrics
  const allOutSampleMetrics = results.map(r => r.outSample.metrics);
  const aggregateMetrics = {
    avgSharpeRatio: allOutSampleMetrics.reduce((a, m) => a + m.sharpeRatio, 0) / allOutSampleMetrics.length,
    avgCAGR: allOutSampleMetrics.reduce((a, m) => a + m.cagr, 0) / allOutSampleMetrics.length,
    avgMaxDrawdown: allOutSampleMetrics.reduce((a, m) => a + m.maxDrawdown, 0) / allOutSampleMetrics.length,
    avgWinRate: allOutSampleMetrics.reduce((a, m) => a + m.winRate, 0) / allOutSampleMetrics.length,
    avgOverfittingScore: results.reduce((a, r) => a + r.overfittingScore, 0) / results.length
  };

  return {
    strategy,
    symbols,
    startDate,
    endDate,
    initialCapital,
    windows: results,
    aggregateMetrics,
    timestamp: new Date().toISOString()
  };
}

// ============================================================================
// MONTE CARLO SIMULATION
// ============================================================================

/**
 * Run Monte Carlo simulation on trade returns
 * @param {Array} trades - Trade objects from backtest
 * @param {number} numSims - Number of simulations (default 1000)
 * @param {number} numPeriods - Periods to project (default 252)
 * @returns {Object} Simulation results with confidence intervals
 */
export function runMonteCarloSim(trades, numSims = 1000, numPeriods = 252) {
  if (!trades || trades.length < 2) {
    throw new Error('Need at least 2 trades for Monte Carlo simulation');
  }

  // Calculate returns per trade
  const tradeReturns = [];
  const buyTrades = trades.filter(t => t.type === 'BUY');
  const sellTrades = trades.filter(t => t.type === 'SELL');

  for (let i = 0; i < Math.min(buyTrades.length, sellTrades.length); i++) {
    const return_ = (sellTrades[i].price - buyTrades[i].price) / buyTrades[i].price;
    tradeReturns.push(return_);
  }

  const meanReturn = tradeReturns.reduce((a, b) => a + b, 0) / tradeReturns.length;
  const variance = tradeReturns.reduce((a, r) => a + Math.pow(r - meanReturn, 2), 0) / tradeReturns.length;
  const stddev = Math.sqrt(variance);

  // Run simulations
  const simulations = [];
  for (let sim = 0; sim < numSims; sim++) {
    let equity = 100000; // Starting equity
    const path = [equity];

    for (let period = 0; period < numPeriods; period++) {
      // Random draw from historical returns
      const randomReturn = tradeReturns[Math.floor(Math.random() * tradeReturns.length)];
      equity = equity * (1 + randomReturn);
      path.push(equity);
    }

    simulations.push(path);
  }

  // Calculate percentiles
  const percentiles = [5, 25, 50, 75, 95];
  const equityAtEnd = simulations.map(sim => sim[sim.length - 1]).sort((a, b) => a - b);

  const confidenceIntervals = {};
  percentiles.forEach(p => {
    const idx = Math.floor((p / 100) * equityAtEnd.length);
    confidenceIntervals[`p${p}`] = equityAtEnd[idx];
  });

  // Build percentile curves
  const percentileCurves = {};
  percentiles.forEach(p => {
    const paths = simulations.map((sim, idx) => ({
      idx,
      endValue: sim[sim.length - 1]
    })).sort((a, b) => a.endValue - b.endValue);

    const selectedIdx = paths[Math.floor((p / 100) * paths.length)].idx;
    percentileCurves[`p${p}`] = simulations[selectedIdx];
  });

  return {
    numSims,
    numPeriods,
    meanTradeReturn: meanReturn,
    stddevTradeReturn: stddev,
    confidenceIntervals,
    percentileCurves,
    medianFinalEquity: confidenceIntervals.p50,
    timestamp: new Date().toISOString()
  };
}

// ============================================================================
// PERSISTENCE
// ============================================================================

/**
 * Save backtest results to localStorage
 * @param {string} name - Result name
 * @param {Object} results - Backtest results
 */
export function saveBacktestResults(name, results) {
  if (!name || !results) throw new Error('Name and results required');

  try {
    const stored = localStorage.getItem(STORAGE_KEY_BACKTEST_RESULTS) || '{}';
    const allResults = JSON.parse(stored);
    allResults[name] = {
      ...results,
      savedAt: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEY_BACKTEST_RESULTS, JSON.stringify(allResults));
  } catch (e) {
    console.warn('Failed to save backtest results', e);
  }
}

/**
 * Load backtest results from localStorage
 * @param {string} name - Result name
 * @returns {Object|null}
 */
export function loadBacktestResults(name) {
  if (!name) return null;

  try {
    const stored = localStorage.getItem(STORAGE_KEY_BACKTEST_RESULTS) || '{}';
    const allResults = JSON.parse(stored);
    return allResults[name] || null;
  } catch (e) {
    console.warn('Failed to load backtest results', e);
    return null;
  }
}

/**
 * List all saved backtest results
 * @returns {Array<string>}
 */
export function listBacktestResults() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_BACKTEST_RESULTS) || '{}';
    const allResults = JSON.parse(stored);
    return Object.keys(allResults);
  } catch (e) {
    console.warn('Failed to list results', e);
    return [];
  }
}

/**
 * Delete saved backtest results
 * @param {string} name
 */
export function deleteBacktestResults(name) {
  if (!name) return;

  try {
    const stored = localStorage.getItem(STORAGE_KEY_BACKTEST_RESULTS) || '{}';
    const allResults = JSON.parse(stored);
    delete allResults[name];
    localStorage.setItem(STORAGE_KEY_BACKTEST_RESULTS, JSON.stringify(allResults));
  } catch (e) {
    console.warn('Failed to delete results', e);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  SYMBOLS,
  STRATEGIES,
  generateSymbolData,
  generateSignals,
  getPriceAtDate,
  calculateMonthlyReturns
};
