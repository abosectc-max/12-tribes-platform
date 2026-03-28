// ═══════════════════════════════════════════
//   12 TRIBES — WALLET ROUTES
//   Balance, equity, performance snapshots
// ═══════════════════════════════════════════

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getOne, getMany, query } from '../config/database.js';

const router = Router();

// ─── GET /api/wallet ───
router.get('/', authenticate, async (req, res) => {
  const wallet = await getOne('SELECT * FROM wallets WHERE user_id = $1', [req.userId]);
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' });

  res.json({
    id: wallet.id,
    balance: wallet.balance / 100,
    initialBalance: wallet.initial_balance / 100,
    equity: wallet.equity / 100,
    unrealizedPnL: wallet.unrealized_pnl / 100,
    realizedPnL: wallet.realized_pnl / 100,
    tradeCount: wallet.trade_count,
    winCount: wallet.win_count,
    lossCount: wallet.loss_count,
    winRate: wallet.trade_count > 0 ? (wallet.win_count / (wallet.win_count + wallet.loss_count) * 100) : 0,
    depositAmount: wallet.deposit_amount / 100,
    depositTimestamp: wallet.deposit_timestamp,
    killSwitchActive: wallet.kill_switch_active,
    brokerLinked: !!wallet.broker_account_id,
    brokerName: wallet.broker_name,
  });
});

// ─── GET /api/wallet/performance ───
router.get('/performance', authenticate, async (req, res) => {
  const { period = 'monthly' } = req.query;

  const wallet = await getOne('SELECT * FROM wallets WHERE user_id = $1', [req.userId]);
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' });

  let daysBack;
  switch (period) {
    case 'daily': daysBack = 1; break;
    case 'weekly': daysBack = 7; break;
    case 'monthly': daysBack = 30; break;
    case 'annual': daysBack = 365; break;
    default: daysBack = 30;
  }

  const snapshots = await getMany(
    `SELECT DISTINCT ON (snapshot_date) snapshot_date, equity, balance, unrealized_pnl, realized_pnl, position_count
     FROM equity_snapshots WHERE user_id = $1 AND snapshot_date >= CURRENT_DATE - $2::integer
     ORDER BY snapshot_date, snapshot_hour DESC`,
    [req.userId, daysBack]
  );

  const currentEquity = wallet.equity / 100;
  const initialBalance = wallet.initial_balance / 100;

  // Period start equity
  const startSnap = snapshots.length > 0 ? snapshots[0] : null;
  const startEquity = startSnap ? startSnap.equity / 100 : initialBalance;
  const periodReturn = startEquity > 0 ? ((currentEquity - startEquity) / startEquity * 100) : 0;
  const periodPnL = currentEquity - startEquity;

  // All-time
  const allTimeReturn = initialBalance > 0 ? ((currentEquity - initialBalance) / initialBalance * 100) : 0;

  // Max drawdown
  let maxDrawdown = 0;
  let peak = initialBalance;
  snapshots.forEach(s => {
    const eq = s.equity / 100;
    if (eq > peak) peak = eq;
    const dd = (eq - peak) / peak * 100;
    if (dd < maxDrawdown) maxDrawdown = dd;
  });

  res.json({
    period,
    currentEquity,
    initialBalance,
    periodReturn,
    periodPnL,
    allTimeReturn,
    allTimePnL: currentEquity - initialBalance,
    maxDrawdown,
    snapshots: snapshots.map(s => ({
      date: s.snapshot_date,
      equity: s.equity / 100,
      balance: s.balance / 100,
      unrealizedPnL: s.unrealized_pnl / 100,
      positionCount: s.position_count,
    })),
  });
});

// ─── POST /api/wallet/snapshot ───
// Called by frontend to record equity snapshot
router.post('/snapshot', authenticate, async (req, res) => {
  const wallet = await getOne('SELECT * FROM wallets WHERE user_id = $1', [req.userId]);
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' });

  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const hour = now.getHours();

  await query(
    `INSERT INTO equity_snapshots (user_id, equity, balance, unrealized_pnl, realized_pnl, position_count, snapshot_date, snapshot_hour)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, snapshot_date, snapshot_hour) DO UPDATE
     SET equity = $2, balance = $3, unrealized_pnl = $4, realized_pnl = $5, position_count = $6, snapped_at = NOW()`,
    [req.userId, wallet.equity, wallet.balance, wallet.unrealized_pnl, wallet.realized_pnl, wallet.trade_count, date, hour]
  );

  res.json({ success: true });
});

// ─── GET /api/wallet/group ───
// Group-wide stats for the 12 Tribes collective
router.get('/group', authenticate, async (req, res) => {
  const result = await getOne(`
    SELECT
      COUNT(*) as investor_count,
      COALESCE(SUM(equity), 0) as total_equity,
      COALESCE(SUM(initial_balance), 0) as total_initial,
      COALESCE(SUM(realized_pnl), 0) as total_realized_pnl,
      COALESCE(SUM(unrealized_pnl), 0) as total_unrealized_pnl,
      COALESCE(SUM(trade_count), 0) as total_trades,
      COALESCE(SUM(win_count), 0) as total_wins,
      COALESCE(SUM(loss_count), 0) as total_losses
    FROM wallets
  `);

  const positions = await getOne("SELECT COUNT(*) as count FROM positions WHERE status = 'OPEN'");
  const closedTrades = await getOne("SELECT COUNT(*) as count FROM trades");

  res.json({
    investorCount: parseInt(result.investor_count),
    totalEquity: parseInt(result.total_equity) / 100,
    totalInitial: parseInt(result.total_initial) / 100,
    totalRealizedPnL: parseInt(result.total_realized_pnl) / 100,
    totalUnrealizedPnL: parseInt(result.total_unrealized_pnl) / 100,
    totalPnL: (parseInt(result.total_realized_pnl) + parseInt(result.total_unrealized_pnl)) / 100,
    returnPct: parseInt(result.total_initial) > 0
      ? ((parseInt(result.total_equity) / parseInt(result.total_initial) - 1) * 100) : 0,
    openPositions: parseInt(positions.count),
    closedTrades: parseInt(closedTrades.count),
    totalTrades: parseInt(result.total_trades),
    winRate: (parseInt(result.total_wins) + parseInt(result.total_losses)) > 0
      ? (parseInt(result.total_wins) / (parseInt(result.total_wins) + parseInt(result.total_losses)) * 100) : 0,
  });
});

export default router;
