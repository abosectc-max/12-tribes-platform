// ═══════════════════════════════════════════
//   12 TRIBES — ALPACA BROKERAGE SERVICE
//   REST API + WebSocket integration
//   Supports paper and live trading
// ═══════════════════════════════════════════

import config from '../config/index.js';
import { logger, auditLogger } from './logger.js';

class AlpacaService {
  constructor() {
    this.name = 'alpaca';
  }

  // ─── API Request Helper ───
  async _request(baseUrl, path, method = 'GET', body = null, headers = {}) {
    const url = `${baseUrl}${path}`;
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };
    if (body) opts.body = JSON.stringify(body);

    const response = await fetch(url, opts);
    const data = await response.json();

    if (!response.ok) {
      const error = new Error(data.message || `Alpaca API error: ${response.status}`);
      error.status = response.status;
      error.code = data.code;
      throw error;
    }

    return data;
  }

  // Authenticated request using platform keys (for platform-wide operations)
  async _platformRequest(mode, path, method = 'GET', body = null) {
    const cfg = mode === 'live' ? config.alpaca.live : config.alpaca.paper;
    return this._request(cfg.baseUrl, path, method, body, {
      'APCA-API-KEY-ID': cfg.apiKey,
      'APCA-API-SECRET-KEY': cfg.apiSecret,
    });
  }

  // Authenticated request using user's OAuth token (for user-linked accounts)
  async _userRequest(brokerConn, path, method = 'GET', body = null) {
    const baseUrl = brokerConn.account_type === 'live'
      ? config.alpaca.live.baseUrl
      : config.alpaca.paper.baseUrl;

    return this._request(baseUrl, path, method, body, {
      'Authorization': `Bearer ${brokerConn.access_token}`,
    });
  }

  // ═══════ ACCOUNT OPERATIONS ═══════

  async getAccount(brokerConn) {
    try {
      const account = await this._userRequest(brokerConn, '/v2/account');
      return {
        id: account.id,
        status: account.status,
        currency: account.currency,
        buyingPower: parseFloat(account.buying_power),
        cash: parseFloat(account.cash),
        portfolioValue: parseFloat(account.portfolio_value),
        equity: parseFloat(account.equity),
        lastEquity: parseFloat(account.last_equity),
        longMarketValue: parseFloat(account.long_market_value),
        shortMarketValue: parseFloat(account.short_market_value),
        daytradeCount: account.daytrade_count,
        patternDayTrader: account.pattern_day_trader,
        tradingBlocked: account.trading_blocked,
        accountBlocked: account.account_blocked,
      };
    } catch (err) {
      logger.error(`Alpaca getAccount failed: ${err.message}`);
      throw err;
    }
  }

  // ═══════ ORDER EXECUTION ═══════

  async submitOrder(brokerConn, order) {
    logger.info(`Submitting Alpaca order: ${order.side} ${order.qty} ${order.symbol}`);

    const alpacaOrder = {
      symbol: order.symbol,
      qty: String(order.qty),
      side: order.side,  // 'buy' or 'sell'
      type: order.type || 'market',
      time_in_force: order.time_in_force || 'day',
    };

    if (order.type === 'limit' || order.type === 'stop_limit') {
      alpacaOrder.limit_price = String(order.limit_price);
    }
    if (order.type === 'stop' || order.type === 'stop_limit') {
      alpacaOrder.stop_price = String(order.stop_price);
    }

    try {
      const result = await this._userRequest(brokerConn, '/v2/orders', 'POST', alpacaOrder);

      auditLogger.info('Alpaca order submitted', {
        orderId: result.id,
        symbol: result.symbol,
        side: result.side,
        qty: result.qty,
        type: result.type,
        status: result.status,
        filledAvgPrice: result.filled_avg_price,
      });

      return {
        id: result.id,
        clientOrderId: result.client_order_id,
        status: result.status,
        symbol: result.symbol,
        qty: parseFloat(result.qty),
        side: result.side,
        type: result.type,
        filled_avg_price: result.filled_avg_price ? parseFloat(result.filled_avg_price) : null,
        filled_qty: result.filled_qty ? parseFloat(result.filled_qty) : 0,
        created_at: result.created_at,
      };
    } catch (err) {
      auditLogger.error('Alpaca order failed', {
        symbol: order.symbol, side: order.side, error: err.message,
      });
      throw err;
    }
  }

  // Cancel an order
  async cancelOrder(brokerConn, orderId) {
    return this._userRequest(brokerConn, `/v2/orders/${orderId}`, 'DELETE');
  }

  // Get order status
  async getOrder(brokerConn, orderId) {
    return this._userRequest(brokerConn, `/v2/orders/${orderId}`);
  }

  // Get all open orders
  async getOpenOrders(brokerConn) {
    return this._userRequest(brokerConn, '/v2/orders?status=open');
  }

  // ═══════ POSITION MANAGEMENT ═══════

  async getPositions(brokerConn) {
    const positions = await this._userRequest(brokerConn, '/v2/positions');
    return positions.map(p => ({
      symbol: p.symbol,
      qty: parseFloat(p.qty),
      side: parseFloat(p.qty) > 0 ? 'LONG' : 'SHORT',
      entryPrice: parseFloat(p.avg_entry_price),
      currentPrice: parseFloat(p.current_price),
      marketValue: parseFloat(p.market_value),
      unrealizedPnL: parseFloat(p.unrealized_pl),
      unrealizedPnLPct: parseFloat(p.unrealized_plpc) * 100,
      costBasis: parseFloat(p.cost_basis),
    }));
  }

  async closePosition(brokerConn, symbol) {
    return this._userRequest(brokerConn, `/v2/positions/${symbol}`, 'DELETE');
  }

  async closeAllPositions(brokerConn) {
    return this._userRequest(brokerConn, '/v2/positions', 'DELETE');
  }

  // ═══════ MARKET DATA ═══════

  async getLatestQuote(symbol) {
    const cfg = config.alpaca.paper;
    const data = await this._request(
      cfg.dataUrl, `/v2/stocks/${symbol}/quotes/latest`, 'GET', null,
      { 'APCA-API-KEY-ID': cfg.apiKey, 'APCA-API-SECRET-KEY': cfg.apiSecret }
    );
    return {
      symbol,
      askPrice: parseFloat(data.quote.ap),
      bidPrice: parseFloat(data.quote.bp),
      askSize: data.quote.as,
      bidSize: data.quote.bs,
      timestamp: data.quote.t,
    };
  }

  async getBars(symbol, timeframe = '1Day', limit = 30) {
    const cfg = config.alpaca.paper;
    const data = await this._request(
      cfg.dataUrl, `/v2/stocks/${symbol}/bars?timeframe=${timeframe}&limit=${limit}`, 'GET', null,
      { 'APCA-API-KEY-ID': cfg.apiKey, 'APCA-API-SECRET-KEY': cfg.apiSecret }
    );
    return data.bars?.map(b => ({
      time: b.t,
      open: parseFloat(b.o),
      high: parseFloat(b.h),
      low: parseFloat(b.l),
      close: parseFloat(b.c),
      volume: b.v,
    })) || [];
  }

  async getSnapshot(symbol) {
    const cfg = config.alpaca.paper;
    return this._request(
      cfg.dataUrl, `/v2/stocks/${symbol}/snapshot`, 'GET', null,
      { 'APCA-API-KEY-ID': cfg.apiKey, 'APCA-API-SECRET-KEY': cfg.apiSecret }
    );
  }

  // ═══════ OAUTH FLOW ═══════

  getOAuthUrl(state) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.alpaca.oauth.clientId,
      redirect_uri: config.alpaca.oauth.redirectUri,
      state,
      scope: 'account:write trading',
    });
    return `https://app.alpaca.markets/oauth/authorize?${params}`;
  }

  async exchangeOAuthCode(code) {
    const response = await fetch('https://api.alpaca.markets/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: config.alpaca.oauth.clientId,
        client_secret: config.alpaca.oauth.clientSecret,
        redirect_uri: config.alpaca.oauth.redirectUri,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || 'OAuth token exchange failed');
    }

    return response.json();
  }

  // ═══════ ACCOUNT ACTIVITIES ═══════

  async getAccountActivities(brokerConn, activityType = 'FILL', limit = 50) {
    return this._userRequest(brokerConn, `/v2/account/activities/${activityType}?limit=${limit}`);
  }

  // ═══════ CLOCK & CALENDAR ═══════

  async getMarketClock() {
    const cfg = config.alpaca.paper;
    return this._request(
      cfg.baseUrl, '/v2/clock', 'GET', null,
      { 'APCA-API-KEY-ID': cfg.apiKey, 'APCA-API-SECRET-KEY': cfg.apiSecret }
    );
  }

  async isMarketOpen() {
    const clock = await this.getMarketClock();
    return clock.is_open;
  }
}

export const alpacaService = new AlpacaService();
