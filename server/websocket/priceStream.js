// ═══════════════════════════════════════════
//   12 TRIBES — REAL-TIME PRICE STREAM
//   WebSocket server + Alpaca data feed
//   Push live prices to all connected clients
// ═══════════════════════════════════════════

import { WebSocketServer, WebSocket } from 'ws';
import config from '../config/index.js';
import { logger } from '../services/logger.js';

class PriceStream {
  constructor() {
    this.wss = null;           // Our WebSocket server (to clients)
    this.alpacaWs = null;      // Alpaca data stream (from market)
    this.clients = new Map();  // clientId -> { ws, userId, subscriptions }
    this.latestPrices = {};    // symbol -> { price, bid, ask, timestamp }
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.subscribedSymbols = new Set();
  }

  // ═══════ INITIALIZE SERVER ═══════
  init(httpServer) {
    this.wss = new WebSocketServer({
      server: httpServer,
      path: '/ws/prices',
      perMessageDeflate: false,
    });

    this.wss.on('connection', (ws, req) => this._handleClientConnect(ws, req));

    logger.info('WebSocket price stream server initialized on /ws/prices');

    // Connect to market data source
    this._connectToMarketData();

    // Heartbeat interval — detect dead connections
    this._startHeartbeat();

    return this;
  }

  // ═══════ CLIENT CONNECTION HANDLING ═══════
  _handleClientConnect(ws, req) {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const clientInfo = {
      ws,
      userId: null,
      subscriptions: new Set(),
      lastPing: Date.now(),
    };

    this.clients.set(clientId, clientInfo);
    logger.info(`Price stream client connected: ${clientId} (${this.clients.size} total)`);

    // Send current price snapshot immediately
    ws.send(JSON.stringify({
      type: 'snapshot',
      data: this.latestPrices,
      timestamp: Date.now(),
    }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        this._handleClientMessage(clientId, msg);
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      }
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
      logger.debug(`Price stream client disconnected: ${clientId} (${this.clients.size} remaining)`);
      this._recomputeSubscriptions();
    });

    ws.on('pong', () => {
      clientInfo.lastPing = Date.now();
    });
  }

  _handleClientMessage(clientId, msg) {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (msg.type) {
      case 'authenticate':
        client.userId = msg.userId;
        break;

      case 'subscribe':
        if (Array.isArray(msg.symbols)) {
          msg.symbols.forEach(s => client.subscriptions.add(s.toUpperCase()));
          this._recomputeSubscriptions();
        }
        break;

      case 'unsubscribe':
        if (Array.isArray(msg.symbols)) {
          msg.symbols.forEach(s => client.subscriptions.delete(s.toUpperCase()));
          this._recomputeSubscriptions();
        }
        break;

      default:
        client.ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
    }
  }

  // ═══════ ALPACA DATA STREAM ═══════
  _connectToMarketData() {
    if (!config.alpaca.paper.apiKey) {
      logger.warn('No Alpaca API key configured — running in simulation mode');
      this._startSimulatedFeed();
      return;
    }

    const wsUrl = config.marketData.useAlpacaData
      ? 'wss://stream.data.alpaca.markets/v2/iex'
      : `wss://socket.polygon.io/stocks`;

    try {
      this.alpacaWs = new WebSocket(wsUrl);

      this.alpacaWs.on('open', () => {
        logger.info('Connected to Alpaca data stream');
        this.reconnectAttempts = 0;

        // Authenticate
        this.alpacaWs.send(JSON.stringify({
          action: 'auth',
          key: config.alpaca.paper.apiKey,
          secret: config.alpaca.paper.apiSecret,
        }));
      });

      this.alpacaWs.on('message', (raw) => {
        try {
          const messages = JSON.parse(raw);
          if (!Array.isArray(messages)) return;

          messages.forEach(msg => {
            if (msg.T === 'q') {
              // Quote update
              this._updatePrice(msg.S, {
                price: (msg.ap + msg.bp) / 2,  // midpoint
                ask: msg.ap,
                bid: msg.bp,
                askSize: msg.as,
                bidSize: msg.bs,
                timestamp: msg.t,
              });
            } else if (msg.T === 't') {
              // Trade update
              this._updatePrice(msg.S, {
                price: msg.p,
                size: msg.s,
                timestamp: msg.t,
              });
            } else if (msg.T === 'success' && msg.msg === 'authenticated') {
              logger.info('Alpaca data stream authenticated');
              this._subscribeToMarketData();
            }
          });
        } catch (err) {
          logger.error('Error parsing Alpaca message:', err);
        }
      });

      this.alpacaWs.on('close', () => {
        logger.warn('Alpaca data stream disconnected');
        this._scheduleReconnect();
      });

      this.alpacaWs.on('error', (err) => {
        logger.error('Alpaca WebSocket error:', err.message);
      });
    } catch (err) {
      logger.error('Failed to connect to market data:', err.message);
      this._startSimulatedFeed();
    }
  }

  _subscribeToMarketData() {
    if (!this.alpacaWs || this.alpacaWs.readyState !== WebSocket.OPEN) return;

    const symbols = Array.from(this.subscribedSymbols);
    if (symbols.length === 0) {
      // Default watchlist
      symbols.push('AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'JPM', 'SPY', 'QQQ');
    }

    this.alpacaWs.send(JSON.stringify({
      action: 'subscribe',
      quotes: symbols,
      trades: symbols,
    }));

    logger.info(`Subscribed to market data for ${symbols.length} symbols`);
  }

  _recomputeSubscriptions() {
    const allSymbols = new Set();
    this.clients.forEach(client => {
      client.subscriptions.forEach(s => allSymbols.add(s));
    });

    const newSymbols = [...allSymbols].filter(s => !this.subscribedSymbols.has(s));
    const removedSymbols = [...this.subscribedSymbols].filter(s => !allSymbols.has(s));

    if (newSymbols.length > 0 && this.alpacaWs?.readyState === WebSocket.OPEN) {
      this.alpacaWs.send(JSON.stringify({ action: 'subscribe', quotes: newSymbols, trades: newSymbols }));
    }
    if (removedSymbols.length > 0 && this.alpacaWs?.readyState === WebSocket.OPEN) {
      this.alpacaWs.send(JSON.stringify({ action: 'unsubscribe', quotes: removedSymbols, trades: removedSymbols }));
    }

    this.subscribedSymbols = allSymbols;
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnect attempts reached. Falling back to simulation.');
      this._startSimulatedFeed();
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    logger.info(`Reconnecting to market data in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => this._connectToMarketData(), delay);
  }

  // ═══════ SIMULATED FEED (fallback) ═══════
  _startSimulatedFeed() {
    logger.info('Starting simulated price feed');

    const DEFAULT_PRICES = {
      "AAPL": 227.50, "MSFT": 422.30, "NVDA": 138.20, "TSLA": 278.40,
      "AMZN": 198.60, "GOOGL": 175.80, "META": 612.40, "JPM": 248.90,
      "BTC/USD": 87432, "ETH/USD": 3287, "SOL/USD": 187.50,
      "EUR/USD": 1.0842, "GBP/USD": 1.2934, "USD/JPY": 150.85,
      "SPY": 521.47, "QQQ": 441.22, "GLD": 284.70, "TLT": 87.30,
    };

    // Initialize
    Object.entries(DEFAULT_PRICES).forEach(([symbol, price]) => {
      this.latestPrices[symbol] = { price, bid: price * 0.9998, ask: price * 1.0002, timestamp: Date.now() };
    });

    // Tick every 2 seconds
    this._simInterval = setInterval(() => {
      Object.keys(this.latestPrices).forEach(symbol => {
        const current = this.latestPrices[symbol].price;
        const volatility = symbol.includes('/') ? 0.0003 : symbol.includes('BTC') ? 0.002 : 0.001;
        const change = current * (Math.random() - 0.498) * volatility;
        const newPrice = parseFloat((current + change).toFixed(current < 10 ? 4 : 2));

        this._updatePrice(symbol, {
          price: newPrice,
          bid: parseFloat((newPrice * 0.9998).toFixed(current < 10 ? 4 : 2)),
          ask: parseFloat((newPrice * 1.0002).toFixed(current < 10 ? 4 : 2)),
          timestamp: Date.now(),
          simulated: true,
        });
      });
    }, 2000);
  }

  // ═══════ BROADCAST ═══════
  _updatePrice(symbol, data) {
    this.latestPrices[symbol] = { ...this.latestPrices[symbol], ...data };

    // Broadcast to subscribed clients
    const message = JSON.stringify({
      type: 'price',
      symbol,
      data,
    });

    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        // Send if client subscribes to this symbol, or if they have no specific subscriptions (send all)
        if (client.subscriptions.size === 0 || client.subscriptions.has(symbol)) {
          client.ws.send(message);
        }
      }
    });
  }

  // Broadcast arbitrary event to all clients
  broadcast(type, data) {
    const message = JSON.stringify({ type, data, timestamp: Date.now() });
    this.clients.forEach(client => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    });
  }

  // ═══════ HEARTBEAT ═══════
  _startHeartbeat() {
    setInterval(() => {
      const now = Date.now();
      this.clients.forEach((client, clientId) => {
        if (now - client.lastPing > 60000) {
          // Client hasn't responded to ping in 60s — terminate
          client.ws.terminate();
          this.clients.delete(clientId);
          return;
        }
        client.ws.ping();
      });
    }, 30000);
  }

  // ═══════ PUBLIC API ═══════
  getLatestPrices() {
    return { ...this.latestPrices };
  }

  getPrice(symbol) {
    return this.latestPrices[symbol]?.price || null;
  }

  getClientCount() {
    return this.clients.size;
  }

  getStatus() {
    return {
      clients: this.clients.size,
      symbols: Object.keys(this.latestPrices).length,
      alpacaConnected: this.alpacaWs?.readyState === WebSocket.OPEN,
      simulated: !!this._simInterval,
    };
  }

  shutdown() {
    if (this._simInterval) clearInterval(this._simInterval);
    if (this.alpacaWs) this.alpacaWs.close();
    if (this.wss) this.wss.close();
    logger.info('Price stream server shut down');
  }
}

export const priceStream = new PriceStream();
