// ═══════════════════════════════════════════
//   12 TRIBES — TRADING ROUTES
//   Order execution, position management
// ═══════════════════════════════════════════

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { tradeLimiter } from '../middleware/rateLimit.js';
import { orderRules, closePositionRules, handleValidation } from '../middleware/validate.js';
import { brokerRouter } from '../services/brokerRouter.js';
import { riskManager } from '../services/riskManager.js';
import { getMany, getOne } from '../config/database.js';
import { priceStream } from '../websocket/priceStream.js';

const router = Router();

// ─── POST /api/trading/order ───
router.post('/order', authenticate, tradeLimiter, orderRules, handleValidation, async (req, res) => {
  try {
    const { symbol, side, quantity, orderType, limitPrice, stopPrice, stopLoss, takeProfit, agent } = req.body;

    // Attach current price from live feed
    const currentPrice = priceStream.getPrice(symbol);

    const result = await brokerRouter.routeOrder(req.userId, {
      symbol,
      side,
      quantity: parseFloat(quantity),
      orderType: orderType || 'MARKET',
      limitPrice: limitPrice ? parseFloat(limitPrice) : null,
      stopPrice: stopPrice ? parseFloat(stopPrice) : null,
      stopLoss: stopLoss ? parseFloat(stopLoss) : null,
      takeProfit: takeProfit ? parseFloat(takeProfit) : null,
      agent,
      price: currentPrice,
    });

    const status = result.success ? 200 : 400;
    res.status(status).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Order execution failed', message: err.message });
  }
});

// ─── DELETE /api/trading/positions/:positionId ───
router.delete('/positions/:positionId', authenticate, closePositionRules, handleValidation, async (req, res) => {
  try {
    const result = await brokerRouter.closePosition(req.userId, req.params.positionId);
    const status = result.success ? 200 : 400;
    res.status(status).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Close position failed', message: err.message });
  }
});

// ─── GET /api/trading/positions ───
router.get('/positions', authenticate, async (req, res) => {
  const positions = await getMany(
    "SELECT * FROM positions WHERE user_id = $1 AND status = 'OPEN' ORDER BY opened_at DESC",
    [req.userId]
  );

  // Enrich with latest prices
  const enriched = positions.map(p => {
    const livePrice = priceStream.getPrice(p.symbol);
    const currentPrice = livePrice || parseFloat(p.current_price) || parseFloat(p.entry_price);
    const direction = p.side === 'LONG' ? 1 : -1;
    const unrealizedPnl = (currentPrice - parseFloat(p.entry_price)) * parseFloat(p.quantity) * direction;
    const returnPct = ((currentPrice / parseFloat(p.entry_price) - 1) * 100 * direction);

    return {
      ...p,
      currentPrice,
      unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
      returnPct: Math.round(returnPct * 100) / 100,
    };
  });

  res.json(enriched);
});

// ─── GET /api/trading/history ───
router.get('/history', authenticate, async (req, res) => {
  const { limit = 50, offset = 0, symbol, agent } = req.query;
  let sql = 'SELECT * FROM trades WHERE user_id = $1';
  const params = [req.userId];
  let paramIdx = 2;

  if (symbol) {
    sql += ` AND symbol = $${paramIdx++}`;
    params.push(symbol.toUpperCase());
  }
  if (agent) {
    sql += ` AND agent = $${paramIdx++}`;
    params.push(agent);
  }

  sql += ` ORDER BY closed_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx}`;
  params.push(parseInt(limit), parseInt(offset));

  const trades = await getMany(sql, params);
  res.json(trades);
});

// ─── POST /api/trading/confirm/:orderId ───
router.post('/confirm/:orderId', authenticate, async (req, res) => {
  try {
    const result = await brokerRouter.confirmOrder(req.userId, req.params.orderId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Order confirmation failed', message: err.message });
  }
});

// ─── GET /api/trading/pending ───
router.get('/pending', authenticate, async (req, res) => {
  const orders = await getMany(
    "SELECT * FROM order_queue WHERE user_id = $1 AND status = 'pending_confirmation' AND expires_at > NOW() ORDER BY created_at DESC",
    [req.userId]
  );
  res.json(orders);
});

// ─── GET /api/trading/risk ───
router.get('/risk', authenticate, async (req, res) => {
  const dashboard = await riskManager.getRiskDashboard(req.userId);
  if (!dashboard) return res.status(404).json({ error: 'No wallet found' });
  res.json(dashboard);
});

// ─── POST /api/trading/kill-switch ───
router.post('/kill-switch', authenticate, async (req, res) => {
  const { action } = req.body; // 'activate' or 'deactivate'

  if (action === 'deactivate') {
    const result = await riskManager.deactivateKillSwitch(req.userId, req.userId);
    return res.json(result);
  }

  // Manual kill switch activation
  await riskManager._activateKillSwitch(req.userId, 'Manual activation by user');
  res.json({ success: true, message: 'Kill switch activated. All trading halted.' });
});

export default router;
