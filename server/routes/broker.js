// ═══════════════════════════════════════════
//   12 TRIBES — BROKER CONNECTION ROUTES
//   OAuth account linking | Multi-broker support
// ═══════════════════════════════════════════

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { query, getOne, withTransaction } from '../config/database.js';
import { alpacaService } from '../services/alpacaService.js';
import { logger, auditLogger } from '../services/logger.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// ─── GET /api/broker/status ───
// Check which brokers are connected
router.get('/status', authenticate, async (req, res) => {
  const connections = await query(
    'SELECT broker_name, account_id, account_type, account_status, is_active, linked_at, last_synced_at FROM broker_connections WHERE user_id = $1',
    [req.userId]
  );

  const user = await getOne('SELECT trading_mode FROM users WHERE id = $1', [req.userId]);

  res.json({
    tradingMode: user?.trading_mode || 'paper',
    connections: connections.rows.map(c => ({
      broker: c.broker_name,
      accountId: c.account_id,
      accountType: c.account_type,
      status: c.account_status,
      active: c.is_active,
      linkedAt: c.linked_at,
      lastSynced: c.last_synced_at,
    })),
  });
});

// ─── GET /api/broker/alpaca/connect ───
// Start Alpaca OAuth flow — returns redirect URL
router.get('/alpaca/connect', authenticate, async (req, res) => {
  const state = `${req.userId}_${uuidv4()}`; // Encode userId in state for callback

  // Store state temporarily (5 min expiry)
  await query(
    `INSERT INTO order_queue (id, user_id, symbol, side, quantity, execution_mode, status, expires_at)
     VALUES ($1, $2, 'OAUTH', 'BUY', 0, 'live', 'pending_confirmation', NOW() + INTERVAL '5 minutes')`,
    [state, req.userId]
  );

  const url = alpacaService.getOAuthUrl(state);
  res.json({ url, state });
});

// ─── GET /api/broker/alpaca/callback ───
// OAuth callback — exchanges code for access token
router.get('/alpaca/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).send('Missing code or state parameter');
  }

  try {
    // Validate state and extract userId
    const stateRecord = await getOne(
      "SELECT user_id FROM order_queue WHERE id = $1 AND status = 'pending_confirmation' AND expires_at > NOW()",
      [state]
    );

    if (!stateRecord) {
      return res.status(400).send('Invalid or expired state. Please try connecting again.');
    }

    const userId = stateRecord.user_id;

    // Clean up state record
    await query("UPDATE order_queue SET status = 'filled' WHERE id = $1", [state]);

    // Exchange code for tokens
    const tokenData = await alpacaService.exchangeOAuthCode(code);

    // Get account info
    const tempConn = { access_token: tokenData.access_token, account_type: 'live' };
    const account = await alpacaService.getAccount(tempConn);

    // Store broker connection
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO broker_connections (user_id, broker_name, account_id, access_token, refresh_token, token_expiry, account_type, account_status, buying_power, is_active)
         VALUES ($1, 'alpaca', $2, $3, $4, $5, $6, $7, $8, true)
         ON CONFLICT (user_id, broker_name) DO UPDATE SET
           access_token = $3, refresh_token = $4, token_expiry = $5, account_id = $2,
           account_status = $7, buying_power = $8, is_active = true, last_synced_at = NOW(), updated_at = NOW()`,
        [userId, account.id, tokenData.access_token, tokenData.refresh_token,
         tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null,
         account.patternDayTrader ? 'margin' : 'cash', account.status,
         Math.round(account.buyingPower * 100)]
      );

      // Update wallet with broker info
      await client.query(
        "UPDATE wallets SET broker_name = 'alpaca', broker_account_id = $1, broker_access_token = $2, broker_linked_at = NOW() WHERE user_id = $3",
        [account.id, tokenData.access_token, userId]
      );
    });

    auditLogger.info('Broker connected', { userId, broker: 'alpaca', accountId: account.id });

    // Redirect to frontend with success
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/?broker_connected=alpaca`);
  } catch (err) {
    logger.error('Alpaca OAuth callback failed:', err);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/?broker_error=${encodeURIComponent(err.message)}`);
  }
});

// ─── POST /api/broker/disconnect ───
router.post('/disconnect', authenticate, async (req, res) => {
  const { broker } = req.body;

  await withTransaction(async (client) => {
    await client.query(
      'UPDATE broker_connections SET is_active = false, updated_at = NOW() WHERE user_id = $1 AND broker_name = $2',
      [req.userId, broker]
    );

    await client.query(
      'UPDATE wallets SET broker_name = NULL, broker_account_id = NULL, broker_access_token = NULL WHERE user_id = $1',
      [req.userId]
    );

    // Switch back to paper trading
    await client.query(
      "UPDATE users SET trading_mode = 'paper' WHERE id = $1",
      [req.userId]
    );
  });

  auditLogger.info('Broker disconnected', { userId: req.userId, broker });
  res.json({ success: true, message: `${broker} disconnected. Switched to paper trading.` });
});

// ─── POST /api/broker/switch-mode ───
// Switch between paper and live trading
router.post('/switch-mode', authenticate, async (req, res) => {
  const { mode } = req.body; // 'paper' or 'live'

  if (!['paper', 'live'].includes(mode)) {
    return res.status(400).json({ error: 'Mode must be paper or live' });
  }

  if (mode === 'live') {
    // Verify broker is connected
    const conn = await getOne(
      'SELECT * FROM broker_connections WHERE user_id = $1 AND is_active = true',
      [req.userId]
    );

    if (!conn) {
      return res.status(400).json({
        error: 'Cannot switch to live trading without an active broker connection',
        code: 'NO_BROKER',
      });
    }
  }

  await query('UPDATE users SET trading_mode = $1 WHERE id = $2', [mode, req.userId]);

  auditLogger.info('Trading mode switched', { userId: req.userId, mode });
  res.json({ success: true, tradingMode: mode });
});

// ─── GET /api/broker/account ───
// Get live broker account info
router.get('/account', authenticate, async (req, res) => {
  const conn = await getOne(
    'SELECT * FROM broker_connections WHERE user_id = $1 AND is_active = true',
    [req.userId]
  );

  if (!conn) {
    return res.status(404).json({ error: 'No active broker connection' });
  }

  try {
    let account;
    if (conn.broker_name === 'alpaca') {
      account = await alpacaService.getAccount(conn);
    } else {
      return res.status(400).json({ error: `Broker ${conn.broker_name} not yet supported` });
    }

    // Update cached values
    await query(
      'UPDATE broker_connections SET buying_power = $1, account_status = $2, last_synced_at = NOW() WHERE id = $3',
      [Math.round(account.buyingPower * 100), account.status, conn.id]
    );

    res.json(account);
  } catch (err) {
    logger.error('Failed to fetch broker account:', err);
    res.status(500).json({ error: 'Failed to fetch broker account' });
  }
});

// ─── GET /api/broker/positions ───
// Get live positions from broker
router.get('/positions', authenticate, async (req, res) => {
  const conn = await getOne(
    'SELECT * FROM broker_connections WHERE user_id = $1 AND is_active = true',
    [req.userId]
  );
  if (!conn) return res.status(404).json({ error: 'No active broker connection' });

  try {
    if (conn.broker_name === 'alpaca') {
      const positions = await alpacaService.getPositions(conn);
      return res.json(positions);
    }
    res.status(400).json({ error: `Broker ${conn.broker_name} not supported` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch broker positions' });
  }
});

export default router;
