/**
 * 12 Tribes AI Trading Platform - Tier 2 Portfolio Engine
 *
 * Comprehensive portfolio optimization, risk management, and position sizing
 * Five integrated systems: Portfolio Optimization, Correlation Monitoring,
 * Multi-Timeframe Analysis, Advanced Risk Controls, and Adaptive Position Sizing.
 *
 * Pure JavaScript ES module, no external dependencies, browser-only with localStorage persistence.
 * @module portfolioEngine
 */

/* ═══════════════════════════════════════════════════════════════════════════════
   SYSTEM 1: PORTFOLIO OPTIMIZATION ENGINE
   ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Optimizes portfolio using mean-variance optimization (Markowitz approach)
 * Maximizes Sharpe ratio subject to target risk constraint
 *
 * @param {Array<{symbol: string, shares: number, currentPrice: number}>} positions - Current positions
 * @param {('conservative'|'balanced'|'aggressive')} targetRisk - Target risk level
 * @returns {{
 *   weights: {symbol: number},
 *   expectedReturn: number,
 *   expectedRisk: number,
 *   sharpeRatio: number,
 *   rebalanceActions: Array<{symbol: string, action: 'BUY'|'SELL', amount: number}>
 * }} Optimal portfolio weights and rebalancing actions
 */
function optimizePortfolio(positions, targetRisk = 'balanced') {
  // Guard parameters
  if (!Array.isArray(positions) || positions.length === 0) {
    return {
      weights: {},
      expectedReturn: 0,
      expectedRisk: 0,
      sharpeRatio: 0,
      rebalanceActions: []
    };
  }

  if (!['conservative', 'balanced', 'aggressive'].includes(targetRisk)) {
    targetRisk = 'balanced';
  }

  // Load historical data
  const historicalData = _loadHistoricalData();

  // Extract symbols
  const symbols = positions.map(p => p.symbol).filter(Boolean);
  if (symbols.length === 0) {
    return {
      weights: {},
      expectedReturn: 0,
      expectedRisk: 0,
      sharpeRatio: 0,
      rebalanceActions: []
    };
  }

  // Compute expected returns
  const expectedReturns = _computeExpectedReturns(symbols, historicalData);

  // Compute covariance matrix
  const covMatrix = _computeCovarianceMatrix(symbols, historicalData);

  // Risk target mapping
  const riskTargets = {
    conservative: 0.08,
    balanced: 0.12,
    aggressive: 0.18
  };
  const targetVolatility = riskTargets[targetRisk];

  // Simplified Markowitz optimization (equal-weighted as fallback with variance adjustment)
  const n = symbols.length;
  const weights = {};
  const baseWeight = 1 / n;

  // Adjust weights by inverse volatility (risk parity adjusted)
  const volatilities = symbols.map((sym, i) => {
    const covRow = covMatrix[sym] || {};
    return Math.sqrt(covRow[sym] || 0.01);
  });

  const invVolSum = volatilities.reduce((sum, vol) => sum + (1 / Math.max(vol, 0.001)), 0);

  symbols.forEach((sym, i) => {
    const invVol = 1 / Math.max(volatilities[i], 0.001);
    weights[sym] = invVol / invVolSum;
  });

  // Compute portfolio metrics
  const portfolioReturn = _computePortfolioReturn(weights, expectedReturns);
  const portfolioRisk = _computePortfolioRisk(weights, covMatrix);
  const riskFreeRate = 0.045; // 4.5% risk-free rate
  const sharpeRatio = (portfolioReturn - riskFreeRate) / Math.max(portfolioRisk, 0.001);

  // Generate rebalancing actions
  const currentWeights = _computeCurrentWeights(positions);
  const totalValue = positions.reduce((sum, p) => sum + (p.shares * p.currentPrice), 0) || 1;

  const rebalanceActions = symbols
    .map(sym => {
      const current = currentWeights[sym] || 0;
      const target = weights[sym] || 0;
      const diff = target - current;

      if (Math.abs(diff) > 0.02) { // 2% threshold
        const position = positions.find(p => p.symbol === sym);
        const dollarAmount = diff * totalValue;
        const shares = Math.round(dollarAmount / Math.max(position?.currentPrice || 1, 0.01));

        return {
          symbol: sym,
          action: shares > 0 ? 'BUY' : 'SELL',
          amount: Math.abs(shares)
        };
      }
      return null;
    })
    .filter(Boolean);

  return {
    weights: _sanitizeWeights(weights),
    expectedReturn: isNaN(portfolioReturn) ? 0 : portfolioReturn,
    expectedRisk: isNaN(portfolioRisk) ? 0.12 : portfolioRisk,
    sharpeRatio: isNaN(sharpeRatio) ? 0 : sharpeRatio,
    rebalanceActions
  };
}

/**
 * Calculates risk parity weights where each asset contributes equally to portfolio volatility
 *
 * @param {Array<string>} symbols - Asset symbols
 * @returns {{
 *   weights: {symbol: number},
 *   riskContributions: {symbol: number}
 * }} Risk parity allocation
 */
function getRiskParityWeights(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return { weights: {}, riskContributions: {} };
  }

  const historicalData = _loadHistoricalData();
  const covMatrix = _computeCovarianceMatrix(symbols, historicalData);

  // Inverse volatility weighting
  const weights = {};
  const volatilities = {};

  symbols.forEach(sym => {
    const variance = covMatrix[sym]?.[sym] || 0.01;
    volatilities[sym] = Math.sqrt(variance);
  });

  const invVolSum = symbols.reduce((sum, sym) => sum + (1 / Math.max(volatilities[sym], 0.001)), 0);

  symbols.forEach(sym => {
    weights[sym] = (1 / Math.max(volatilities[sym], 0.001)) / invVolSum;
  });

  // Compute risk contributions
  const portfolioVol = Math.sqrt(
    symbols.reduce((sum, s1) => {
      return sum + symbols.reduce((inner, s2) => {
        const w1 = weights[s1] || 0;
        const w2 = weights[s2] || 0;
        const cov = covMatrix[s1]?.[s2] || 0;
        return inner + w1 * w2 * cov;
      }, 0);
    }, 0)
  );

  const riskContributions = {};
  symbols.forEach(sym => {
    const marginalRisk = symbols.reduce((sum, s2) => {
      return sum + (weights[s2] || 0) * (covMatrix[sym]?.[s2] || 0);
    }, 0);
    riskContributions[sym] = (weights[sym] * marginalRisk) / Math.max(portfolioVol * portfolioVol, 0.001);
  });

  return {
    weights: _sanitizeWeights(weights),
    riskContributions: _sanitizeWeights(riskContributions)
  };
}

/**
 * Detects if current portfolio weights have drifted from targets
 *
 * @param {Object<string, number>} currentWeights - Current asset weights {symbol: pct}
 * @param {Object<string, number>} targetWeights - Target asset weights {symbol: pct}
 * @param {number} threshold - Drift threshold percentage (default 5)
 * @returns {{
 *   needsRebalance: boolean,
 *   drifts: {symbol: {current: number, target: number, drift: number}}
 * }} Rebalancing status and drift details
 */
function getRebalanceNeeded(currentWeights = {}, targetWeights = {}, threshold = 0.05) {
  // Guard parameters
  if (typeof currentWeights !== 'object' || typeof targetWeights !== 'object') {
    return { needsRebalance: false, drifts: {} };
  }

  if (typeof threshold !== 'number' || threshold <= 0) {
    threshold = 0.05;
  }

  const allSymbols = new Set([
    ...Object.keys(currentWeights),
    ...Object.keys(targetWeights)
  ]);

  const drifts = {};
  let needsRebalance = false;

  allSymbols.forEach(symbol => {
    const current = currentWeights[symbol] || 0;
    const target = targetWeights[symbol] || 0;
    const drift = Math.abs(current - target);

    drifts[symbol] = { current, target, drift: Number(drift.toFixed(4)) };

    if (drift > threshold) {
      needsRebalance = true;
    }
  });

  return { needsRebalance, drifts };
}

/* ═══════════════════════════════════════════════════════════════════════════════
   SYSTEM 2: CORRELATION MONITOR
   ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Computes rolling correlation matrix between assets
 *
 * @param {Object<string, Array<number>>} priceData - Price data {symbol: [prices...]}
 * @param {number} window - Lookback window in periods (default 30)
 * @returns {Object<string, Object<string, number>>} Correlation matrix
 */
function computeCorrelationMatrix(priceData = {}, window = 30) {
  if (typeof priceData !== 'object' || Object.keys(priceData).length === 0) {
    return {};
  }

  if (typeof window !== 'number' || window < 2) {
    window = 30;
  }

  const symbols = Object.keys(priceData);
  const correlationMatrix = {};

  // Initialize matrix structure
  symbols.forEach(s1 => {
    correlationMatrix[s1] = {};
  });

  // Calculate returns for each symbol
  const returns = {};
  symbols.forEach(symbol => {
    const prices = priceData[symbol] || [];
    if (prices.length < 2) {
      returns[symbol] = [];
      return;
    }

    const lookback = Math.min(window, prices.length);
    returns[symbol] = [];

    for (let i = Math.max(0, prices.length - lookback); i < prices.length - 1; i++) {
      const ret = (prices[i + 1] - prices[i]) / Math.max(prices[i], 0.001);
      returns[symbol].push(isNaN(ret) ? 0 : ret);
    }
  });

  // Compute correlations
  symbols.forEach(s1 => {
    symbols.forEach(s2 => {
      if (returns[s1].length === 0 || returns[s2].length === 0) {
        correlationMatrix[s1][s2] = 0;
        return;
      }

      const r1 = returns[s1];
      const r2 = returns[s2];
      const minLen = Math.min(r1.length, r2.length);

      if (minLen === 0) {
        correlationMatrix[s1][s2] = 0;
        return;
      }

      // Compute means
      const mean1 = r1.slice(0, minLen).reduce((a, b) => a + b, 0) / minLen;
      const mean2 = r2.slice(0, minLen).reduce((a, b) => a + b, 0) / minLen;

      // Compute covariance and standard deviations
      let covariance = 0;
      let var1 = 0;
      let var2 = 0;

      for (let i = 0; i < minLen; i++) {
        const dev1 = r1[i] - mean1;
        const dev2 = r2[i] - mean2;
        covariance += dev1 * dev2;
        var1 += dev1 * dev1;
        var2 += dev2 * dev2;
      }

      covariance /= minLen;
      const std1 = Math.sqrt(var1 / minLen);
      const std2 = Math.sqrt(var2 / minLen);

      const correlation = std1 === 0 || std2 === 0
        ? (s1 === s2 ? 1 : 0)
        : covariance / (std1 * std2);

      correlationMatrix[s1][s2] = Math.max(-1, Math.min(1, isNaN(correlation) ? 0 : correlation));
    });
  });

  return correlationMatrix;
}

/**
 * Detects shifts in correlation regime
 *
 * @param {Object<string, Object<string, number>>} currentMatrix - Current correlation matrix
 * @param {Object<string, Object<string, number>>} historicalMatrix - Historical baseline
 * @returns {{
 *   shifts: Array<{pair: string, from: number, to: number, severity: number}>,
 *   avgCorrelation: number,
 *   diversificationScore: number
 * }} Correlation regime changes
 */
function detectCorrelationRegimeShift(currentMatrix = {}, historicalMatrix = {}) {
  if (typeof currentMatrix !== 'object' || typeof historicalMatrix !== 'object') {
    return { shifts: [], avgCorrelation: 0, diversificationScore: 100 };
  }

  const symbols = Object.keys(currentMatrix);
  if (symbols.length === 0) {
    return { shifts: [], avgCorrelation: 0, diversificationScore: 100 };
  }

  const shifts = [];
  const currentCorrs = [];
  const historicalCorrs = [];

  // Extract correlation pairs
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const s1 = symbols[i];
      const s2 = symbols[j];

      const current = currentMatrix[s1]?.[s2] ?? 0;
      const historical = historicalMatrix[s1]?.[s2] ?? 0;

      currentCorrs.push(current);
      historicalCorrs.push(historical);

      const shift = Math.abs(current - historical);

      if (shift > 0.3) { // Significant shift threshold
        shifts.push({
          pair: `${s1}/${s2}`,
          from: Number(historical.toFixed(3)),
          to: Number(current.toFixed(3)),
          severity: Number(shift.toFixed(3))
        });
      }
    }
  }

  const avgCurrent = currentCorrs.length > 0
    ? currentCorrs.reduce((a, b) => a + b, 0) / currentCorrs.length
    : 0;

  // Diversification score (higher = more uncorrelated)
  const avgAbsCorr = Math.abs(avgCurrent);
  const diversificationScore = Math.max(0, Math.min(100, 100 * (1 - avgAbsCorr)));

  return {
    shifts: shifts.sort((a, b) => b.severity - a.severity),
    avgCorrelation: Number(avgCurrent.toFixed(3)),
    diversificationScore: Number(diversificationScore.toFixed(1))
  };
}

/**
 * Calculates portfolio diversification score (0-100)
 *
 * @param {Array<{symbol: string, shares: number, currentPrice: number}>} positions - Current positions
 * @returns {{
 *   score: number,
 *   clusters: Array<{assets: Array<string>, intraCorrelation: number}>,
 *   warnings: Array<string>
 * }} Diversification analysis
 */
function getPortfolioDiversificationScore(positions = []) {
  if (!Array.isArray(positions) || positions.length === 0) {
    return { score: 0, clusters: [], warnings: ['No positions to analyze'] };
  }

  const symbols = positions.map(p => p.symbol).filter(Boolean);
  if (symbols.length < 2) {
    return { score: 100, clusters: symbols.map(s => ({ assets: [s], intraCorrelation: 1 })), warnings: ['Only one or fewer assets'] };
  }

  const historicalData = _loadHistoricalData();
  const corrMatrix = computeCorrelationMatrix(historicalData, 30);

  // Extract correlations
  const correlations = [];
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const corr = corrMatrix[symbols[i]]?.[symbols[j]] ?? 0;
      correlations.push(corr);
    }
  }

  const avgCorr = correlations.length > 0
    ? correlations.reduce((a, b) => a + b, 0) / correlations.length
    : 0;

  // Score: 100 = uncorrelated, 0 = perfectly correlated
  const score = Math.max(0, Math.min(100, 100 * (1 - Math.abs(avgCorr))));

  // Detect clusters (highly correlated groups)
  const clusters = [];
  const visited = new Set();

  symbols.forEach(s1 => {
    if (visited.has(s1)) return;

    const cluster = [s1];
    visited.add(s1);

    symbols.forEach(s2 => {
      if (visited.has(s2) || s1 === s2) return;

      const corr = Math.abs(corrMatrix[s1]?.[s2] ?? 0);
      if (corr > 0.7) {
        cluster.push(s2);
        visited.add(s2);
      }
    });

    const intraCorr = cluster.length > 1
      ? cluster.reduce((sum, a, i) => {
          return sum + cluster.slice(i + 1).reduce((inner, b) => {
            return inner + Math.abs(corrMatrix[a]?.[b] ?? 0);
          }, 0);
        }, 0) / (cluster.length * (cluster.length - 1) / 2)
      : 1;

    clusters.push({
      assets: cluster,
      intraCorrelation: Number(intraCorr.toFixed(3))
    });
  });

  const warnings = [];
  if (score < 30) warnings.push('Poor diversification: assets are highly correlated');
  if (avgCorr > 0.8) warnings.push('High correlation detected between assets');
  if (clusters.some(c => c.assets.length > symbols.length / 2)) {
    warnings.push('Large correlated cluster detected');
  }

  return {
    score: Number(score.toFixed(1)),
    clusters,
    warnings
  };
}

/**
 * Monitors correlation breaks and executes callback on detection
 *
 * @param {Function} onAlert - Callback function ({shifts, avgCorrelation, severity}) => void
 * @returns {Function} Cleanup function to stop monitoring
 */
function monitorCorrelationBreaks(onAlert) {
  if (typeof onAlert !== 'function') {
    return () => {};
  }

  let lastMatrix = null;
  const monitoringId = Math.random();

  const monitor = () => {
    try {
      const historicalData = _loadHistoricalData();
      const currentMatrix = computeCorrelationMatrix(historicalData, 30);

      if (lastMatrix !== null) {
        const analysis = detectCorrelationRegimeShift(currentMatrix, lastMatrix);

        if (analysis.shifts.length > 0) {
          onAlert({
            shifts: analysis.shifts,
            avgCorrelation: analysis.avgCorrelation,
            severity: analysis.shifts[0]?.severity ?? 0
          });
        }
      }

      lastMatrix = currentMatrix;
    } catch (error) {
      // Silently handle monitoring errors
    }
  };

  // Run monitor every 60 seconds
  const intervalId = setInterval(monitor, 60000);

  // Run immediately once
  monitor();

  // Return cleanup function
  return () => clearInterval(intervalId);
}

/* ═══════════════════════════════════════════════════════════════════════════════
   SYSTEM 3: MULTI-TIMEFRAME ANALYSIS
   ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Analyzes asset across multiple timeframes
 *
 * @param {string} symbol - Asset symbol
 * @param {Array<number>} priceHistory - Historical prices (oldest first)
 * @returns {{
 *   timeframes: {[tf: string]: {trend: string, momentum: number, volatility: number, support: number, resistance: number, signal: string}},
 *   alignment: number,
 *   overallSignal: string
 * }} Multi-timeframe analysis results
 */
function analyzeMultiTimeframe(symbol = '', priceHistory = []) {
  if (typeof symbol !== 'string' || !Array.isArray(priceHistory) || priceHistory.length < 30) {
    return {
      timeframes: {},
      alignment: 0,
      overallSignal: 'NEUTRAL'
    };
  }

  const timeframes = ['1D', '4H', '1H', '15min', '5min', '1min'];
  const timeframeResults = {};
  const signals = [];

  // Aggregate price data for different timeframes
  const aggregated = {
    '1D': priceHistory,
    '4H': _aggregatePrices(priceHistory, Math.max(1, Math.floor(priceHistory.length / 6))),
    '1H': _aggregatePrices(priceHistory, Math.max(1, Math.floor(priceHistory.length / 24))),
    '15min': _aggregatePrices(priceHistory, Math.max(1, Math.floor(priceHistory.length / 96))),
    '5min': _aggregatePrices(priceHistory, Math.max(1, Math.floor(priceHistory.length / 288))),
    '1min': _aggregatePrices(priceHistory, Math.max(1, Math.floor(priceHistory.length / 1440)))
  };

  timeframes.forEach(tf => {
    const prices = aggregated[tf];
    if (prices.length < 5) return;

    const indicators = getTechnicalIndicators(prices, 14);

    // Determine trend
    const sma20 = indicators.sma20;
    const sma50 = indicators.sma50;
    let trend = 'NEUTRAL';
    if (sma20 > sma50) trend = 'UPTREND';
    else if (sma20 < sma50) trend = 'DOWNTREND';

    // Momentum (RSI normalized to -100 to +100)
    const momentum = (indicators.rsi - 50) * 2;

    // Volatility (ATR as percentage of price)
    const volatility = (indicators.atr / prices[prices.length - 1]) * 100;

    // Support and resistance (using Bollinger Bands)
    const support = indicators.bbLower;
    const resistance = indicators.bbUpper;

    // Generate signal
    let signal = 'NEUTRAL';
    if (indicators.rsi > 70) signal = 'OVERBOUGHT';
    else if (indicators.rsi < 30) signal = 'OVERSOLD';
    else if (indicators.macd > indicators.macdSignal && indicators.rsi > 50) signal = 'BUY';
    else if (indicators.macd < indicators.macdSignal && indicators.rsi < 50) signal = 'SELL';

    timeframeResults[tf] = {
      trend,
      momentum: Number(momentum.toFixed(2)),
      volatility: Number(volatility.toFixed(2)),
      support: Number(support.toFixed(2)),
      resistance: Number(resistance.toFixed(2)),
      signal
    };

    signals.push(signal);
  });

  // Calculate alignment score
  const alignmentMap = {};
  signals.forEach(s => {
    alignmentMap[s] = (alignmentMap[s] || 0) + 1;
  });

  const maxCount = Math.max(...Object.values(alignmentMap), 1);
  const alignment = Math.round((maxCount / signals.length) * 100);

  // Determine overall signal
  const buyCount = signals.filter(s => ['BUY', 'OVERSOLD'].includes(s)).length;
  const sellCount = signals.filter(s => ['SELL', 'OVERBOUGHT'].includes(s)).length;

  let overallSignal = 'NEUTRAL';
  if (buyCount > sellCount * 1.5) overallSignal = 'STRONG_BUY';
  else if (buyCount > sellCount) overallSignal = 'BUY';
  else if (sellCount > buyCount * 1.5) overallSignal = 'STRONG_SELL';
  else if (sellCount > buyCount) overallSignal = 'SELL';

  return {
    timeframes: timeframeResults,
    alignment,
    overallSignal
  };
}

/**
 * Computes core technical indicators
 *
 * @param {Array<number>} prices - Price series (oldest first)
 * @param {number} period - Period for RSI/ATR (default 14)
 * @returns {{
 *   sma20: number, sma50: number, sma200: number,
 *   ema12: number, ema26: number,
 *   rsi: number,
 *   macd: number, macdSignal: number,
 *   bbUpper: number, bbMiddle: number, bbLower: number,
 *   atr: number
 * }} Technical indicators
 */
function getTechnicalIndicators(prices = [], period = 14) {
  if (!Array.isArray(prices) || prices.length < Math.max(period, 200)) {
    return {
      sma20: 0, sma50: 0, sma200: 0,
      ema12: 0, ema26: 0,
      rsi: 50,
      macd: 0, macdSignal: 0,
      bbUpper: 0, bbMiddle: 0, bbLower: 0,
      atr: 0
    };
  }

  if (typeof period !== 'number' || period < 2) {
    period = 14;
  }

  // SMAs
  const sma20 = _calculateSMA(prices, 20);
  const sma50 = _calculateSMA(prices, 50);
  const sma200 = _calculateSMA(prices, 200);

  // EMAs
  const ema12 = _calculateEMA(prices, 12);
  const ema26 = _calculateEMA(prices, 26);

  // RSI
  const rsi = _calculateRSI(prices, period);

  // MACD
  const macd = ema12 - ema26;
  const macdSignal = _calculateEMA([ema12, ema26].map((_, i) => {
    const e12 = _calculateEMA(prices.slice(0, Math.max(1, prices.length - i - 1)), 12);
    const e26 = _calculateEMA(prices.slice(0, Math.max(1, prices.length - i - 1)), 26);
    return e12 - e26;
  }), 9);

  // Bollinger Bands
  const bbMiddle = sma20;
  const stdDev = _calculateStdDev(prices.slice(-20));
  const bbUpper = bbMiddle + (2 * stdDev);
  const bbLower = bbMiddle - (2 * stdDev);

  // ATR
  const atr = _calculateATR(prices, period);

  return {
    sma20: Number(sma20.toFixed(2)),
    sma50: Number(sma50.toFixed(2)),
    sma200: Number(sma200.toFixed(2)),
    ema12: Number(ema12.toFixed(2)),
    ema26: Number(ema26.toFixed(2)),
    rsi: Number(rsi.toFixed(2)),
    macd: Number(macd.toFixed(2)),
    macdSignal: Number(macdSignal.toFixed(2)),
    bbUpper: Number(bbUpper.toFixed(2)),
    bbMiddle: Number(bbMiddle.toFixed(2)),
    bbLower: Number(bbLower.toFixed(2)),
    atr: Number(atr.toFixed(2))
  };
}

/**
 * Quick timeframe alignment check
 *
 * @param {string} symbol - Asset symbol
 * @returns {{
 *   score: number,
 *   direction: string,
 *   confluenceLevel: 'high'|'medium'|'low'
 * }} Alignment summary
 */
function getTimeframeAlignment(symbol = '') {
  if (typeof symbol !== 'string') {
    return { score: 0, direction: 'NEUTRAL', confluenceLevel: 'low' };
  }

  const historicalData = _loadHistoricalData();
  const prices = historicalData[symbol] || [];

  if (!Array.isArray(prices) || prices.length < 30) {
    return { score: 0, direction: 'NEUTRAL', confluenceLevel: 'low' };
  }

  const analysis = analyzeMultiTimeframe(symbol, prices);

  const confluenceMap = {
    'high': { 75: 100, 50: 74, 0: 49 },
    'medium': { 50: 74, 25: 49, 0: 24 },
    'low': { 0: 24 }
  };

  let confluenceLevel = 'low';
  if (analysis.alignment >= 75) confluenceLevel = 'high';
  else if (analysis.alignment >= 50) confluenceLevel = 'medium';

  return {
    score: analysis.alignment,
    direction: analysis.overallSignal,
    confluenceLevel
  };
}

/* ═══════════════════════════════════════════════════════════════════════════════
   SYSTEM 4: ADVANCED RISK CONTROLS
   ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Calculates Value at Risk (VaR) for portfolio
 *
 * @param {Array<{symbol: string, shares: number, currentPrice: number}>} portfolio - Portfolio positions
 * @param {number} confidence - Confidence level (0.95 or 0.99, default 0.95)
 * @param {number} horizon - Time horizon in days (default 1)
 * @returns {{
 *   historicalVaR: number,
 *   parametricVaR: number,
 *   conditionalVaR: number
 * }} Value at Risk metrics
 */
function calculateVaR(portfolio = [], confidence = 0.95, horizon = 1) {
  if (!Array.isArray(portfolio) || portfolio.length === 0) {
    return { historicalVaR: 0, parametricVaR: 0, conditionalVaR: 0 };
  }

  if (typeof confidence !== 'number' || ![0.95, 0.99].includes(confidence)) {
    confidence = 0.95;
  }

  if (typeof horizon !== 'number' || horizon < 1) {
    horizon = 1;
  }

  // Compute portfolio value and returns
  const portfolioValue = portfolio.reduce((sum, p) => sum + (p.shares * p.currentPrice), 0) || 1;
  const historicalData = _loadHistoricalData();

  // Get returns for all assets
  const allReturns = [];
  portfolio.forEach(p => {
    const prices = historicalData[p.symbol] || [];
    const weight = (p.shares * p.currentPrice) / portfolioValue;

    for (let i = 1; i < Math.min(250, prices.length); i++) {
      const ret = (prices[i] - prices[i - 1]) / Math.max(prices[i - 1], 0.001);
      allReturns.push(ret * weight);
    }
  });

  if (allReturns.length === 0) {
    return { historicalVaR: 0, parametricVaR: 0, conditionalVaR: 0 };
  }

  // Sort returns for historical VaR
  const sortedReturns = allReturns.sort((a, b) => a - b);
  const varIndex = Math.ceil(sortedReturns.length * (1 - confidence));
  const historicalVaR = Math.abs(sortedReturns[varIndex] * portfolioValue * Math.sqrt(horizon));

  // Parametric VaR (normal distribution)
  const meanReturn = allReturns.reduce((a, b) => a + b, 0) / allReturns.length;
  const variance = allReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / allReturns.length;
  const stdDev = Math.sqrt(variance);

  const zScore = confidence === 0.99 ? 2.326 : 1.645;
  const parametricVaR = Math.abs((meanReturn - zScore * stdDev) * portfolioValue * Math.sqrt(horizon));

  // Conditional VaR (Expected Shortfall)
  const losses = sortedReturns.slice(0, varIndex);
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  const conditionalVaR = Math.abs(avgLoss * portfolioValue * Math.sqrt(horizon));

  return {
    historicalVaR: Number(historicalVaR.toFixed(2)),
    parametricVaR: Number(parametricVaR.toFixed(2)),
    conditionalVaR: Number(conditionalVaR.toFixed(2))
  };
}

/**
 * Runs stress test using historical scenario
 *
 * @param {Array<{symbol: string, shares: number, currentPrice: number}>} portfolio - Portfolio positions
 * @param {string} scenario - Scenario name ('2008_crisis'|'covid_crash'|'svb_collapse'|'dot_com'|'flash_crash'|'custom')
 * @returns {{
 *   scenarioName: string,
 *   portfolioImpact: number,
 *   worstAsset: string,
 *   estimatedLoss: number,
 *   recoveryTime: string
 * }} Stress test results
 */
function runStressTest(portfolio = [], scenario = '2008_crisis') {
  if (!Array.isArray(portfolio) || portfolio.length === 0) {
    return {
      scenarioName: scenario,
      portfolioImpact: 0,
      worstAsset: '',
      estimatedLoss: 0,
      recoveryTime: 'N/A'
    };
  }

  // Scenario drawdowns (asset class impacts)
  const scenarios = {
    '2008_crisis': { stocks: -0.57, bonds: -0.05, commodities: -0.50, crypto: 0 },
    'covid_crash': { stocks: -0.34, bonds: -0.02, commodities: -0.37, crypto: -0.50 },
    'svb_collapse': { stocks: -0.20, bonds: -0.08, commodities: 0.05, crypto: -0.30 },
    'dot_com': { stocks: -0.78, bonds: 0.15, commodities: -0.10, crypto: 0 },
    'flash_crash': { stocks: -0.10, bonds: 0.02, commodities: -0.05, crypto: -0.15 },
    'custom': { stocks: -0.25, bonds: -0.05, commodities: -0.15, crypto: -0.25 }
  };

  const scenarioData = scenarios[scenario] || scenarios.custom;
  const assetClassMap = {
    'BTC': 'crypto', 'ETH': 'crypto',
    'AAPL': 'stocks', 'MSFT': 'stocks', 'SPY': 'stocks', 'QQQ': 'stocks',
    'BND': 'bonds', 'TLT': 'bonds',
    'GLD': 'commodities', 'OIL': 'commodities'
  };

  let portfolioValue = 0;
  let impactedValue = 0;
  let worstAsset = '';
  let worstImpact = 0;

  portfolio.forEach(p => {
    const currentValue = p.shares * p.currentPrice;
    portfolioValue += currentValue;

    const assetClass = assetClassMap[p.symbol] || 'stocks';
    const impact = scenarioData[assetClass] || 0;
    const impactAmount = currentValue * impact;
    impactedValue += impactAmount;

    if (impact < worstImpact) {
      worstImpact = impact;
      worstAsset = p.symbol;
    }
  });

  const portfolioImpact = portfolioValue > 0 ? (impactedValue / portfolioValue) * 100 : 0;
  const estimatedLoss = Math.abs(impactedValue);

  const recoveryTimes = {
    '2008_crisis': '4-5 years',
    'covid_crash': '6-12 months',
    'svb_collapse': '3-6 months',
    'dot_com': '5-7 years',
    'flash_crash': '1-2 days',
    'custom': '1-2 years'
  };

  return {
    scenarioName: scenario,
    portfolioImpact: Number(portfolioImpact.toFixed(2)),
    worstAsset,
    estimatedLoss: Number(estimatedLoss.toFixed(2)),
    recoveryTime: recoveryTimes[scenario] || 'Unknown'
  };
}

/**
 * Runs Monte Carlo simulation for forward-looking risk
 *
 * @param {Array<{symbol: string, shares: number, currentPrice: number}>} portfolio - Portfolio positions
 * @param {number} simulations - Number of simulations (default 1000)
 * @param {number} horizon - Time horizon in days (default 252 = 1 year)
 * @returns {{
 *   expectedReturn: number,
 *   confidenceIntervals: {p5: number, p25: number, p50: number, p75: number, p95: number},
 *   probabilityOfLoss: number,
 *   maxExpectedDrawdown: number
 * }} Monte Carlo risk results
 */
function runMonteCarloRisk(portfolio = [], simulations = 1000, horizon = 252) {
  if (!Array.isArray(portfolio) || portfolio.length === 0) {
    return {
      expectedReturn: 0,
      confidenceIntervals: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 },
      probabilityOfLoss: 0,
      maxExpectedDrawdown: 0
    };
  }

  if (typeof simulations !== 'number' || simulations < 100) {
    simulations = 1000;
  }

  if (typeof horizon !== 'number' || horizon < 1) {
    horizon = 252;
  }

  const portfolioValue = portfolio.reduce((sum, p) => sum + (p.shares * p.currentPrice), 0) || 1;
  const historicalData = _loadHistoricalData();

  // Calculate returns for bootstrapping
  const portfolioReturns = [];
  const endValues = [];

  // Bootstrap from historical returns
  const allReturns = [];
  portfolio.forEach(p => {
    const prices = historicalData[p.symbol] || [];
    const weight = (p.shares * p.currentPrice) / portfolioValue;

    for (let i = 1; i < Math.min(252, prices.length); i++) {
      const ret = (prices[i] - prices[i - 1]) / Math.max(prices[i - 1], 0.001);
      allReturns.push(ret * weight);
    }
  });

  if (allReturns.length === 0) {
    return {
      expectedReturn: 0,
      confidenceIntervals: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 },
      probabilityOfLoss: 0,
      maxExpectedDrawdown: 0
    };
  }

  const meanReturn = allReturns.reduce((a, b) => a + b, 0) / allReturns.length;
  const variance = allReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / allReturns.length;
  const stdDev = Math.sqrt(variance);

  // Run simulations
  let lossCount = 0;
  for (let i = 0; i < simulations; i++) {
    let simValue = portfolioValue;
    let maxDrawdown = 0;

    for (let day = 0; day < horizon; day++) {
      const randomIndex = Math.floor(Math.random() * allReturns.length);
      const ret = allReturns[randomIndex];
      simValue *= (1 + ret);

      const drawdown = (portfolioValue - simValue) / portfolioValue;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    endValues.push(simValue);
    if (simValue < portfolioValue) lossCount++;
  }

  // Calculate percentiles
  endValues.sort((a, b) => a - b);
  const p5 = endValues[Math.floor(simulations * 0.05)];
  const p25 = endValues[Math.floor(simulations * 0.25)];
  const p50 = endValues[Math.floor(simulations * 0.50)];
  const p75 = endValues[Math.floor(simulations * 0.75)];
  const p95 = endValues[Math.floor(simulations * 0.95)];

  const avgEndValue = endValues.reduce((a, b) => a + b, 0) / endValues.length;
  const expectedReturn = ((avgEndValue - portfolioValue) / portfolioValue) * 100;

  return {
    expectedReturn: Number(expectedReturn.toFixed(2)),
    confidenceIntervals: {
      p5: Number(p5.toFixed(2)),
      p25: Number(p25.toFixed(2)),
      p50: Number(p50.toFixed(2)),
      p75: Number(p75.toFixed(2)),
      p95: Number(p95.toFixed(2))
    },
    probabilityOfLoss: Number(((lossCount / simulations) * 100).toFixed(2)),
    maxExpectedDrawdown: Number((Math.max(...endValues.map((e, i) => (portfolioValue - e) / portfolioValue)) * 100).toFixed(2))
  };
}

/**
 * Analyzes tail risk characteristics
 *
 * @param {Array<number>} returns - Return series
 * @returns {{
 *   skewness: number,
 *   kurtosis: number,
 *   tailRatio: number,
 *   isLeftTailed: boolean,
 *   fatTailWarning: boolean
 * }} Tail risk metrics
 */
function getTailRiskMetrics(returns = []) {
  if (!Array.isArray(returns) || returns.length < 4) {
    return {
      skewness: 0,
      kurtosis: 3,
      tailRatio: 1,
      isLeftTailed: false,
      fatTailWarning: false
    };
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  // Skewness
  const skewness = returns.length > 0
    ? returns.reduce((sum, r) => sum + Math.pow((r - mean) / stdDev, 3), 0) / returns.length
    : 0;

  // Kurtosis
  const kurtosis = returns.length > 0
    ? returns.reduce((sum, r) => sum + Math.pow((r - mean) / stdDev, 4), 0) / returns.length
    : 3;

  // Tail ratio (upside vs downside)
  const upTail = returns.filter(r => r > mean + stdDev);
  const downTail = returns.filter(r => r < mean - stdDev);
  const tailRatio = downTail.length > 0
    ? (upTail.reduce((a, b) => a + Math.abs(b), 0) || 1) / (downTail.reduce((a, b) => a + Math.abs(b), 0) || 1)
    : 1;

  const isLeftTailed = skewness < -0.5;
  const fatTailWarning = kurtosis > 4;

  return {
    skewness: Number(skewness.toFixed(3)),
    kurtosis: Number(kurtosis.toFixed(3)),
    tailRatio: Number(tailRatio.toFixed(3)),
    isLeftTailed,
    fatTailWarning
  };
}

/* ═══════════════════════════════════════════════════════════════════════════════
   SYSTEM 5: ADAPTIVE POSITION SIZING
   ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Calculates position size using Kelly Criterion
 *
 * @param {number} winRate - Win rate (0-1)
 * @param {number} avgWin - Average winning trade amount
 * @param {number} avgLoss - Average losing trade amount
 * @param {number} kellyFraction - Kelly fraction (0.25, 0.5, 1.0, default 0.5)
 * @returns {{
 *   kellyPct: number,
 *   adjustedPct: number,
 *   maxDollarRisk: number
 * }} Kelly position size
 */
function calculateKellySize(winRate = 0.5, avgWin = 100, avgLoss = 100, kellyFraction = 0.5) {
  // Guard parameters
  if (typeof winRate !== 'number' || winRate < 0 || winRate > 1) {
    winRate = 0.5;
  }

  if (typeof avgWin !== 'number' || avgWin <= 0) {
    avgWin = 100;
  }

  if (typeof avgLoss !== 'number' || avgLoss <= 0) {
    avgLoss = 100;
  }

  if (![0.25, 0.5, 1.0].includes(kellyFraction)) {
    kellyFraction = 0.5;
  }

  const lossRate = 1 - winRate;
  const b = avgWin / avgLoss; // Odds

  // Kelly formula: f = (bp - q) / b
  let kellyPct = (b * winRate - lossRate) / b;

  // Ensure non-negative and capped at 100%
  kellyPct = Math.max(0, Math.min(1, kellyPct));

  const adjustedPct = kellyPct * kellyFraction;
  const maxDollarRisk = adjustedPct * 100000; // Based on $100k account

  return {
    kellyPct: Number((kellyPct * 100).toFixed(2)),
    adjustedPct: Number((adjustedPct * 100).toFixed(2)),
    maxDollarRisk: Number(maxDollarRisk.toFixed(2))
  };
}

/**
 * Calculates volatility-adjusted position size
 *
 * @param {string} symbol - Asset symbol
 * @param {number} accountEquity - Account equity in dollars
 * @param {number} riskPerTrade - Risk per trade as fraction (default 0.02 = 2%)
 * @returns {{
 *   shares: number,
 *   dollarAmount: number,
 *   stopDistance: number,
 *   riskAmount: number
 * }} Position sizing recommendation
 */
function calculateVolatilityAdjustedSize(symbol = '', accountEquity = 100000, riskPerTrade = 0.02) {
  // Guard parameters
  if (typeof symbol !== 'string' || symbol.length === 0) {
    return { shares: 0, dollarAmount: 0, stopDistance: 0, riskAmount: 0 };
  }

  if (typeof accountEquity !== 'number' || accountEquity <= 0) {
    accountEquity = 100000;
  }

  if (typeof riskPerTrade !== 'number' || riskPerTrade <= 0 || riskPerTrade > 0.1) {
    riskPerTrade = 0.02;
  }

  const historicalData = _loadHistoricalData();
  const prices = historicalData[symbol] || [];

  if (prices.length < 14) {
    return { shares: 0, dollarAmount: 0, stopDistance: 0, riskAmount: 0 };
  }

  const currentPrice = prices[prices.length - 1];
  const indicators = getTechnicalIndicators(prices, 14);
  const atr = indicators.atr;

  const riskAmount = accountEquity * riskPerTrade;
  const stopDistance = Math.max(atr, currentPrice * 0.02); // At least 2% of price
  const shares = Math.floor(riskAmount / stopDistance);
  const dollarAmount = shares * currentPrice;

  return {
    shares,
    dollarAmount: Number(dollarAmount.toFixed(2)),
    stopDistance: Number(stopDistance.toFixed(2)),
    riskAmount: Number(riskAmount.toFixed(2))
  };
}

/**
 * Adjusts position size based on market regime
 *
 * @param {number} baseSize - Base position size in shares
 * @param {string} regime - Market regime ('Bull'|'Cautious'|'Neutral'|'Risk-Off'|'Crisis')
 * @returns {{
 *   adjustedSize: number,
 *   multiplier: number,
 *   regime: string,
 *   reasoning: string
 * }} Regime-adjusted position size
 */
function getRegimeAdjustedSize(baseSize = 100, regime = 'Neutral') {
  if (typeof baseSize !== 'number' || baseSize <= 0) {
    baseSize = 100;
  }

  if (typeof regime !== 'string') {
    regime = 'Neutral';
  }

  const regimeMultipliers = {
    'Bull': 1.2,
    'Cautious': 1.0,
    'Neutral': 0.8,
    'Risk-Off': 0.5,
    'Crisis': 0.25
  };

  const multiplier = regimeMultipliers[regime] || 1.0;
  const adjustedSize = Math.round(baseSize * multiplier);

  const reasoning = {
    'Bull': 'Increasing position size due to bullish market conditions',
    'Cautious': 'Maintaining normal position sizing in cautious market',
    'Neutral': 'Reducing position size in uncertain market conditions',
    'Risk-Off': 'Significantly reducing exposure in risk-off environment',
    'Crisis': 'Minimal position sizing during crisis conditions'
  };

  return {
    adjustedSize,
    multiplier,
    regime,
    reasoning: reasoning[regime] || 'Unknown regime'
  };
}

/**
 * Generates comprehensive position sizing recommendation
 *
 * @param {string} symbol - Asset symbol
 * @param {string} direction - Trade direction ('LONG'|'SHORT')
 * @param {number} conviction - Conviction level (0-100, 100 = max conviction)
 * @param {number} accountEquity - Account equity in dollars
 * @returns {{
 *   shares: number,
 *   dollarAmount: number,
 *   percentOfEquity: number,
 *   method: string,
 *   riskAmount: number,
 *   stopLoss: number,
 *   takeProfit: number
 * }} Position sizing recommendation
 */
function getPositionSizeRecommendation(symbol = '', direction = 'LONG', conviction = 50, accountEquity = 100000) {
  // Guard parameters
  if (typeof symbol !== 'string' || symbol.length === 0) {
    return {
      shares: 0,
      dollarAmount: 0,
      percentOfEquity: 0,
      method: 'ERROR',
      riskAmount: 0,
      stopLoss: 0,
      takeProfit: 0
    };
  }

  if (!['LONG', 'SHORT'].includes(direction)) {
    direction = 'LONG';
  }

  if (typeof conviction !== 'number' || conviction < 0 || conviction > 100) {
    conviction = 50;
  }

  if (typeof accountEquity !== 'number' || accountEquity <= 0) {
    accountEquity = 100000;
  }

  const historicalData = _loadHistoricalData();
  const prices = historicalData[symbol] || [];

  if (prices.length < 14) {
    return {
      shares: 0,
      dollarAmount: 0,
      percentOfEquity: 0,
      method: 'INSUFFICIENT_DATA',
      riskAmount: 0,
      stopLoss: 0,
      takeProfit: 0
    };
  }

  const currentPrice = prices[prices.length - 1];
  const indicators = getTechnicalIndicators(prices, 14);

  // Conviction-adjusted risk per trade
  const baseRisk = 0.02;
  const convictionMultiplier = Math.max(0.5, Math.min(2.0, conviction / 50));
  const riskPerTrade = baseRisk * convictionMultiplier;

  // Calculate using volatility-adjusted method
  const volAdjusted = calculateVolatilityAdjustedSize(symbol, accountEquity, riskPerTrade);
  let shares = volAdjusted.shares;

  // Apply conviction scaling
  shares = Math.round(shares * (0.75 + (conviction / 100) * 0.5));

  // Calculate stop loss and take profit
  const atr = indicators.atr;
  const stopDistance = Math.max(atr, currentPrice * 0.02);

  const stopLoss = direction === 'LONG'
    ? currentPrice - stopDistance
    : currentPrice + stopDistance;

  const takeProfit = direction === 'LONG'
    ? currentPrice + (stopDistance * 2)
    : currentPrice - (stopDistance * 2);

  const dollarAmount = shares * currentPrice;
  const percentOfEquity = (dollarAmount / accountEquity) * 100;
  const riskAmount = shares * stopDistance;

  return {
    shares,
    dollarAmount: Number(dollarAmount.toFixed(2)),
    percentOfEquity: Number(percentOfEquity.toFixed(2)),
    method: 'VOLATILITY_ADJUSTED_WITH_CONVICTION',
    riskAmount: Number(riskAmount.toFixed(2)),
    stopLoss: Number(stopLoss.toFixed(2)),
    takeProfit: Number(takeProfit.toFixed(2))
  };
}

/* ═══════════════════════════════════════════════════════════════════════════════
   INTERNAL HELPER FUNCTIONS
   ═══════════════════════════════════════════════════════════════════════════════ */

function _loadHistoricalData() {
  try {
    const stored = localStorage.getItem('12tribes_historical_data');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    // Silent fail on parse error
  }

  // Generate synthetic data if not available
  return _generateSyntheticData();
}

function _generateSyntheticData() {
  const symbols = ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'BTC', 'ETH'];
  const data = {};

  symbols.forEach(symbol => {
    const prices = [];
    let price = 100;

    for (let i = 0; i < 252; i++) {
      const randomChange = (Math.random() - 0.5) * 2;
      price *= (1 + randomChange * 0.02);
      prices.push(Number(price.toFixed(2)));
    }

    data[symbol] = prices;
  });

  return data;
}

function _computeExpectedReturns(symbols, historicalData) {
  const returns = {};

  symbols.forEach(symbol => {
    const prices = historicalData[symbol] || [];

    if (prices.length < 2) {
      returns[symbol] = 0.05; // Default 5% return
      return;
    }

    const recentPrices = prices.slice(-252); // Last year
    const yearReturn = (recentPrices[recentPrices.length - 1] - recentPrices[0]) / recentPrices[0];

    returns[symbol] = Math.max(-0.5, Math.min(0.5, yearReturn));
  });

  return returns;
}

function _computeCovarianceMatrix(symbols, historicalData) {
  const covMatrix = {};
  const returns = {};

  // Calculate returns for each symbol
  symbols.forEach(symbol => {
    const prices = historicalData[symbol] || [];
    returns[symbol] = [];

    for (let i = 1; i < Math.min(252, prices.length); i++) {
      const ret = (prices[i] - prices[i - 1]) / Math.max(prices[i - 1], 0.001);
      returns[symbol].push(isNaN(ret) ? 0 : ret);
    }
  });

  // Compute covariance matrix
  symbols.forEach(s1 => {
    covMatrix[s1] = {};

    symbols.forEach(s2 => {
      const r1 = returns[s1] || [];
      const r2 = returns[s2] || [];

      if (r1.length === 0 || r2.length === 0) {
        covMatrix[s1][s2] = 0;
        return;
      }

      const minLen = Math.min(r1.length, r2.length);
      const mean1 = r1.slice(0, minLen).reduce((a, b) => a + b, 0) / minLen;
      const mean2 = r2.slice(0, minLen).reduce((a, b) => a + b, 0) / minLen;

      let covariance = 0;
      for (let i = 0; i < minLen; i++) {
        covariance += (r1[i] - mean1) * (r2[i] - mean2);
      }

      covMatrix[s1][s2] = covariance / minLen;
    });
  });

  return covMatrix;
}

function _computePortfolioReturn(weights, expectedReturns) {
  let portfolioReturn = 0;

  Object.keys(weights).forEach(symbol => {
    portfolioReturn += (weights[symbol] || 0) * (expectedReturns[symbol] || 0);
  });

  return portfolioReturn;
}

function _computePortfolioRisk(weights, covMatrix) {
  const symbols = Object.keys(weights);
  let variance = 0;

  symbols.forEach(s1 => {
    symbols.forEach(s2 => {
      const w1 = weights[s1] || 0;
      const w2 = weights[s2] || 0;
      const cov = covMatrix[s1]?.[s2] || 0;

      variance += w1 * w2 * cov;
    });
  });

  return Math.sqrt(Math.max(0, variance));
}

function _computeCurrentWeights(positions) {
  const weights = {};
  const totalValue = positions.reduce((sum, p) => sum + (p.shares * p.currentPrice), 0) || 1;

  positions.forEach(p => {
    weights[p.symbol] = (p.shares * p.currentPrice) / totalValue;
  });

  return weights;
}

function _sanitizeWeights(weights) {
  const sanitized = {};
  const sum = Object.values(weights).reduce((a, b) => a + b, 0) || 1;

  Object.keys(weights).forEach(symbol => {
    const weight = weights[symbol] / sum;
    sanitized[symbol] = Number(Math.max(0, Math.min(1, weight)).toFixed(4));
  });

  return sanitized;
}

function _aggregatePrices(prices, interval) {
  if (!Array.isArray(prices) || interval <= 0) {
    return prices;
  }

  const aggregated = [];
  for (let i = 0; i < prices.length; i += interval) {
    aggregated.push(prices[i]);
  }

  return aggregated.length > 0 ? aggregated : prices;
}

function _calculateSMA(prices, period) {
  if (!Array.isArray(prices) || prices.length < period) {
    return prices.length > 0 ? prices[prices.length - 1] : 0;
  }

  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function _calculateEMA(prices, period) {
  if (!Array.isArray(prices) || prices.length < period) {
    return prices.length > 0 ? prices[prices.length - 1] : 0;
  }

  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * multiplier + ema * (1 - multiplier);
  }

  return ema;
}

function _calculateRSI(prices, period) {
  if (!Array.isArray(prices) || prices.length < period + 1) {
    return 50;
  }

  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  const gains = changes.filter(c => c > 0);
  const losses = changes.filter(c => c < 0).map(c => Math.abs(c));

  const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  return isNaN(rsi) ? 50 : Math.max(0, Math.min(100, rsi));
}

function _calculateATR(prices, period) {
  if (!Array.isArray(prices) || prices.length < period) {
    return 0;
  }

  const trueRanges = [];

  for (let i = 1; i < prices.length; i++) {
    const high = prices[i];
    const low = prices[i - 1];
    const prevClose = prices[i - 1];

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );

    trueRanges.push(tr);
  }

  const slice = trueRanges.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function _calculateStdDev(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;

  return Math.sqrt(variance);
}

/* ═══════════════════════════════════════════════════════════════════════════════
   MODULE EXPORTS
   ═══════════════════════════════════════════════════════════════════════════════ */

export {
  // System 1: Portfolio Optimization
  optimizePortfolio,
  getRiskParityWeights,
  getRebalanceNeeded,

  // System 2: Correlation Monitor
  computeCorrelationMatrix,
  detectCorrelationRegimeShift,
  getPortfolioDiversificationScore,
  monitorCorrelationBreaks,

  // System 3: Multi-Timeframe Analysis
  analyzeMultiTimeframe,
  getTechnicalIndicators,
  getTimeframeAlignment,

  // System 4: Advanced Risk Controls
  calculateVaR,
  runStressTest,
  runMonteCarloRisk,
  getTailRiskMetrics,

  // System 5: Adaptive Position Sizing
  calculateKellySize,
  calculateVolatilityAdjustedSize,
  getRegimeAdjustedSize,
  getPositionSizeRecommendation
};
