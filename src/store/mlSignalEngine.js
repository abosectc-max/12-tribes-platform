/**
 * Machine Learning Signal Refinement Engine
 *
 * Lightweight statistical/ML signal processing using technical feature extraction,
 * linear regression, logistic classification, and random forest ensemble methods.
 * No external dependencies - implements math from scratch.
 *
 * @module mlSignalEngine
 * @requires localStorage for persistence
 */

// ============================================================================
// INITIALIZATION & STATE MANAGEMENT
// ============================================================================

let mlState = {
  isInitialized: false,
  models: {}, // symbol -> { lr, logistic, rf, lastTrain }
  features: {}, // symbol -> cached feature matrix
  signalHistory: {}, // symbol -> array of predictions
  accuracy: {}, // model accuracy tracking
  regimeData: {}, // symbol -> regime detection
  featureImportance: {}, // symbol -> importance scores
};

const STORAGE_KEY_MODELS = '12tribes_ml_models';
const STORAGE_KEY_HISTORY = '12tribes_ml_history';

// Technical indicator parameters
const INDICATOR_PERIODS = {
  rsi: 14,
  macd: { fast: 12, slow: 26, signal: 9 },
  bb: 20,
  atr: 14,
  obv: 14,
  stoch: { k: 14, d: 3 },
  williams_r: 14,
  cci: 20,
  adx: 14,
};

// ============================================================================
// MATH UTILITIES
// ============================================================================

/**
 * Calculate mean of array
 * @param {number[]} arr
 * @returns {number}
 */
function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Calculate standard deviation
 * @param {number[]} arr
 * @returns {number}
 */
function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const squareDiffs = arr.map(val => Math.pow(val - m, 2));
  return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / arr.length);
}

/**
 * Calculate covariance between two series
 * @param {number[]} x
 * @param {number[]} y
 * @returns {number}
 */
function covariance(x, y) {
  if (x.length === 0 || x.length !== y.length) return 0;
  const n = x.length;
  const meanX = mean(x);
  const meanY = mean(y);
  return x.reduce((sum, xi, i) => sum + (xi - meanX) * (y[i] - meanY), 0) / n;
}

/**
 * Calculate correlation coefficient
 * @param {number[]} x
 * @param {number[]} y
 * @returns {number}
 */
function correlation(x, y) {
  const cov = covariance(x, y);
  const stdX = std(x);
  const stdY = std(y);
  if (stdX === 0 || stdY === 0) return 0;
  return cov / (stdX * stdY);
}

/**
 * Linear regression: fit y = w*X + b
 * @param {number[][]} X - Feature matrix [samples, features]
 * @param {number[]} y - Target values
 * @returns {object} { weights, bias, rSquared }
 */
function linearRegression(X, y) {
  if (X.length === 0 || X[0].length === 0) {
    return { weights: [], bias: 0, rSquared: 0 };
  }

  const m = X.length; // samples
  const n = X[0].length; // features

  // Simple closed-form solution for univariate case
  if (n === 1) {
    const xValues = X.map(row => row[0]);
    const meanX = mean(xValues);
    const meanY = mean(y);

    const numerator = xValues.reduce((sum, x, i) => sum + (x - meanX) * (y[i] - meanY), 0);
    const denominator = xValues.reduce((sum, x) => sum + Math.pow(x - meanX, 2), 0);

    const weight = denominator === 0 ? 0 : numerator / denominator;
    const bias = meanY - weight * meanX;

    // R-squared
    const yPred = xValues.map(x => weight * x + bias);
    const ssRes = y.reduce((sum, yi, i) => sum + Math.pow(yi - yPred[i], 2), 0);
    const ssTot = y.reduce((sum, yi) => sum + Math.pow(yi - meanY, 2), 0);
    const rSquared = ssTot === 0 ? 0 : 1 - (ssRes / ssTot);

    return {
      weights: [weight],
      bias,
      rSquared: Math.max(0, rSquared),
    };
  }

  // For multivariate: use simplified gradient descent
  let weights = new Array(n).fill(0);
  let bias = 0;
  const learningRate = 0.01;
  const iterations = 100;

  for (let iter = 0; iter < iterations; iter++) {
    // Predictions
    const yPred = X.map(row => {
      return bias + weights.reduce((sum, w, i) => sum + w * row[i], 0);
    });

    // Gradient for weights
    const gradW = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      gradW[i] = X.reduce((sum, row, idx) => sum + row[i] * (yPred[idx] - y[idx]), 0) * 2 / m;
    }

    // Gradient for bias
    const gradB = yPred.reduce((sum, pred, idx) => sum + (pred - y[idx]), 0) * 2 / m;

    // Update
    weights = weights.map((w, i) => w - learningRate * gradW[i]);
    bias = bias - learningRate * gradB;
  }

  // R-squared
  const yPred = X.map(row => bias + weights.reduce((sum, w, i) => sum + w * row[i], 0));
  const meanY = mean(y);
  const ssRes = y.reduce((sum, yi, i) => sum + Math.pow(yi - yPred[i], 2), 0);
  const ssTot = y.reduce((sum, yi) => sum + Math.pow(yi - meanY, 2), 0);
  const rSquared = ssTot === 0 ? 0 : 1 - (ssRes / ssTot);

  return { weights, bias, rSquared: Math.max(0, rSquared) };
}

/**
 * Sigmoid function
 * @param {number} x
 * @returns {number}
 */
function sigmoid(x) {
  // Avoid overflow
  if (x > 100) return 1;
  if (x < -100) return 0;
  return 1 / (1 + Math.exp(-x));
}

/**
 * Logistic regression for binary classification
 * @param {number[][]} X - Feature matrix
 * @param {number[]} y - Binary labels (0 or 1)
 * @param {number} iterations
 * @param {number} learningRate
 * @returns {object} { weights, bias, accuracy }
 */
function logisticRegression(X, y, iterations = 100, learningRate = 0.01) {
  if (X.length === 0) {
    return { weights: [], bias: 0, accuracy: 0 };
  }

  const m = X.length;
  const n = X[0].length;
  let weights = new Array(n).fill(0);
  let bias = 0;

  for (let iter = 0; iter < iterations; iter++) {
    // Predictions
    const yPred = X.map(row => {
      const z = bias + weights.reduce((sum, w, i) => sum + w * row[i], 0);
      return sigmoid(z);
    });

    // Gradients
    const gradW = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      gradW[i] = X.reduce((sum, row, idx) => sum + row[i] * (yPred[idx] - y[idx]), 0) / m;
    }
    const gradB = yPred.reduce((sum, pred, idx) => sum + (pred - y[idx]), 0) / m;

    // Update
    weights = weights.map((w, i) => w - learningRate * gradW[i]);
    bias = bias - learningRate * gradB;
  }

  // Accuracy
  const predictions = X.map(row => {
    const z = bias + weights.reduce((sum, w, i) => sum + w * row[i], 0);
    return sigmoid(z) > 0.5 ? 1 : 0;
  });
  const accuracy = predictions.reduce((sum, pred, i) => sum + (pred === y[i] ? 1 : 0), 0) / m;

  return { weights, bias, accuracy };
}

/**
 * Decision stump (single-feature decision tree)
 * Finds best threshold for a single feature
 * @param {number[][]} X
 * @param {number[]} y
 * @returns {object} { featureIndex, threshold, accuracy }
 */
function decisionStump(X, y) {
  if (X.length === 0 || X[0].length === 0) {
    return { featureIndex: 0, threshold: 0, accuracy: 0 };
  }

  let bestAccuracy = 0;
  let bestFeature = 0;
  let bestThreshold = 0;

  const n = X[0].length;

  // Try each feature
  for (let featureIdx = 0; featureIdx < n; featureIdx++) {
    const featureValues = X.map(row => row[featureIdx]);
    const uniqueValues = [...new Set(featureValues)].sort((a, b) => a - b);

    // Try thresholds between unique values
    for (let i = 0; i < uniqueValues.length - 1; i++) {
      const threshold = (uniqueValues[i] + uniqueValues[i + 1]) / 2;

      // Predict using this threshold
      const predictions = X.map(row => row[featureIdx] > threshold ? 1 : 0);

      // Accuracy
      const accuracy = predictions.reduce((sum, pred, idx) => sum + (pred === y[idx] ? 1 : 0), 0) / X.length;

      if (accuracy > bestAccuracy) {
        bestAccuracy = accuracy;
        bestFeature = featureIdx;
        bestThreshold = threshold;
      }
    }
  }

  return { featureIndex: bestFeature, threshold: bestThreshold, accuracy: bestAccuracy };
}

/**
 * Random Forest with decision stumps
 * @param {number[][]} X
 * @param {number[]} y
 * @param {number} nTrees
 * @returns {object} { stumps, accuracy }
 */
function randomForest(X, y, nTrees = 10) {
  const stumps = [];

  for (let i = 0; i < nTrees; i++) {
    // Bootstrap sample
    const indices = [];
    for (let j = 0; j < X.length; j++) {
      indices.push(Math.floor(Math.random() * X.length));
    }

    const bootX = indices.map(idx => X[idx]);
    const bootY = indices.map(idx => y[idx]);

    // Train stump
    const stump = decisionStump(bootX, bootY);
    stumps.push(stump);
  }

  // Ensemble prediction accuracy
  const predictions = X.map((row, sampleIdx) => {
    const votes = stumps.map(stump => row[stump.featureIndex] > stump.threshold ? 1 : 0);
    const sum = votes.reduce((a, b) => a + b, 0);
    return sum >= nTrees / 2 ? 1 : 0;
  });

  const accuracy = predictions.reduce((sum, pred, i) => sum + (pred === y[i] ? 1 : 0), 0) / X.length;

  return { stumps, accuracy };
}

// ============================================================================
// TECHNICAL INDICATOR EXTRACTION
// ============================================================================

/**
 * Calculate RSI (Relative Strength Index)
 * @param {number[]} closes
 * @param {number} period
 * @returns {number[]}
 */
function calculateRSI(closes, period = 14) {
  const rsi = [];
  for (let i = period; i < closes.length; i++) {
    let gains = 0;
    let losses = 0;

    for (let j = i - period; j < i; j++) {
      const diff = closes[j + 1] - closes[j];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - (100 / (1 + rs)));
  }
  return rsi;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 * @param {number[]} closes
 * @returns {object} { macd, signal, histogram }
 */
function calculateMACD(closes) {
  const fast = 12;
  const slow = 26;
  const signal = 9;

  const ema = (data, period) => {
    const ema = [];
    const k = 2 / (period + 1);
    let sma = mean(data.slice(0, period));
    ema.push(sma);

    for (let i = period; i < data.length; i++) {
      sma = data[i] * k + sma * (1 - k);
      ema.push(sma);
    }
    return ema;
  };

  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);

  const macdLine = [];
  const minLen = Math.min(emaFast.length, emaSlow.length);
  for (let i = 0; i < minLen; i++) {
    macdLine.push(emaFast[i] - emaSlow[i]);
  }

  const signalLine = ema(macdLine, signal);
  const histogram = macdLine.map((m, i) => m - (signalLine[i] || 0));

  return { macd: macdLine, signal: signalLine, histogram };
}

/**
 * Calculate Bollinger Bands
 * @param {number[]} closes
 * @param {number} period
 * @param {number} stdDevs
 * @returns {object} { upper, middle, lower, width }
 */
function calculateBollingerBands(closes, period = 20, stdDevs = 2) {
  const bands = [];
  const width = [];

  for (let i = period - 1; i < closes.length; i++) {
    const window = closes.slice(i - period + 1, i + 1);
    const sma = mean(window);
    const stdDev = std(window);
    const upper = sma + stdDevs * stdDev;
    const lower = sma - stdDevs * stdDev;

    bands.push({
      upper,
      middle: sma,
      lower,
    });
    width.push(upper - lower);
  }

  return { bands, width };
}

/**
 * Calculate ATR (Average True Range)
 * @param {object[]} ohlcv
 * @param {number} period
 * @returns {number[]}
 */
function calculateATR(ohlcv, period = 14) {
  const tr = [];
  for (let i = 1; i < ohlcv.length; i++) {
    const high = ohlcv[i].high;
    const low = ohlcv[i].low;
    const close = ohlcv[i - 1].close;

    const tr1 = high - low;
    const tr2 = Math.abs(high - close);
    const tr3 = Math.abs(low - close);
    tr.push(Math.max(tr1, tr2, tr3));
  }

  const atr = [];
  let sum = mean(tr.slice(0, period));
  atr.push(sum);

  for (let i = period; i < tr.length; i++) {
    sum = (sum * (period - 1) + tr[i]) / period;
    atr.push(sum);
  }

  return atr;
}

/**
 * Calculate OBV (On-Balance Volume)
 * @param {object[]} ohlcv
 * @returns {number[]}
 */
function calculateOBV(ohlcv) {
  const obv = [];
  let cumulative = 0;

  for (let i = 0; i < ohlcv.length; i++) {
    if (i === 0) {
      cumulative = ohlcv[i].volume;
    } else {
      if (ohlcv[i].close > ohlcv[i - 1].close) {
        cumulative += ohlcv[i].volume;
      } else if (ohlcv[i].close < ohlcv[i - 1].close) {
        cumulative -= ohlcv[i].volume;
      }
    }
    obv.push(cumulative);
  }

  return obv;
}

/**
 * Calculate Stochastic Oscillator
 * @param {object[]} ohlcv
 * @param {number} kPeriod
 * @param {number} dPeriod
 * @returns {object} { k, d }
 */
function calculateStochastic(ohlcv, kPeriod = 14, dPeriod = 3) {
  const k = [];

  for (let i = kPeriod - 1; i < ohlcv.length; i++) {
    const window = ohlcv.slice(i - kPeriod + 1, i + 1);
    const low = Math.min(...window.map(c => c.low));
    const high = Math.max(...window.map(c => c.high));
    const close = ohlcv[i].close;

    const kValue = (close - low) / (high - low) * 100;
    k.push(kValue);
  }

  const d = [];
  for (let i = dPeriod - 1; i < k.length; i++) {
    const dValue = mean(k.slice(i - dPeriod + 1, i + 1));
    d.push(dValue);
  }

  return { k, d };
}

/**
 * Calculate ADX (Average Directional Index)
 * @param {object[]} ohlcv
 * @param {number} period
 * @returns {number[]}
 */
function calculateADX(ohlcv, period = 14) {
  const adx = [];
  const plusDI = [];
  const minusDI = [];

  for (let i = 1; i < ohlcv.length; i++) {
    const upMove = ohlcv[i].high - ohlcv[i - 1].high;
    const downMove = ohlcv[i - 1].low - ohlcv[i].low;

    let plusDM = 0;
    let minusDM = 0;

    if (upMove > downMove && upMove > 0) {
      plusDM = upMove;
    }
    if (downMove > upMove && downMove > 0) {
      minusDM = downMove;
    }

    const tr = Math.max(
      ohlcv[i].high - ohlcv[i].low,
      Math.abs(ohlcv[i].high - ohlcv[i - 1].close),
      Math.abs(ohlcv[i].low - ohlcv[i - 1].close)
    );

    if (i >= period) {
      const sumPlusDM = plusDI.slice(-period).reduce((a, b) => a + b, 0) + plusDM;
      const sumMinusDM = minusDI.slice(-period).reduce((a, b) => a + b, 0) + minusDM;
      const sumTR = (ohlcv.slice(i - period, i).map((c, idx) =>
        Math.max(c.high - c.low, Math.abs(c.high - (idx > 0 ? ohlcv[i - period + idx - 1].close : c.close)),
        Math.abs(c.low - (idx > 0 ? ohlcv[i - period + idx - 1].close : c.close)))
      ).reduce((a, b) => a + b, 0)) + tr;

      const plusValue = 100 * (sumPlusDM / sumTR);
      const minusValue = 100 * (sumMinusDM / sumTR);

      plusDI.push(plusValue);
      minusDI.push(minusValue);

      const di = Math.abs(plusValue - minusValue) / (plusValue + minusValue);
      adx.push(di * 100);
    }
  }

  return adx;
}

// ============================================================================
// FEATURE EXTRACTION
// ============================================================================

/**
 * Extract all technical features from OHLCV data
 * @param {object[]} ohlcv
 * @returns {number[][]} Feature matrix [samples, features]
 */
export function extractFeatures(ohlcv) {
  if (!ohlcv || ohlcv.length < 50) {
    return [];
  }

  const closes = ohlcv.map(c => c.close);
  const highs = ohlcv.map(c => c.high);
  const lows = ohlcv.map(c => c.low);
  const volumes = ohlcv.map(c => c.volume);

  // Calculate indicators
  const rsi = calculateRSI(closes, INDICATOR_PERIODS.rsi);
  const { macd, histogram } = calculateMACD(closes);
  const { bands, width: bbWidth } = calculateBollingerBands(closes, INDICATOR_PERIODS.bb);
  const atr = calculateATR(ohlcv, INDICATOR_PERIODS.atr);
  const obv = calculateOBV(ohlcv);
  const { k: stochK, d: stochD } = calculateStochastic(ohlcv, INDICATOR_PERIODS.stoch.k);
  const adx = calculateADX(ohlcv, INDICATOR_PERIODS.adx);

  // Build feature matrix (start from index with all indicators available)
  const features = [];
  const startIdx = Math.max(
    INDICATOR_PERIODS.rsi,
    INDICATOR_PERIODS.bb,
    INDICATOR_PERIODS.atr,
    INDICATOR_PERIODS.stoch.k + INDICATOR_PERIODS.stoch.d
  );

  for (let i = startIdx; i < closes.length; i++) {
    const rsiIdx = i - INDICATOR_PERIODS.rsi;
    const bbIdx = i - INDICATOR_PERIODS.bb;
    const atrIdx = i - INDICATOR_PERIODS.atr - 1;
    const stochIdx = i - INDICATOR_PERIODS.stoch.k - INDICATOR_PERIODS.stoch.d;
    const macdIdx = i - INDICATOR_PERIODS.macd.slow;

    const feature = [
      rsi[rsiIdx] || 50,
      macd[macdIdx] || 0,
      histogram[macdIdx] || 0,
      bbWidth[bbIdx] || 0,
      (closes[i] - lows[i]) / (highs[i] - lows[i] + 0.0001),
      atr[atrIdx] || 0,
      obv[i] || 0,
      stochK[stochIdx] || 50,
      stochD[stochIdx] || 50,
      adx[Math.max(0, atrIdx - 10)] || 20,
      volumes[i] / mean(volumes.slice(Math.max(0, i - 20), i) || [1]),
    ];

    features.push(feature);
  }

  return features;
}

// ============================================================================
// MODEL TRAINING & PREDICTION
// ============================================================================

/**
 * Initialize ML engine
 * @returns {void}
 */
export function initMLEngine() {
  loadState();
}

/**
 * Train models for a symbol
 * @param {string} symbol
 * @param {object[]} ohlcv
 * @returns {void}
 */
export function trainModels(symbol, ohlcv) {
  if (!ohlcv || ohlcv.length < 100) return;

  const features = extractFeatures(ohlcv);
  if (features.length < 50) return;

  // Generate target labels: 1 if price goes up, 0 if down
  const closes = ohlcv.map(c => c.close);
  const startIdx = ohlcv.length - features.length;
  const labels = [];

  for (let i = startIdx; i < closes.length - 1; i++) {
    labels.push(closes[i + 1] > closes[i] ? 1 : 0);
  }

  if (labels.length < features.length) {
    features.pop();
  }

  // Train models
  const lr = linearRegression(features, labels.map(l => l ? 1 : 0));
  const logistic = logisticRegression(features, labels, 100, 0.01);
  const rf = randomForest(features, labels, 10);

  mlState.models[symbol] = {
    lr,
    logistic,
    rf,
    lastTrain: Date.now(),
  };

  mlState.features[symbol] = features;

  // Calculate feature importance (correlation with target)
  if (!mlState.featureImportance[symbol]) {
    mlState.featureImportance[symbol] = {};
  }

  const importance = [];
  for (let i = 0; i < features[0].length; i++) {
    const featureColumn = features.map(row => row[i]);
    const corr = Math.abs(correlation(featureColumn, labels.map(l => l ? 1 : 0)));
    importance.push(corr);
  }

  mlState.featureImportance[symbol] = importance;

  persistState();
}

/**
 * Predict signal for current features
 * @param {string} symbol
 * @param {number[]} currentFeatures
 * @returns {object} { direction: 1|-1|0, confidence, models }
 */
export function predictSignal(symbol, currentFeatures) {
  const models = mlState.models[symbol];
  if (!models || !currentFeatures) {
    return { direction: 0, confidence: 0, models: {} };
  }

  const predictions = {};

  // Linear regression
  if (models.lr && models.lr.weights) {
    const pred = models.lr.bias + currentFeatures.reduce((sum, f, i) => sum + (models.lr.weights[i] || 0) * f, 0);
    predictions.lr = pred > 0.5 ? 1 : -1;
  }

  // Logistic
  if (models.logistic && models.logistic.weights) {
    const z = models.logistic.bias + currentFeatures.reduce((sum, f, i) => sum + (models.logistic.weights[i] || 0) * f, 0);
    const prob = 1 / (1 + Math.exp(-z));
    predictions.logistic = prob > 0.5 ? 1 : -1;
    predictions.logisticConfidence = Math.abs(prob - 0.5) * 2;
  }

  // Random Forest
  if (models.rf && models.rf.stumps) {
    const votes = models.rf.stumps.map(stump => currentFeatures[stump.featureIndex] > stump.threshold ? 1 : 0);
    const sum = votes.reduce((a, b) => a + b, 0);
    predictions.rf = sum >= models.rf.stumps.length / 2 ? 1 : -1;
  }

  // Ensemble
  const directionVotes = Object.values(predictions).filter(v => v === 1 || v === -1);
  const direction = directionVotes.length === 0 ? 0 : directionVotes.reduce((a, b) => a + b) > 0 ? 1 : -1;
  const confidence = Math.abs(directionVotes.reduce((a, b) => a + b, 0) / (directionVotes.length || 1));

  return {
    direction,
    confidence: Math.min(1, confidence),
    models: predictions,
  };
}

/**
 * Get composite signal score (0-100)
 * @param {string} symbol
 * @param {number[]} currentFeatures
 * @returns {number}
 */
export function getSignalScore(symbol, currentFeatures) {
  const pred = predictSignal(symbol, currentFeatures);
  if (pred.direction === 0) return 50;
  return 50 + (pred.direction * pred.confidence * 50);
}

/**
 * Get feature importance for a symbol
 * @param {string} symbol
 * @returns {array} Importance scores
 */
export function getFeatureImportance(symbol) {
  return mlState.featureImportance[symbol] || [];
}

/**
 * Get model accuracy stats
 * @returns {object}
 */
export function getModelAccuracy() {
  const accuracy = {};

  Object.entries(mlState.models).forEach(([symbol, models]) => {
    accuracy[symbol] = {
      lr_rsquared: models.lr?.rSquared || 0,
      logistic_accuracy: models.logistic?.accuracy || 0,
      rf_accuracy: models.rf?.accuracy || 0,
    };
  });

  return accuracy;
}

/**
 * Detect market regime (trending/ranging/volatile)
 * @param {string} symbol
 * @param {object[]} ohlcv
 * @returns {object}
 */
export function getRegime(symbol, ohlcv) {
  if (!ohlcv || ohlcv.length < 50) {
    return { regime: 'unknown', confidence: 0, indicators: {} };
  }

  const adx = calculateADX(ohlcv, INDICATOR_PERIODS.adx);
  const closes = ohlcv.map(c => c.close);
  const atr = calculateATR(ohlcv, INDICATOR_PERIODS.atr);

  const recentADX = adx.length > 0 ? adx[adx.length - 1] : 25;
  const recentATR = atr.length > 0 ? atr[atr.length - 1] : 0;
  const recentPrice = closes[closes.length - 1];
  const atrPct = (recentATR / recentPrice) * 100;

  let regime = 'ranging';
  let confidence = 0;

  if (recentADX > 40) {
    regime = 'trending';
    confidence = Math.min(1, (recentADX - 40) / 30);
  } else if (recentADX < 20) {
    regime = 'ranging';
    confidence = Math.min(1, (20 - recentADX) / 20);
  } else if (atrPct > 2) {
    regime = 'volatile';
    confidence = Math.min(1, atrPct / 5);
  }

  return {
    regime,
    confidence,
    indicators: {
      adx: recentADX,
      atrPct,
    },
  };
}

/**
 * Get signal history
 * @param {string} symbol
 * @param {number} n
 * @returns {array}
 */
export function getSignalHistory(symbol, n = 20) {
  const history = mlState.signalHistory[symbol] || [];
  return history.slice(-n);
}

/**
 * Retrain all models
 * @param {object} symbolOHLCVMap - { symbol: ohlcv[] }
 * @returns {void}
 */
export function retrainAll(symbolOHLCVMap) {
  Object.entries(symbolOHLCVMap).forEach(([symbol, ohlcv]) => {
    trainModels(symbol, ohlcv);
  });
}

/**
 * Get overfitting warnings
 * @returns {array} List of symbols with overfitting signals
 */
export function getOverfitWarnings() {
  const warnings = [];

  Object.entries(mlState.models).forEach(([symbol, models]) => {
    // Simple check: if R-squared much higher than logistic accuracy
    if (models.lr && models.logistic) {
      const rSquaredGap = models.lr.rSquared - models.logistic.accuracy;
      if (rSquaredGap > 0.15) {
        warnings.push({
          symbol,
          type: 'regression_overfit',
          gap: rSquaredGap,
        });
      }
    }
  });

  return warnings;
}

// ============================================================================
// PERSISTENCE
// ============================================================================

/**
 * Persist ML state to localStorage
 */
function persistState() {
  try {
    const modelSnapshot = {};
    Object.entries(mlState.models).forEach(([symbol, model]) => {
      modelSnapshot[symbol] = {
        lr: model.lr,
        logistic: model.logistic,
        rf: { stumps: model.rf?.stumps, accuracy: model.rf?.accuracy },
        lastTrain: model.lastTrain,
      };
    });

    localStorage.setItem(STORAGE_KEY_MODELS, JSON.stringify(modelSnapshot));

    const historySnapshot = {};
    Object.entries(mlState.signalHistory).forEach(([symbol, history]) => {
      historySnapshot[symbol] = history.slice(-100); // Keep last 100
    });
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(historySnapshot));
  } catch (err) {
    console.error('Failed to persist ML state:', err);
  }
}

/**
 * Load ML state from localStorage
 */
function loadState() {
  try {
    const models = localStorage.getItem(STORAGE_KEY_MODELS);
    if (models) {
      mlState.models = JSON.parse(models);
    }

    const history = localStorage.getItem(STORAGE_KEY_HISTORY);
    if (history) {
      mlState.signalHistory = JSON.parse(history);
    }
  } catch (err) {
    console.error('Failed to load ML state:', err);
  }
}

export default {
  initMLEngine,
  extractFeatures,
  trainModels,
  predictSignal,
  getSignalScore,
  getFeatureImportance,
  getModelAccuracy,
  getRegime,
  getSignalHistory,
  retrainAll,
  getOverfitWarnings,
};
