/**
 * Broker API Abstraction Layer
 *
 * Simulates broker connectivity for paper trading with realistic order execution,
 * commission modeling, margin tracking, and position management across multiple
 * asset classes (stocks, crypto, forex).
 *
 * @module brokerService
 * @requires localStorage for persistence
 */

// ============================================================================
// INITIALIZATION & STATE MANAGEMENT
// ============================================================================

let brokerState = {
  isInitialized: false,
  investorId: null,
  orders: {}, // orderId -> order object
  fills: {}, // orderId -> fill details
  positions: {}, // symbol -> position object
  accountBalance: 100000, // Starting capital
  accountEquity: 100000,
  buyingPower: 400000, // 4x margin for stocks by default
  marginUsed: 0,
  marginAvailable: 400000,
  commissionAccumulated: 0,
  brokerConnections: {
    alpaca: { connected: true, latency: 15 },
    binance: { connected: true, latency: 25 },
    oanda: { connected: true, latency: 20 },
  },
  lastOrderId: 0,
  lastFillTime: 0,
};

const STORAGE_KEY_ORDERS = '12tribes_broker_orders';
const STORAGE_KEY_FILLS = '12tribes_broker_fills';
const STORAGE_KEY_ACCOUNT = '12tribes_broker_account';

// Broker configuration
const BROKER_CONFIG = {
  alpaca: {
    name: 'Alpaca',
    assetTypes: ['stock', 'etf'],
    commission: 0, // Commission-free
    minCommission: 0,
    marginMultiplier: 4,
    orderTypes: ['market', 'limit', 'stop', 'stop_limit', 'trailing_stop', 'oco'],
  },
  binance: {
    name: 'Binance',
    assetTypes: ['crypto'],
    commission: 0.001, // 0.1% maker, 0.1% taker
    minCommission: 0,
    marginMultiplier: 5,
    orderTypes: ['market', 'limit', 'stop', 'stop_limit'],
  },
  oanda: {
    name: 'OANDA',
    assetTypes: ['forex'],
    commission: 0, // Per-lot: $2 USD
    minCommission: 2,
    marginMultiplier: 50,
    orderTypes: ['market', 'limit', 'stop', 'stop_limit', 'trailing_stop'],
  },
};

// Asset to broker mapping
const ASSET_BROKER_MAP = {
  // Stocks
  AAPL: 'alpaca',
  MSFT: 'alpaca',
  NVDA: 'alpaca',
  TSLA: 'alpaca',
  JPM: 'alpaca',
  XOM: 'alpaca',
  GLD: 'alpaca',

  // Crypto
  BTC: 'binance',
  ETH: 'binance',
  ADA: 'binance',

  // Forex
  EURUSD: 'oanda',
  GBPUSD: 'oanda',
  USDJPY: 'oanda',
};

// ============================================================================
// ORDER TYPES & VALIDATION
// ============================================================================

/**
 * Order structure definition
 */
const ORDER_TEMPLATE = {
  orderId: null,
  investorId: null,
  symbol: null,
  side: null, // 'buy' or 'sell'
  type: null, // 'market', 'limit', 'stop', 'stop_limit', 'trailing_stop', 'oco'
  quantity: null,
  limitPrice: null,
  stopPrice: null,
  trailingPct: null,
  ocoPairs: null, // { takeProfit: { limitPrice }, stopLoss: { stopPrice } }
  status: 'pending', // pending, accepted, partially_filled, filled, cancelled, rejected
  filledQuantity: 0,
  averageFillPrice: 0,
  commission: 0,
  createdAt: null,
  executedAt: null,
  broker: null,
};

/**
 * Generate unique order ID
 * @returns {string}
 */
function generateOrderId() {
  brokerState.lastOrderId += 1;
  return `ORD-${Date.now()}-${brokerState.lastOrderId}`;
}

/**
 * Validate order before submission
 * @param {object} order
 * @returns {object} { valid: boolean, error?: string }
 */
function validateOrder(order) {
  if (!order.symbol || !order.side || !order.type || !order.quantity) {
    return { valid: false, error: 'Missing required fields: symbol, side, type, quantity' };
  }

  if (!['buy', 'sell'].includes(order.side)) {
    return { valid: false, error: 'Side must be buy or sell' };
  }

  if (order.quantity <= 0) {
    return { valid: false, error: 'Quantity must be positive' };
  }

  const broker = ASSET_BROKER_MAP[order.symbol];
  if (!broker) {
    return { valid: false, error: `Unknown symbol: ${order.symbol}` };
  }

  if (!BROKER_CONFIG[broker].orderTypes.includes(order.type)) {
    return { valid: false, error: `Order type ${order.type} not supported for ${order.symbol}` };
  }

  if (['limit', 'stop_limit'].includes(order.type) && !order.limitPrice) {
    return { valid: false, error: 'Limit orders require limitPrice' };
  }

  if (['stop', 'stop_limit', 'trailing_stop'].includes(order.type) && !order.stopPrice && !order.trailingPct) {
    return { valid: false, error: 'Stop orders require stopPrice or trailingPct' };
  }

  return { valid: true };
}

// ============================================================================
// POSITION MANAGEMENT
// ============================================================================

/**
 * Get or create position for symbol
 * @param {string} symbol
 * @returns {object}
 */
function getOrCreatePosition(symbol) {
  if (!brokerState.positions[symbol]) {
    brokerState.positions[symbol] = {
      symbol,
      quantity: 0,
      averagePrice: 0,
      marketValue: 0,
      unrealizedPnL: 0,
      unrealizedPnLPct: 0,
      acquisitionCost: 0,
    };
  }

  return brokerState.positions[symbol];
}

/**
 * Update position on fill
 * @param {string} symbol
 * @param {number} quantity - Positive for buy, negative for sell
 * @param {number} fillPrice
 */
function updatePosition(symbol, quantity, fillPrice) {
  const position = getOrCreatePosition(symbol);

  if (quantity > 0) {
    // Buy: scale in
    const totalCost = position.quantity * position.averagePrice + quantity * fillPrice;
    const totalQuantity = position.quantity + quantity;
    position.averagePrice = totalQuantity > 0 ? totalCost / totalQuantity : 0;
    position.quantity = totalQuantity;
  } else if (quantity < 0) {
    // Sell: scale out
    position.quantity += quantity;
    if (position.quantity === 0) {
      position.averagePrice = 0;
    }
  }

  position.acquisitionCost = Math.abs(position.quantity) * position.averagePrice;
}

/**
 * Get all positions
 * @returns {object}
 */
function getPositions() {
  const nonZeroPositions = {};
  Object.entries(brokerState.positions).forEach(([symbol, pos]) => {
    if (pos.quantity !== 0) {
      nonZeroPositions[symbol] = pos;
    }
  });
  return nonZeroPositions;
}

// ============================================================================
// ORDER BOOK & FILL ENGINE
// ============================================================================

/**
 * Check if limit order should fill at current price
 * @param {object} order
 * @param {number} currentPrice
 * @returns {boolean}
 */
function shouldFillLimit(order, currentPrice) {
  if (order.side === 'buy') {
    return currentPrice <= order.limitPrice;
  } else {
    return currentPrice >= order.limitPrice;
  }
}

/**
 * Check if stop order should fill at current price
 * @param {object} order
 * @param {number} currentPrice
 * @returns {boolean}
 */
function shouldFillStop(order, currentPrice) {
  if (order.side === 'buy') {
    return currentPrice >= order.stopPrice;
  } else {
    return currentPrice <= order.stopPrice;
  }
}

/**
 * Calculate slippage for market order
 * @param {string} symbol
 * @param {number} quantity
 * @param {string} side - 'buy' or 'sell'
 * @returns {number} Slippage as percentage (0.001 = 0.1%)
 */
function calculateSlippage(symbol, quantity, side) {
  // Slippage based on asset type and order size
  const broker = ASSET_BROKER_MAP[symbol];
  let baseSlippage = 0.0001; // 0.01% base

  if (broker === 'binance') {
    baseSlippage = 0.0015; // Crypto slightly higher
  } else if (broker === 'oanda') {
    baseSlippage = 0.0002; // Forex tight
  }

  // Scale with order size (larger orders get worse fills)
  const sizeMultiplier = Math.max(1, quantity / 1000);
  return baseSlippage * sizeMultiplier;
}

/**
 * Calculate commission for a trade
 * @param {string} symbol
 * @param {number} quantity
 * @param {number} price
 * @returns {number} Commission amount in USD
 */
function calculateCommission(symbol, quantity, price) {
  const broker = ASSET_BROKER_MAP[symbol];
  const config = BROKER_CONFIG[broker];

  if (config.commission === 0) {
    return 0;
  }

  const tradeValue = quantity * price;
  let commission = tradeValue * config.commission;
  commission = Math.max(commission, config.minCommission);

  return parseFloat(commission.toFixed(2));
}

/**
 * Execute a market order immediately
 * @param {object} order
 * @param {number} currentPrice
 * @param {object} priceData - { bid, ask }
 * @returns {object} Fill result
 */
function executeMarketOrder(order, currentPrice, priceData) {
  const slippage = calculateSlippage(order.symbol, order.quantity, order.side);
  const fillPrice = order.side === 'buy'
    ? (priceData?.ask || currentPrice) * (1 + slippage)
    : (priceData?.bid || currentPrice) * (1 - slippage);

  const commission = calculateCommission(order.symbol, order.quantity, fillPrice);

  return {
    quantity: order.quantity,
    fillPrice: parseFloat(fillPrice.toFixed(4)),
    commission,
  };
}

/**
 * Process order book: check all pending orders for fill conditions
 * @param {object} priceData - { symbol: { price, bid, ask } }
 */
export function processOrderBook(priceData) {
  Object.values(brokerState.orders).forEach(order => {
    if (!['pending', 'accepted', 'partially_filled'].includes(order.status)) {
      return;
    }

    const symbolPrice = priceData[order.symbol];
    if (!symbolPrice) return;

    const currentPrice = symbolPrice.price;
    let shouldFill = false;

    if (order.type === 'market') {
      shouldFill = true;
    } else if (order.type === 'limit') {
      shouldFill = shouldFillLimit(order, currentPrice);
    } else if (order.type === 'stop') {
      shouldFill = shouldFillStop(order, currentPrice);
    } else if (order.type === 'stop_limit') {
      shouldFill = shouldFillStop(order, currentPrice) && shouldFillLimit(order, currentPrice);
    } else if (order.type === 'trailing_stop') {
      // Simplified trailing stop
      if (!order.trailingStopPrice) {
        order.trailingStopPrice = order.side === 'buy' ? currentPrice : currentPrice;
      }
      if (order.side === 'sell') {
        shouldFill = currentPrice <= order.trailingStopPrice;
      }
    }

    if (shouldFill && order.filledQuantity < order.quantity) {
      const remainingQuantity = order.quantity - order.filledQuantity;
      const fillResult = executeMarketOrder(
        { ...order, quantity: remainingQuantity },
        currentPrice,
        symbolPrice
      );

      // Update order
      const totalFillValue = order.filledQuantity * order.averageFillPrice +
        fillResult.quantity * fillResult.fillPrice;
      order.filledQuantity += fillResult.quantity;
      order.averageFillPrice = totalFillValue / order.filledQuantity;
      order.commission += fillResult.commission;
      order.executedAt = Date.now();

      // Update position
      const quantity = order.side === 'buy' ? fillResult.quantity : -fillResult.quantity;
      updatePosition(order.symbol, quantity, fillResult.fillPrice);

      // Update account
      brokerState.commissionAccumulated += fillResult.commission;

      // Record fill
      brokerState.fills[order.orderId] = {
        orderId: order.orderId,
        quantity: fillResult.quantity,
        fillPrice: fillResult.fillPrice,
        commission: fillResult.commission,
        timestamp: Date.now(),
      };

      // Update order status
      if (order.filledQuantity >= order.quantity) {
        order.status = 'filled';
      } else {
        order.status = 'partially_filled';
      }
    }
  });

  persistState();
}

// ============================================================================
// PUBLIC API: ORDER MANAGEMENT
// ============================================================================

/**
 * Initialize broker service for an investor
 * @param {string} investorId
 * @returns {void}
 */
export function initBrokerService(investorId) {
  if (brokerState.isInitialized) return;

  brokerState.investorId = investorId;
  brokerState.isInitialized = true;

  loadState();
}

/**
 * Submit an order to the broker
 * @param {object} orderRequest - { symbol, side, type, quantity, limitPrice?, stopPrice?, trailingPct? }
 * @returns {string} orderId or error message
 */
export function submitOrder(orderRequest) {
  if (!brokerState.isInitialized) {
    return null;
  }

  const validation = validateOrder(orderRequest);
  if (!validation.valid) {
    console.error('Order validation failed:', validation.error);
    return null;
  }

  const orderId = generateOrderId();
  const broker = ASSET_BROKER_MAP[orderRequest.symbol];

  const order = {
    ...ORDER_TEMPLATE,
    orderId,
    investorId: brokerState.investorId,
    symbol: orderRequest.symbol,
    side: orderRequest.side,
    type: orderRequest.type,
    quantity: orderRequest.quantity,
    limitPrice: orderRequest.limitPrice || null,
    stopPrice: orderRequest.stopPrice || null,
    trailingPct: orderRequest.trailingPct || null,
    status: 'accepted',
    createdAt: Date.now(),
    broker,
  };

  brokerState.orders[orderId] = order;

  // Market orders fill immediately
  if (orderRequest.type === 'market') {
    order.status = 'accepted';
    // Will be processed in next processOrderBook call
  }

  persistState();
  return orderId;
}

/**
 * Cancel an open order
 * @param {string} orderId
 * @returns {boolean} Success
 */
export function cancelOrder(orderId) {
  const order = brokerState.orders[orderId];
  if (!order) return false;

  if (['pending', 'accepted', 'partially_filled'].includes(order.status)) {
    order.status = 'cancelled';
    persistState();
    return true;
  }

  return false;
}

/**
 * Get order details
 * @param {string} orderId
 * @returns {object|null}
 */
export function getOrder(orderId) {
  const order = brokerState.orders[orderId];
  if (!order) return null;

  return {
    orderId: order.orderId,
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    quantity: order.quantity,
    status: order.status,
    filledQuantity: order.filledQuantity,
    averageFillPrice: parseFloat(order.averageFillPrice.toFixed(4)),
    commission: parseFloat(order.commission.toFixed(2)),
    createdAt: order.createdAt,
    executedAt: order.executedAt,
    broker: order.broker,
  };
}

/**
 * Get all open orders
 * @param {string} investorId
 * @returns {array}
 */
export function getOpenOrders(investorId) {
  return Object.values(brokerState.orders)
    .filter(order => order.investorId === investorId &&
      ['pending', 'accepted', 'partially_filled'].includes(order.status))
    .map(order => ({
      orderId: order.orderId,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
      status: order.status,
      createdAt: order.createdAt,
    }));
}

/**
 * Get filled orders (execution history)
 * @param {string} investorId
 * @returns {array}
 */
export function getFilledOrders(investorId) {
  return Object.values(brokerState.orders)
    .filter(order => order.investorId === investorId && order.status === 'filled')
    .map(order => ({
      orderId: order.orderId,
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      averageFillPrice: parseFloat(order.averageFillPrice.toFixed(4)),
      commission: parseFloat(order.commission.toFixed(2)),
      executedAt: order.executedAt,
    }));
}

/**
 * Get account summary
 * @param {string} investorId
 * @returns {object}
 */
export function getAccountSummary(investorId) {
  // Calculate equity from positions
  let totalEquity = brokerState.accountBalance;
  Object.values(brokerState.positions).forEach(pos => {
    if (pos.quantity !== 0) {
      totalEquity += pos.unrealizedPnL;
    }
  });

  return {
    investorId,
    accountBalance: parseFloat(brokerState.accountBalance.toFixed(2)),
    equity: parseFloat(totalEquity.toFixed(2)),
    buyingPower: parseFloat(brokerState.buyingPower.toFixed(2)),
    marginUsed: parseFloat(brokerState.marginUsed.toFixed(2)),
    marginAvailable: parseFloat(brokerState.marginAvailable.toFixed(2)),
    commissionAccumulated: parseFloat(brokerState.commissionAccumulated.toFixed(2)),
    positions: getPositions(),
  };
}

// ============================================================================
// PUBLIC API: STATUS & CONFIGURATION
// ============================================================================

/**
 * Get broker connection status
 * @returns {object}
 */
export function getBrokerStatus() {
  return {
    alpaca: brokerState.brokerConnections.alpaca,
    binance: brokerState.brokerConnections.binance,
    oanda: brokerState.brokerConnections.oanda,
    connected: Object.values(brokerState.brokerConnections).every(b => b.connected),
  };
}

/**
 * Calculate slippage for a potential trade
 * @param {string} symbol
 * @param {number} quantity
 * @param {string} side
 * @returns {number} Slippage as percentage
 */
export function getSlippage(symbol, quantity, side) {
  return parseFloat((calculateSlippage(symbol, quantity, side) * 100).toFixed(4));
}

/**
 * Get commission for a potential trade
 * @param {string} symbol
 * @param {number} quantity
 * @param {number} price
 * @returns {number} Commission in USD
 */
export function getCommission(symbol, quantity, price) {
  return calculateCommission(symbol, quantity, price);
}

/**
 * Get supported order types for a symbol
 * @param {string} symbol
 * @returns {array}
 */
export function supportedOrderTypes(symbol) {
  const broker = ASSET_BROKER_MAP[symbol];
  if (!broker) return [];
  return BROKER_CONFIG[broker].orderTypes;
}

// ============================================================================
// PERSISTENCE
// ============================================================================

/**
 * Persist broker state to localStorage
 */
function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify(brokerState.orders));
    localStorage.setItem(STORAGE_KEY_FILLS, JSON.stringify(brokerState.fills));

    const accountData = {
      accountBalance: brokerState.accountBalance,
      buyingPower: brokerState.buyingPower,
      marginUsed: brokerState.marginUsed,
      marginAvailable: brokerState.marginAvailable,
      commissionAccumulated: brokerState.commissionAccumulated,
      positions: brokerState.positions,
    };
    localStorage.setItem(STORAGE_KEY_ACCOUNT, JSON.stringify(accountData));
  } catch (err) {
    console.error('Failed to persist broker state:', err);
  }
}

/**
 * Load broker state from localStorage
 */
function loadState() {
  try {
    const orders = localStorage.getItem(STORAGE_KEY_ORDERS);
    if (orders) {
      brokerState.orders = JSON.parse(orders);
    }

    const fills = localStorage.getItem(STORAGE_KEY_FILLS);
    if (fills) {
      brokerState.fills = JSON.parse(fills);
    }

    const account = localStorage.getItem(STORAGE_KEY_ACCOUNT);
    if (account) {
      const data = JSON.parse(account);
      brokerState.accountBalance = data.accountBalance || 100000;
      brokerState.buyingPower = data.buyingPower || 400000;
      brokerState.marginUsed = data.marginUsed || 0;
      brokerState.marginAvailable = data.marginAvailable || 400000;
      brokerState.commissionAccumulated = data.commissionAccumulated || 0;
      brokerState.positions = data.positions || {};
    }
  } catch (err) {
    console.error('Failed to load broker state:', err);
  }
}

export default {
  initBrokerService,
  submitOrder,
  cancelOrder,
  getOrder,
  getOpenOrders,
  getFilledOrders,
  getAccountSummary,
  processOrderBook,
  getBrokerStatus,
  getSlippage,
  getCommission,
  supportedOrderTypes,
};
