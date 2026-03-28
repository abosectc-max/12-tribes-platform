// ═══════════════════════════════════════════
//   12 TRIBES — TRADE ROUTING ENGINE
//   Paper ↔ Live execution router
//   Broker-agnostic architecture
// ═══════════════════════════════════════════

import { getOne, query, withTransaction } from '../config/database.js';
import { logger, auditLogger } from './logger.js';
import { alpacaService } from './alpacaService.js';
import { riskManager } from './riskManager.js';

// Broker registry — add new brokers here
const BROKERS = {
  alpaca: alpacaService,
  // ibkr: ibkrService,      // Future: Interactive Brokers
  // coinbase: coinbaseService, // Future: Coinbase
};

class BrokerRouter {

  // ═══════ ROUTE ORDER ═══════
  // Core routing logic: decides paper vs live, runs risk checks, executes
  async routeOrder(userId, order) {
    const startTime = Date.now();

    // 1. Get user + wallet state
    const user = await getOne('SELECT * FROM users WHERE id = $1', [userId]);
    if (!user) throw new Error('User not found');

    const wallet = await getOne('SELECT * FROM wallets WHERE user_id = $1', [userId]);
    if (!wallet) throw new Error('Wallet not found');

    const mode = user.trading_mode; // 'paper' or 'live'

    // 2. Run risk checks (applies to both paper and live)
    const riskCheck = await riskManager.preTradeCheck(userId, wallet, order);
    if (!riskCheck.approved) {
      auditLogger.info('Order rejected by risk manager', {
        userId, order, reason: riskCheck.reason, mode,
      });
      return {
        success: false,
        error: riskCheck.reason,
        code: 'RISK_REJECTED',
        riskDetails: riskCheck,
      };
    }

    // 3. Check if order requires human confirmation
    const requiresConfirmation = await this._checkConfirmation(wallet, order);
    if (requiresConfirmation) {
      const queued = await this._queueOrder(userId, order, mode);
      return {
        success: true,
        status: 'pending_confirmation',
        orderId: queued.id,
        message: `Order requires confirmation (value: $${(order.quantity * (order.price || 0)).toFixed(2)})`,
      };
    }

    // 4. Execute based on mode
    let result;
    if (mode === 'live') {
      result = await this._executeLive(userId, wallet, order);
    } else {
      result = await this._executePaper(userId, wallet, order);
    }

    // 5. Audit log
    const duration = Date.now() - startTime;
    auditLogger.info('Order executed', {
      userId,
      mode,
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      success: result.success,
      duration,
      brokerOrderId: result.brokerOrderId || null,
    });

    return result;
  }

  // ═══════ PAPER EXECUTION ═══════
  async _executePaper(userId, wallet, order) {
    return await withTransaction(async (client) => {
      const price = order.price || await this._getLatestPrice(order.symbol);
      if (!price) return { success: false, error: `No price data for ${order.symbol}` };

      const costCents = Math.round(price * order.quantity * 100);
      const side = order.side === 'BUY' ? 'LONG' : order.side === 'SELL' ? 'SHORT' : order.side;

      // Check balance
      if (side === 'LONG' && costCents > wallet.balance) {
        return { success: false, error: 'Insufficient balance' };
      }

      // Deduct from wallet
      const deduction = side === 'LONG' ? costCents : Math.round(costCents * 0.1);
      await client.query(
        'UPDATE wallets SET balance = balance - $1, trade_count = trade_count + 1, updated_at = NOW() WHERE id = $2',
        [deduction, wallet.id]
      );

      // Create position
      const pos = await client.query(
        `INSERT INTO positions (user_id, wallet_id, symbol, side, quantity, entry_price, current_price, agent, execution_mode, stop_loss_price, take_profit_price)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7, 'paper', $8, $9) RETURNING *`,
        [userId, wallet.id, order.symbol, side, order.quantity, price, order.agent, order.stopLoss, order.takeProfit]
      );

      return {
        success: true,
        mode: 'paper',
        position: pos.rows[0],
        fillPrice: price,
        message: `Paper ${side} ${order.quantity} ${order.symbol} @ $${price}`,
      };
    });
  }

  // ═══════ LIVE EXECUTION ═══════
  async _executeLive(userId, wallet, order) {
    // Get broker connection
    const brokerConn = await getOne(
      'SELECT * FROM broker_connections WHERE user_id = $1 AND is_active = true',
      [userId]
    );

    if (!brokerConn) {
      return { success: false, error: 'No active broker connection. Link a broker account first.', code: 'NO_BROKER' };
    }

    // Check kill switch
    if (wallet.kill_switch_active) {
      return { success: false, error: 'Kill switch is active. Disable it in settings to resume trading.', code: 'KILL_SWITCH' };
    }

    const broker = BROKERS[brokerConn.broker_name];
    if (!broker) {
      return { success: false, error: `Broker ${brokerConn.broker_name} not supported` };
    }

    try {
      // Execute through broker
      const brokerResult = await broker.submitOrder(brokerConn, {
        symbol: order.symbol,
        qty: order.quantity,
        side: order.side === 'LONG' ? 'buy' : 'sell',
        type: order.orderType || 'market',
        time_in_force: 'day',
        limit_price: order.limitPrice,
        stop_price: order.stopPrice,
      });

      // Record position in our database
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO positions (user_id, wallet_id, symbol, side, quantity, entry_price, agent, execution_mode, broker_order_id, stop_loss_price, take_profit_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'live', $8, $9, $10)`,
          [userId, wallet.id, order.symbol, order.side, order.quantity, brokerResult.filled_avg_price || order.price,
           order.agent, brokerResult.id, order.stopLoss, order.takeProfit]
        );

        await client.query(
          'UPDATE wallets SET trade_count = trade_count + 1, updated_at = NOW() WHERE id = $1',
          [wallet.id]
        );
      });

      return {
        success: true,
        mode: 'live',
        brokerOrderId: brokerResult.id,
        brokerStatus: brokerResult.status,
        fillPrice: brokerResult.filled_avg_price,
        message: `LIVE ${order.side} ${order.quantity} ${order.symbol} via ${brokerConn.broker_name}`,
      };
    } catch (err) {
      logger.error(`Live order execution failed: ${err.message}`, { userId, order });
      return { success: false, error: `Broker execution failed: ${err.message}`, code: 'BROKER_ERROR' };
    }
  }

  // ═══════ CLOSE POSITION ═══════
  async closePosition(userId, positionId) {
    const position = await getOne(
      'SELECT * FROM positions WHERE id = $1 AND user_id = $2 AND status = $3',
      [positionId, userId, 'OPEN']
    );

    if (!position) return { success: false, error: 'Position not found or already closed' };

    if (position.execution_mode === 'live') {
      return await this._closeLivePosition(userId, position);
    } else {
      return await this._closePaperPosition(userId, position);
    }
  }

  async _closePaperPosition(userId, position) {
    return await withTransaction(async (client) => {
      const currentPrice = position.current_price || position.entry_price;
      const direction = position.side === 'LONG' ? 1 : -1;
      const pnlCents = Math.round((currentPrice - position.entry_price) * position.quantity * direction * 100);
      const costCents = Math.round(position.entry_price * position.quantity * 100);
      const returnBack = position.side === 'LONG' ? costCents + pnlCents : Math.round(costCents * 0.1) + pnlCents;
      const holdTime = Math.round((Date.now() - new Date(position.opened_at).getTime()) / 1000);
      const returnPct = ((currentPrice / position.entry_price - 1) * 100 * direction).toFixed(4);

      // Update wallet
      const pnlUpdate = pnlCents >= 0 ? 'win_count = win_count + 1' : 'loss_count = loss_count + 1';
      await client.query(
        `UPDATE wallets SET balance = balance + $1, realized_pnl = realized_pnl + $2, ${pnlUpdate}, updated_at = NOW()
         WHERE user_id = $3`,
        [returnBack, pnlCents, userId]
      );

      // Move to trades table
      await client.query(
        `INSERT INTO trades (user_id, wallet_id, position_id, symbol, side, quantity, entry_price, close_price, realized_pnl, return_pct, agent, execution_mode, opened_at, hold_time_seconds)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'paper', $12, $13)`,
        [userId, position.wallet_id, position.id, position.symbol, position.side, position.quantity,
         position.entry_price, currentPrice, pnlCents, returnPct, position.agent, position.opened_at, holdTime]
      );

      // Close position
      await client.query("UPDATE positions SET status = 'CLOSED', updated_at = NOW() WHERE id = $1", [position.id]);

      // Update agent stats
      if (position.agent) {
        const agentUpdate = pnlCents >= 0
          ? 'wins = wins + 1, best_trade = GREATEST(best_trade, $2)'
          : 'losses = losses + 1, worst_trade = LEAST(worst_trade, $2)';
        await client.query(
          `UPDATE agent_stats SET total_trades = total_trades + 1, total_pnl = total_pnl + $2, ${agentUpdate}, updated_at = NOW()
           WHERE agent_name = $1`,
          [position.agent, pnlCents]
        );
      }

      return {
        success: true,
        mode: 'paper',
        pnl: pnlCents / 100,
        returnPct: parseFloat(returnPct),
        closePrice: currentPrice,
      };
    });
  }

  async _closeLivePosition(userId, position) {
    const brokerConn = await getOne(
      'SELECT * FROM broker_connections WHERE user_id = $1 AND is_active = true',
      [userId]
    );
    if (!brokerConn) return { success: false, error: 'No active broker connection' };

    const broker = BROKERS[brokerConn.broker_name];
    if (!broker) return { success: false, error: `Broker ${brokerConn.broker_name} not supported` };

    try {
      const closeSide = position.side === 'LONG' ? 'sell' : 'buy';
      const result = await broker.submitOrder(brokerConn, {
        symbol: position.symbol,
        qty: position.quantity,
        side: closeSide,
        type: 'market',
        time_in_force: 'day',
      });

      // Record the close in database
      await withTransaction(async (client) => {
        const closePrice = result.filled_avg_price || position.current_price;
        const direction = position.side === 'LONG' ? 1 : -1;
        const pnlCents = Math.round((closePrice - position.entry_price) * position.quantity * direction * 100);

        await client.query(
          `INSERT INTO trades (user_id, wallet_id, position_id, symbol, side, quantity, entry_price, close_price, realized_pnl, agent, execution_mode, broker_order_id, opened_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'live', $11, $12)`,
          [userId, position.wallet_id, position.id, position.symbol, position.side, position.quantity,
           position.entry_price, closePrice, pnlCents, position.agent, result.id, position.opened_at]
        );

        const pnlUpdate = pnlCents >= 0 ? 'win_count = win_count + 1' : 'loss_count = loss_count + 1';
        await client.query(
          `UPDATE wallets SET realized_pnl = realized_pnl + $1, ${pnlUpdate}, updated_at = NOW() WHERE user_id = $2`,
          [pnlCents, userId]
        );

        await client.query("UPDATE positions SET status = 'CLOSED', updated_at = NOW() WHERE id = $1", [position.id]);
      });

      return {
        success: true,
        mode: 'live',
        brokerOrderId: result.id,
        closePrice: result.filled_avg_price,
      };
    } catch (err) {
      logger.error(`Live position close failed: ${err.message}`, { userId, positionId: position.id });
      return { success: false, error: `Broker close failed: ${err.message}` };
    }
  }

  // ═══════ CONFIRM QUEUED ORDER ═══════
  async confirmOrder(userId, orderId) {
    const order = await getOne(
      "SELECT * FROM order_queue WHERE id = $1 AND user_id = $2 AND status = 'pending_confirmation'",
      [orderId, userId]
    );
    if (!order) return { success: false, error: 'Order not found or already processed' };

    // Check expiry
    if (new Date(order.expires_at) < new Date()) {
      await query("UPDATE order_queue SET status = 'expired' WHERE id = $1", [orderId]);
      return { success: false, error: 'Order expired' };
    }

    await query(
      "UPDATE order_queue SET status = 'confirmed', confirmed_at = NOW(), confirmed_by = $1 WHERE id = $2",
      [userId, orderId]
    );

    // Execute the confirmed order
    return await this.routeOrder(userId, {
      symbol: order.symbol,
      side: order.side,
      quantity: parseFloat(order.quantity),
      orderType: order.order_type,
      limitPrice: order.limit_price,
      stopPrice: order.stop_price,
      agent: order.agent,
      _skipConfirmation: true,
    });
  }

  // ═══════ HELPERS ═══════

  async _checkConfirmation(wallet, order) {
    if (order._skipConfirmation) return false;
    const estimatedValue = order.quantity * (order.price || 0);
    return estimatedValue > (wallet.max_position_size ? wallet.max_position_size / 100 : 10000);
  }

  async _queueOrder(userId, order, mode) {
    const result = await query(
      `INSERT INTO order_queue (user_id, symbol, side, quantity, order_type, limit_price, stop_price, execution_mode, agent, requires_confirmation, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, 'pending_confirmation') RETURNING *`,
      [userId, order.symbol, order.side, order.quantity, order.orderType || 'MARKET',
       order.limitPrice, order.stopPrice, mode, order.agent]
    );
    return result.rows[0];
  }

  async _getLatestPrice(symbol) {
    // This will be replaced with real market data service
    // For now return null (caller must provide price)
    return null;
  }
}

export const brokerRouter = new BrokerRouter();
