// ═══════════════════════════════════════════
//   12 TRIBES — RISK MANAGEMENT ENGINE
//   Pre-trade checks | Kill switch | Drawdown limits
//   Defense-in-depth for capital preservation
// ═══════════════════════════════════════════

import config from '../config/index.js';
import { getOne, getMany, query } from '../config/database.js';
import { logger, auditLogger } from './logger.js';

class RiskManager {

  // ═══════ PRE-TRADE RISK CHECK ═══════
  // Must pass ALL checks before order execution
  async preTradeCheck(userId, wallet, order) {
    const checks = [];

    // 1. Kill switch
    if (wallet.kill_switch_active) {
      return this._reject('Kill switch is active. All trading halted.', 'KILL_SWITCH');
    }

    // 2. Position size limit
    const positionCheck = await this._checkPositionSize(wallet, order);
    checks.push(positionCheck);
    if (!positionCheck.passed) return this._reject(positionCheck.reason, 'POSITION_SIZE');

    // 3. Daily loss limit
    const dailyLossCheck = await this._checkDailyLoss(userId, wallet);
    checks.push(dailyLossCheck);
    if (!dailyLossCheck.passed) return this._reject(dailyLossCheck.reason, 'DAILY_LOSS');

    // 4. Portfolio drawdown
    const drawdownCheck = await this._checkDrawdown(wallet);
    checks.push(drawdownCheck);
    if (!drawdownCheck.passed) return this._reject(drawdownCheck.reason, 'DRAWDOWN');

    // 5. Concentration limit (no single position > X% of portfolio)
    const concentrationCheck = await this._checkConcentration(userId, wallet, order);
    checks.push(concentrationCheck);
    if (!concentrationCheck.passed) return this._reject(concentrationCheck.reason, 'CONCENTRATION');

    // 6. Order rate check (prevent rapid-fire trading)
    const rateCheck = await this._checkOrderRate(userId);
    checks.push(rateCheck);
    if (!rateCheck.passed) return this._reject(rateCheck.reason, 'ORDER_RATE');

    return { approved: true, checks };
  }

  // ─── Position Size Check ───
  async _checkPositionSize(wallet, order) {
    const maxPct = config.risk.maxPositionSizePct;
    const equityDollars = wallet.equity / 100; // cents to dollars
    const maxPositionDollars = equityDollars * (maxPct / 100);
    const orderValueDollars = order.quantity * (order.price || 0);

    if (orderValueDollars > maxPositionDollars && order.price) {
      return {
        passed: false,
        reason: `Position size $${orderValueDollars.toFixed(0)} exceeds ${maxPct}% limit ($${maxPositionDollars.toFixed(0)})`,
      };
    }
    return { passed: true };
  }

  // ─── Daily Loss Limit ───
  async _checkDailyLoss(userId, wallet) {
    const maxDailyLossPct = config.risk.maxDailyLossPct;
    const equityDollars = wallet.equity / 100;
    const initialDollars = wallet.initial_balance / 100;

    // Get today's starting equity from snapshots
    const todayStart = await getOne(
      `SELECT equity FROM equity_snapshots WHERE user_id = $1 AND snapshot_date = CURRENT_DATE ORDER BY snapshot_hour ASC LIMIT 1`,
      [userId]
    );

    const startEquity = todayStart ? todayStart.equity / 100 : initialDollars;
    const dailyLoss = startEquity - equityDollars;
    const dailyLossPct = (dailyLoss / startEquity) * 100;

    if (dailyLossPct >= maxDailyLossPct) {
      // Trigger daily loss limit
      await this._logRiskEvent(userId, 'daily_loss_limit', 'critical',
        `Daily loss ${dailyLossPct.toFixed(2)}% exceeded ${maxDailyLossPct}% limit`);

      return {
        passed: false,
        reason: `Daily loss limit reached: -${dailyLossPct.toFixed(2)}% (max: ${maxDailyLossPct}%)`,
      };
    }
    return { passed: true, dailyLossPct };
  }

  // ─── Portfolio Drawdown Check ───
  async _checkDrawdown(wallet) {
    const maxDrawdownPct = config.risk.maxPortfolioDrawdownPct;
    const killSwitchPct = config.risk.killSwitchDrawdownPct;

    const equityDollars = wallet.equity / 100;
    const initialDollars = wallet.initial_balance / 100;

    // Simple drawdown from initial
    const drawdownPct = ((initialDollars - equityDollars) / initialDollars) * 100;

    // Auto kill switch at severe drawdown
    if (drawdownPct >= killSwitchPct) {
      await this._activateKillSwitch(wallet.user_id,
        `Auto kill switch: Drawdown ${drawdownPct.toFixed(2)}% exceeded ${killSwitchPct}% threshold`);
      return {
        passed: false,
        reason: `KILL SWITCH ACTIVATED: Portfolio drawdown ${drawdownPct.toFixed(2)}% exceeded emergency threshold (${killSwitchPct}%)`,
      };
    }

    if (drawdownPct >= maxDrawdownPct) {
      return {
        passed: false,
        reason: `Portfolio drawdown -${drawdownPct.toFixed(2)}% exceeded limit (${maxDrawdownPct}%)`,
      };
    }
    return { passed: true, drawdownPct };
  }

  // ─── Concentration Check ───
  async _checkConcentration(userId, wallet, order) {
    const maxConcentration = 25; // No single symbol > 25% of equity
    const equityDollars = wallet.equity / 100;

    // Get existing positions in same symbol
    const existing = await getMany(
      `SELECT SUM(quantity * entry_price) as total_exposure FROM positions
       WHERE user_id = $1 AND symbol = $2 AND status = 'OPEN'`,
      [userId, order.symbol]
    );

    const currentExposure = existing[0]?.total_exposure ? parseFloat(existing[0].total_exposure) : 0;
    const newExposure = currentExposure + (order.quantity * (order.price || 0));
    const concentrationPct = (newExposure / equityDollars) * 100;

    if (concentrationPct > maxConcentration && equityDollars > 0) {
      return {
        passed: false,
        reason: `${order.symbol} concentration ${concentrationPct.toFixed(1)}% exceeds ${maxConcentration}% limit`,
      };
    }
    return { passed: true, concentrationPct };
  }

  // ─── Order Rate Check ───
  async _checkOrderRate(userId) {
    const maxPerMinute = config.risk.maxOrdersPerMinute;
    const recentOrders = await getOne(
      `SELECT COUNT(*) as count FROM positions WHERE user_id = $1 AND opened_at > NOW() - INTERVAL '1 minute'`,
      [userId]
    );

    if (parseInt(recentOrders?.count || 0) >= maxPerMinute) {
      return {
        passed: false,
        reason: `Order rate limit: ${maxPerMinute} orders per minute exceeded`,
      };
    }
    return { passed: true };
  }

  // ═══════ KILL SWITCH ═══════
  async _activateKillSwitch(userId, reason) {
    await query(
      'UPDATE wallets SET kill_switch_active = true, updated_at = NOW() WHERE user_id = $1',
      [userId]
    );

    await this._logRiskEvent(userId, 'kill_switch', 'critical', reason);

    auditLogger.error('KILL SWITCH ACTIVATED', { userId, reason });
    logger.error(`🔴 KILL SWITCH ACTIVATED for user ${userId}: ${reason}`);
  }

  async deactivateKillSwitch(userId, confirmedBy) {
    await query(
      'UPDATE wallets SET kill_switch_active = false, updated_at = NOW() WHERE user_id = $1',
      [userId]
    );

    await this._logRiskEvent(userId, 'kill_switch', 'info',
      `Kill switch deactivated by ${confirmedBy}`);

    auditLogger.info('Kill switch deactivated', { userId, confirmedBy });
    return { success: true };
  }

  // ═══════ RISK MONITORING (called periodically) ═══════
  async monitorPortfolio(userId) {
    const wallet = await getOne('SELECT * FROM wallets WHERE user_id = $1', [userId]);
    if (!wallet) return null;

    const equityDollars = wallet.equity / 100;
    const initialDollars = wallet.initial_balance / 100;
    const drawdownPct = ((initialDollars - equityDollars) / initialDollars) * 100;
    const positions = await getMany(
      "SELECT * FROM positions WHERE user_id = $1 AND status = 'OPEN'",
      [userId]
    );

    // Check for alert thresholds
    const alerts = [];

    if (drawdownPct > config.risk.maxPortfolioDrawdownPct * 0.8) {
      alerts.push({ type: 'drawdown_warning', severity: 'warning',
        message: `Drawdown approaching limit: -${drawdownPct.toFixed(2)}%` });
    }

    // Check individual position losses
    positions.forEach(pos => {
      const posLossPct = pos.return_pct;
      if (posLossPct < -10) {
        alerts.push({ type: 'position_loss', severity: 'warning',
          message: `${pos.symbol} position down ${posLossPct.toFixed(2)}%` });
      }
    });

    return {
      equity: equityDollars,
      drawdownPct,
      openPositions: positions.length,
      killSwitchActive: wallet.kill_switch_active,
      alerts,
    };
  }

  // ═══════ RISK DASHBOARD DATA ═══════
  async getRiskDashboard(userId) {
    const wallet = await getOne('SELECT * FROM wallets WHERE user_id = $1', [userId]);
    const positions = await getMany(
      "SELECT * FROM positions WHERE user_id = $1 AND status = 'OPEN'",
      [userId]
    );
    const recentEvents = await getMany(
      'SELECT * FROM risk_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [userId]
    );
    const trades = await getMany(
      'SELECT * FROM trades WHERE user_id = $1 ORDER BY closed_at DESC LIMIT 50',
      [userId]
    );

    if (!wallet) return null;

    const equityDollars = wallet.equity / 100;
    const initialDollars = wallet.initial_balance / 100;

    // Win rate
    const totalTrades = wallet.win_count + wallet.loss_count;
    const winRate = totalTrades > 0 ? (wallet.win_count / totalTrades * 100) : 0;

    // Sharpe ratio (simplified)
    const returns = trades.map(t => t.realized_pnl / 100);
    const avgReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
    const stdDev = returns.length > 1
      ? Math.sqrt(returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length)
      : 0;
    const sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

    // Concentration
    const positionsBySymbol = {};
    positions.forEach(p => {
      const val = parseFloat(p.quantity) * parseFloat(p.current_price || p.entry_price);
      positionsBySymbol[p.symbol] = (positionsBySymbol[p.symbol] || 0) + val;
    });
    const maxConcentration = Object.values(positionsBySymbol).reduce((max, val) =>
      Math.max(max, equityDollars > 0 ? (val / equityDollars * 100) : 0), 0);

    return {
      equity: equityDollars,
      drawdownPct: ((initialDollars - equityDollars) / initialDollars * 100),
      winRate,
      sharpeRatio: sharpe,
      maxConcentration,
      openPositions: positions.length,
      killSwitchActive: wallet.kill_switch_active,
      limits: config.risk,
      recentEvents,
    };
  }

  // ═══════ HELPERS ═══════
  _reject(reason, code) {
    return { approved: false, reason, code };
  }

  async _logRiskEvent(userId, eventType, severity, message, metadata = null) {
    await query(
      'INSERT INTO risk_events (user_id, event_type, severity, message, metadata) VALUES ($1, $2, $3, $4, $5)',
      [userId, eventType, severity, message, metadata ? JSON.stringify(metadata) : null]
    );
  }
}

export const riskManager = new RiskManager();
