// ═══════════════════════════════════════════
//   12 TRIBES — MARKET DATA ROUTES
//   Prices, quotes, bars, market status
// ═══════════════════════════════════════════

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { priceStream } from '../websocket/priceStream.js';
import { alpacaService } from '../services/alpacaService.js';
import { getMany } from '../config/database.js';

const router = Router();

// ─── GET /api/market/prices ───
// Get all current prices from live feed
router.get('/prices', authenticate, (req, res) => {
  const prices = priceStream.getLatestPrices();
  res.json({
    prices,
    status: priceStream.getStatus(),
    timestamp: Date.now(),
  });
});

// ─── GET /api/market/quote/:symbol ───
router.get('/quote/:symbol', authenticate, async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cached = priceStream.getPrice(symbol);

  if (cached) {
    return res.json({ symbol, price: cached, source: 'stream', timestamp: Date.now() });
  }

  // Fallback to REST API
  try {
    const quote = await alpacaService.getLatestQuote(symbol);
    res.json({ symbol, ...quote, source: 'rest' });
  } catch (err) {
    res.status(404).json({ error: `No quote available for ${symbol}` });
  }
});

// ─── GET /api/market/bars/:symbol ───
router.get('/bars/:symbol', authenticate, async (req, res) => {
  const { timeframe = '1Day', limit = 30 } = req.query;
  try {
    const bars = await alpacaService.getBars(req.params.symbol.toUpperCase(), timeframe, parseInt(limit));
    res.json(bars);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bars' });
  }
});

// ─── GET /api/market/clock ───
router.get('/clock', authenticate, async (req, res) => {
  try {
    const clock = await alpacaService.getMarketClock();
    res.json(clock);
  } catch {
    // Fallback: estimate based on time
    const now = new Date();
    const hour = now.getUTCHours();
    const day = now.getUTCDay();
    const isWeekday = day > 0 && day < 6;
    const isMarketHours = hour >= 13.5 && hour < 20; // 9:30 AM - 4:00 PM ET
    res.json({ is_open: isWeekday && isMarketHours, timestamp: now.toISOString() });
  }
});

// ─── GET /api/market/agents ───
router.get('/agents', authenticate, async (req, res) => {
  const agents = await getMany('SELECT * FROM agent_stats ORDER BY total_pnl DESC');
  res.json(agents.map(a => ({
    ...a,
    totalPnL: a.total_pnl / 100,
    bestTrade: a.best_trade / 100,
    worstTrade: a.worst_trade / 100,
    avgReturn: parseFloat(a.avg_return),
    winRate: a.total_trades > 0 ? (a.wins / a.total_trades * 100) : 0,
  })));
});

// ─── GET /api/market/status ───
router.get('/status', (req, res) => {
  res.json({
    stream: priceStream.getStatus(),
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

export default router;
