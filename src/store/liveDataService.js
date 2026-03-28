/**
 * Live Market Data Integration Service
 *
 * Provides realistic simulation of live market data feeds including stocks, crypto, and forex.
 * Implements geometric Brownian motion price movements, market session awareness, realistic
 * events (earnings surprises, flash crashes), and correlation modeling.
 *
 * @module liveDataService
 * @requires localStorage for persistence
 */

// ============================================================================
// INITIALIZATION & STATE MANAGEMENT
// ============================================================================

let dataServiceState = {
  isRunning: false,
  feeds: {},
  subscribers: {},
  priceCache: {},
  candleCache: {},
  correlationMatrix: {},
  lastUpdate: 0,
  tickCount: 0,
  sessionStartTime: Date.now(),
};

const STORAGE_KEY = '12tribes_live_data_cache';
const TICK_INTERVAL_MS = 250; // 4 ticks per second for realistic cadence
let tickIntervalId = null;

// Market session definitions (ET timezone)
const MARKET_SESSIONS = {
  US_STOCKS: {
    name: 'US Stocks',
    open: { hour: 9, minute: 30 },
    close: { hour: 16, minute: 0 },
    preMarket: { open: { hour: 4, minute: 0 }, close: { hour: 9, minute: 30 } },
    afterHours: { open: { hour: 16, minute: 0 }, close: { hour: 20, minute: 0 } },
    daysOfWeek: [1, 2, 3, 4, 5], // Monday-Friday
  },
  CRYPTO: {
    name: 'Cryptocurrency',
    open: { hour: 0, minute: 0 },
    close: { hour: 23, minute: 59 },
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6], // All days
  },
  FOREX: {
    name: 'Forex',
    open: { hour: 17, minute: 0 },
    close: { hour: 16, minute: 59 },
    dayOfWeekOpen: 0, // Sunday 5pm ET
    dayOfWeekClose: 5, // Friday 5pm ET
    daysOfWeek: [0, 1, 2, 3, 4, 5], // Sunday-Friday
  },
};

// Asset configuration with realistic parameters
const ASSET_CONFIG = {
  AAPL: { type: 'stock', basePrice: 185.50, volatility: 0.18, sessionKey: 'US_STOCKS', sector: 'tech' },
  MSFT: { type: 'stock', basePrice: 425.75, volatility: 0.16, sessionKey: 'US_STOCKS', sector: 'tech' },
  NVDA: { type: 'stock', basePrice: 875.30, volatility: 0.28, sessionKey: 'US_STOCKS', sector: 'tech' },
  TSLA: { type: 'stock', basePrice: 238.45, volatility: 0.35, sessionKey: 'US_STOCKS', sector: 'tech' },
  JPM: { type: 'stock', basePrice: 198.20, volatility: 0.20, sessionKey: 'US_STOCKS', sector: 'finance' },
  XOM: { type: 'stock', basePrice: 105.80, volatility: 0.22, sessionKey: 'US_STOCKS', sector: 'energy' },
  GLD: { type: 'stock', basePrice: 184.50, volatility: 0.12, sessionKey: 'US_STOCKS', sector: 'commodity' },

  BTC: { type: 'crypto', basePrice: 52400, volatility: 0.65, sessionKey: 'CRYPTO', correlation: 'leader' },
  ETH: { type: 'crypto', basePrice: 2850, volatility: 0.72, sessionKey: 'CRYPTO', correlation: 'btc' },
  ADA: { type: 'crypto', basePrice: 0.98, volatility: 0.85, sessionKey: 'CRYPTO', correlation: 'btc' },

  EURUSD: { type: 'forex', basePrice: 1.0850, volatility: 0.08, sessionKey: 'FOREX', pair: 'EUR/USD' },
  GBPUSD: { type: 'forex', basePrice: 1.2650, volatility: 0.10, sessionKey: 'FOREX', pair: 'GBP/USD' },
  USDJPY: { type: 'forex', basePrice: 149.50, volatility: 0.09, sessionKey: 'FOREX', pair: 'USD/JPY' },
};

// ============================================================================
// MATHEMATICAL UTILITIES
// ============================================================================

/**
 * Generate random number from standard normal distribution using Box-Muller
 * @returns {number} Random value ~ N(0,1)
 */
function standardNormalRandom() {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Geometric Brownian Motion step for price evolution
 * dS = mu*S*dt + sigma*S*dW
 * @param {number} currentPrice
 * @param {number} drift - annualized drift (mu)
 * @param {number} volatility - annualized volatility (sigma)
 * @param {number} dt - time step as fraction of year
 * @returns {number} New price
 */
function gbmStep(currentPrice, drift, volatility, dt) {
  const dW = standardNormalRandom() * Math.sqrt(dt);
  const exponent = (drift - (volatility * volatility) / 2) * dt + volatility * dW;
  return currentPrice * Math.exp(exponent);
}

/**
 * Calculate correlation coefficient between two series
 * @param {number[]} x
 * @param {number[]} y
 * @returns {number} Correlation in range [-1, 1]
 */
function calculateCorrelation(x, y) {
  if (x.length === 0 || x.length !== y.length) return 0;
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b) / n;
  const meanY = y.reduce((a, b) => a + b) / n;

  let numerator = 0;
  let sumSqX = 0;
  let sumSqY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    sumSqX += dx * dx;
    sumSqY += dy * dy;
  }

  const denominator = Math.sqrt(sumSqX * sumSqY);
  return denominator === 0 ? 0 : numerator / denominator;
}

// ============================================================================
// SESSION & TIME UTILITIES
// ============================================================================

/**
 * Get current time in ET timezone
 * @returns {object} { hours, minutes, dayOfWeek, date }
 */
function getCurrentETTime() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });

  const parts = formatter.formatToParts(now);
  const partsByName = {};
  parts.forEach(part => {
    partsByName[part.type] = part.value;
  });

  const hour = parseInt(partsByName.hour, 10);
  const minute = parseInt(partsByName.minute, 10);
  const dayMap = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
  const dayOfWeek = dayMap[partsByName.weekday] || 0;

  return { hour, minute, dayOfWeek, date: now };
}

/**
 * Check if market session is currently open
 * @param {string} sessionKey - Key like 'US_STOCKS', 'CRYPTO', 'FOREX'
 * @returns {boolean}
 */
function isSessionOpen(sessionKey) {
  const session = MARKET_SESSIONS[sessionKey];
  if (!session) return true;

  const et = getCurrentETTime();
  const timeInMinutes = et.hour * 60 + et.minute;
  const openTime = session.open.hour * 60 + session.open.minute;
  const closeTime = session.close.hour * 60 + session.close.minute;

  // Handle sessions that span midnight
  if (openTime > closeTime) {
    return timeInMinutes >= openTime || timeInMinutes <= closeTime;
  }

  const isCorrectDay = session.daysOfWeek.includes(et.dayOfWeek);
  return isCorrectDay && timeInMinutes >= openTime && timeInMinutes <= closeTime;
}

/**
 * Get session volatility multiplier (reduced outside market hours)
 * @param {string} sessionKey
 * @returns {number} Multiplier (0.3-1.0)
 */
function getSessionVolatilityMultiplier(sessionKey) {
  const et = getCurrentETTime();
  const timeInMinutes = et.hour * 60 + et.minute;

  // Pre-market/after-hours reduced volatility
  if (sessionKey === 'US_STOCKS') {
    const preMarketOpen = 4 * 60; // 4am
    const preMarketClose = 9.5 * 60; // 9:30am
    const afterHoursOpen = 16 * 60; // 4pm
    const afterHoursClose = 20 * 60; // 8pm

    if ((timeInMinutes >= preMarketOpen && timeInMinutes < preMarketClose) ||
        (timeInMinutes >= afterHoursOpen && timeInMinutes <= afterHoursClose)) {
      return 0.35;
    }
  }

  return isSessionOpen(sessionKey) ? 1.0 : 0.3;
}

// ============================================================================
// FEED MANAGEMENT
// ============================================================================

/**
 * Initialize a data feed for a symbol
 * @param {string} symbol
 * @param {object} config - Asset configuration
 */
function initializeFeed(symbol, config) {
  if (dataServiceState.feeds[symbol]) return;

  const now = Date.now();
  dataServiceState.feeds[symbol] = {
    symbol,
    type: config.type,
    sessionKey: config.sessionKey,
    volatility: config.volatility,
    basePrice: config.basePrice,
    currentPrice: config.basePrice,
    open: config.basePrice,
    high: config.basePrice,
    low: config.basePrice,
    close: config.basePrice,
    bid: config.basePrice - 0.01,
    ask: config.basePrice + 0.01,
    volume: 0,
    lastTick: now,
    lastChange: 0,
    trend: 0, // -1, 0, or 1 for down, neutral, up
    earnedEventToday: false,
    lastEarningsPriceImpact: 0,
    dayOpen: config.basePrice,
    dailyPriceHistory: [config.basePrice],
    correlationData: [config.basePrice],
  };

  initializeCandleData(symbol);
}

/**
 * Initialize candle data structures for multiple timeframes
 * @param {string} symbol
 */
function initializeCandleData(symbol) {
  const timeframes = ['1m', '5m', '15m', '1h', '1d'];
  dataServiceState.candleCache[symbol] = {};

  timeframes.forEach(tf => {
    dataServiceState.candleCache[symbol][tf] = [];
  });
}

/**
 * Get all initialized feeds
 * @returns {object}
 */
function getFeeds() {
  return dataServiceState.feeds;
}

// ============================================================================
// PRICE TICK ENGINE
// ============================================================================

/**
 * Process one tick for a symbol, updating price via GBM
 * @param {string} symbol
 */
function tickSymbol(symbol) {
  const feed = dataServiceState.feeds[symbol];
  if (!feed) return;

  const config = ASSET_CONFIG[symbol];
  const dt = TICK_INTERVAL_MS / (1000 * 60 * 60 * 252); // Convert to annual fraction

  // Determine drift based on session and trend
  let drift = 0.05; // Base 5% annual drift
  if (!isSessionOpen(feed.sessionKey)) {
    drift = 0.0; // No drift outside hours
  }

  // Trend persistence
  if (feed.trend !== 0) {
    drift += feed.trend * 0.10; // Trend adds ±10% drift
  }

  // Volatility adjustment for session
  const volMultiplier = getSessionVolatilityMultiplier(feed.sessionKey);
  const adjustedVolatility = feed.volatility * volMultiplier;

  // Check for earnings surprise event (2% chance per trading day)
  const earningsChance = 0.02 * (TICK_INTERVAL_MS / (6.5 * 60 * 60 * 1000)); // Per day probability
  if (!feed.earnedEventToday && Math.random() < earningsChance && config.type === 'stock') {
    const surpriseGap = (Math.random() - 0.5) * 0.10; // -5% to +5%
    feed.lastEarningsPriceImpact = surpriseGap;
    feed.earnedEventToday = true;
    feed.currentPrice *= (1 + surpriseGap);
  }

  // Check for crypto flash crash (0.5% chance per hour)
  if (config.type === 'crypto') {
    const flashChance = 0.005 * (TICK_INTERVAL_MS / (60 * 60 * 1000));
    if (Math.random() < flashChance) {
      const crashDepth = -0.05 - Math.random() * 0.10; // -5% to -15%
      feed.currentPrice *= (1 + crashDepth);
      feed.trend = -1; // Bias downward briefly
    }
  }

  // Apply GBM step
  const newPrice = gbmStep(feed.currentPrice, drift, adjustedVolatility, dt);
  const priceChange = newPrice - feed.currentPrice;

  // Update price and bounds
  feed.currentPrice = newPrice;
  feed.close = newPrice;
  feed.high = Math.max(feed.high, newPrice);
  feed.low = Math.min(feed.low, newPrice);
  feed.lastChange = priceChange;

  // Update bid/ask spread (tighter for liquid, wider for illiquid)
  const spreadBps = config.type === 'crypto' ? 15 : (config.type === 'stock' ? 5 : 2);
  const spreadAmount = (newPrice * spreadBps) / 10000;
  feed.bid = newPrice - spreadAmount / 2;
  feed.ask = newPrice + spreadAmount / 2;

  // Update volume (higher at open/close for stocks)
  const baseVolume = config.type === 'crypto' ? Math.random() * 1000000 : Math.random() * 500000;
  const et = getCurrentETTime();
  const isOpenOrClose = (et.hour === 9 && et.minute < 45) || (et.hour === 15 && et.minute > 45);
  feed.volume = baseVolume * (isOpenOrClose && config.type === 'stock' ? 2.0 : 1.0);

  // Update trend (mean reversion with persistence)
  feed.trend = Math.max(-1, Math.min(1, feed.trend + (Math.random() - 0.5) * 0.3));

  // Reset daily tracking at market open
  const etTime = getCurrentETTime();
  if (etTime.hour === 9 && etTime.minute === 30) {
    feed.dayOpen = feed.currentPrice;
    feed.earnedEventToday = false;
    feed.lastEarningsPriceImpact = 0;
  }

  // Store price for correlation tracking
  feed.dailyPriceHistory.push(feed.currentPrice);
  if (feed.dailyPriceHistory.length > 1440) { // Keep 1 day of 1-min data
    feed.dailyPriceHistory.shift();
  }
}

/**
 * Main tick function called every TICK_INTERVAL_MS
 */
function processTick() {
  const now = Date.now();
  dataServiceState.lastUpdate = now;
  dataServiceState.tickCount += 1;

  // Tick all feeds
  Object.keys(dataServiceState.feeds).forEach(symbol => {
    tickSymbol(symbol);
  });

  // Update candles
  updateCandles();

  // Persist state
  persistState();

  // Call subscribers
  notifySubscribers();
}

/**
 * Update OHLCV candles for all timeframes
 */
function updateCandles() {
  Object.keys(dataServiceState.feeds).forEach(symbol => {
    const feed = dataServiceState.feeds[symbol];
    const candles = dataServiceState.candleCache[symbol];

    // Generate candles at appropriate intervals
    const timeframes = ['1m', '5m', '15m', '1h', '1d'];
    timeframes.forEach(tf => {
      const intervalMinutes = {
        '1m': 1,
        '5m': 5,
        '15m': 15,
        '1h': 60,
        '1d': 1440,
      }[tf];

      if (!candles[tf]) candles[tf] = [];

      const now = Date.now();
      const lastCandle = candles[tf][candles[tf].length - 1];
      const shouldCreateNewCandle = !lastCandle ||
        (now - lastCandle.timestamp) > (intervalMinutes * 60 * 1000);

      if (shouldCreateNewCandle) {
        candles[tf].push({
          timestamp: now,
          open: feed.dayOpen,
          high: feed.high,
          low: feed.low,
          close: feed.close,
          volume: feed.volume,
        });

        // Keep rolling window
        if (candles[tf].length > 1000) {
          candles[tf].shift();
        }
      }
    });
  });
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Initialize the live data service
 * @returns {void}
 */
export function initLiveDataService() {
  if (dataServiceState.isRunning) return;

  // Load persisted state
  loadState();

  // Initialize feeds for all configured assets
  Object.entries(ASSET_CONFIG).forEach(([symbol, config]) => {
    initializeFeed(symbol, config);
  });

  // Start tick engine
  dataServiceState.isRunning = true;
  tickIntervalId = setInterval(processTick, TICK_INTERVAL_MS);
}

/**
 * Stop the live data service
 * @returns {void}
 */
export function stopLiveDataService() {
  if (!dataServiceState.isRunning) return;

  dataServiceState.isRunning = false;
  if (tickIntervalId) {
    clearInterval(tickIntervalId);
    tickIntervalId = null;
  }

  persistState();
}

/**
 * Get real-time price for a symbol
 * @param {string} symbol
 * @returns {object} { price, bid, ask, change, changePct, volume, high, low, timestamp, dayOpen }
 */
export function getRealtimePrice(symbol) {
  const feed = dataServiceState.feeds[symbol];
  if (!feed) return null;

  const changePct = feed.dayOpen > 0 ? ((feed.currentPrice - feed.dayOpen) / feed.dayOpen) * 100 : 0;

  return {
    symbol,
    price: parseFloat(feed.currentPrice.toFixed(4)),
    bid: parseFloat(feed.bid.toFixed(4)),
    ask: parseFloat(feed.ask.toFixed(4)),
    change: parseFloat((feed.currentPrice - feed.dayOpen).toFixed(4)),
    changePct: parseFloat(changePct.toFixed(2)),
    volume: Math.floor(feed.volume),
    high: parseFloat(feed.high.toFixed(4)),
    low: parseFloat(feed.low.toFixed(4)),
    dayOpen: parseFloat(feed.dayOpen.toFixed(4)),
    timestamp: dataServiceState.lastUpdate,
  };
}

/**
 * Get OHLCV candle data
 * @param {string} symbol
 * @param {string} timeframe - '1m', '5m', '15m', '1h', '1d'
 * @param {number} bars - Number of bars to return
 * @returns {array} Array of { open, high, low, close, volume, timestamp }
 */
export function getOHLCV(symbol, timeframe, bars = 100) {
  const candles = dataServiceState.candleCache[symbol];
  if (!candles || !candles[timeframe]) return [];

  return candles[timeframe].slice(-bars).map(candle => ({
    open: parseFloat(candle.open.toFixed(4)),
    high: parseFloat(candle.high.toFixed(4)),
    low: parseFloat(candle.low.toFixed(4)),
    close: parseFloat(candle.close.toFixed(4)),
    volume: Math.floor(candle.volume),
    timestamp: candle.timestamp,
  }));
}

/**
 * Get simulated market depth (order book)
 * @param {string} symbol
 * @returns {object} { bids: [{price, size}], asks: [{price, size}] }
 */
export function getMarketDepth(symbol) {
  const feed = dataServiceState.feeds[symbol];
  if (!feed) return { bids: [], asks: [] };

  const midPrice = (feed.bid + feed.ask) / 2;
  const spreadPct = ((feed.ask - feed.bid) / midPrice) * 100;

  // Generate synthetic order book
  const bids = [];
  const asks = [];

  for (let i = 1; i <= 10; i++) {
    const bidPrice = midPrice - (spreadPct / 100) * midPrice * (i / 10);
    const askPrice = midPrice + (spreadPct / 100) * midPrice * (i / 10);
    const size = Math.random() * 10000 + 1000;

    bids.push({
      price: parseFloat(bidPrice.toFixed(4)),
      size: Math.floor(size),
    });
    asks.push({
      price: parseFloat(askPrice.toFixed(4)),
      size: Math.floor(size),
    });
  }

  return { bids: bids.reverse(), asks };
}

/**
 * Subscribe to real-time price updates for a symbol
 * @param {string} symbol
 * @param {function} callback - Called with price data on each tick
 * @returns {function} Unsubscribe function
 */
export function subscribeToPrice(symbol, callback) {
  if (!dataServiceState.subscribers[symbol]) {
    dataServiceState.subscribers[symbol] = [];
  }

  dataServiceState.subscribers[symbol].push(callback);

  // Return unsubscribe function
  return () => {
    const index = dataServiceState.subscribers[symbol].indexOf(callback);
    if (index > -1) {
      dataServiceState.subscribers[symbol].splice(index, 1);
    }
  };
}

/**
 * Notify all subscribers of price updates
 */
function notifySubscribers() {
  Object.entries(dataServiceState.subscribers).forEach(([symbol, callbacks]) => {
    const priceData = getRealtimePrice(symbol);
    if (priceData) {
      callbacks.forEach(callback => {
        try {
          callback(priceData);
        } catch (err) {
          console.error(`Error in price callback for ${symbol}:`, err);
        }
      });
    }
  });
}

/**
 * Get current market session status
 * @returns {object} Session open/closed status for each market
 */
export function getMarketStatus() {
  return {
    us_stocks: isSessionOpen('US_STOCKS'),
    crypto: isSessionOpen('CRYPTO'),
    forex: isSessionOpen('FOREX'),
    currentETTime: getCurrentETTime(),
  };
}

/**
 * Get correlation matrix for a set of symbols
 * @param {array} symbols
 * @returns {object} Correlation coefficients keyed by symbol pair
 */
export function getCorrelationMatrix(symbols) {
  const correlations = {};

  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const sym1 = symbols[i];
      const sym2 = symbols[j];
      const feed1 = dataServiceState.feeds[sym1];
      const feed2 = dataServiceState.feeds[sym2];

      if (feed1 && feed2) {
        const corr = calculateCorrelation(
          feed1.dailyPriceHistory,
          feed2.dailyPriceHistory
        );
        correlations[`${sym1}/${sym2}`] = parseFloat(corr.toFixed(3));
      }
    }
  }

  return correlations;
}

/**
 * Manually trigger an earnings surprise event for a stock
 * @param {string} symbol
 * @returns {object} Impact details
 */
export function simulateEarningsSurprise(symbol) {
  const feed = dataServiceState.feeds[symbol];
  if (!feed || ASSET_CONFIG[symbol].type !== 'stock') return null;

  const surpriseGap = (Math.random() - 0.5) * 0.15; // -7.5% to +7.5%
  feed.currentPrice *= (1 + surpriseGap);
  feed.lastEarningsPriceImpact = surpriseGap;
  feed.earnedEventToday = true;

  return {
    symbol,
    gapPct: parseFloat((surpriseGap * 100).toFixed(2)),
    newPrice: parseFloat(feed.currentPrice.toFixed(4)),
  };
}

/**
 * Get data feed status
 * @returns {object} { connected, latency, lastUpdate, ticksPerSecond }
 */
export function getDataFeedStatus() {
  const ticksPerSecond = (dataServiceState.tickCount / ((Date.now() - dataServiceState.sessionStartTime) / 1000));

  return {
    connected: dataServiceState.isRunning,
    latency: Math.floor(TICK_INTERVAL_MS / 2),
    lastUpdate: dataServiceState.lastUpdate,
    ticksPerSecond: parseFloat(ticksPerSecond.toFixed(2)),
    totalTicks: dataServiceState.tickCount,
    feedCount: Object.keys(dataServiceState.feeds).length,
  };
}

// ============================================================================
// PERSISTENCE
// ============================================================================

/**
 * Persist essential state to localStorage
 */
function persistState() {
  try {
    const snapshot = {
      lastUpdate: dataServiceState.lastUpdate,
      tickCount: dataServiceState.tickCount,
      feeds: {},
    };

    // Save feed snapshots
    Object.entries(dataServiceState.feeds).forEach(([symbol, feed]) => {
      snapshot.feeds[symbol] = {
        currentPrice: feed.currentPrice,
        dayOpen: feed.dayOpen,
        high: feed.high,
        low: feed.low,
        volume: feed.volume,
        trend: feed.trend,
      };
    });

    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (err) {
    console.error('Failed to persist live data state:', err);
  }
}

/**
 * Load state from localStorage
 */
function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;

    const snapshot = JSON.parse(stored);
    dataServiceState.lastUpdate = snapshot.lastUpdate || Date.now();
    dataServiceState.tickCount = snapshot.tickCount || 0;

    // Restore feed state if available
    Object.entries(snapshot.feeds || {}).forEach(([symbol, feedData]) => {
      if (dataServiceState.feeds[symbol]) {
        Object.assign(dataServiceState.feeds[symbol], feedData);
      }
    });
  } catch (err) {
    console.error('Failed to load live data state:', err);
  }
}

export default {
  initLiveDataService,
  stopLiveDataService,
  getRealtimePrice,
  getOHLCV,
  getMarketDepth,
  subscribeToPrice,
  getMarketStatus,
  getCorrelationMatrix,
  simulateEarningsSurprise,
  getDataFeedStatus,
};
