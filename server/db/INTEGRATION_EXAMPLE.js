/**
 * INTEGRATION EXAMPLE: Using PostgresAdapter in place of JsonDB
 * 
 * This file shows how to drop in the PostgresAdapter as a replacement
 * for the existing JsonDB implementation.
 * 
 * Key changes:
 * 1. Import PostgresAdapter instead of JsonDB
 * 2. Call async init() after construction
 * 3. Rest of the API is identical
 */

import PostgresAdapter from './pg-adapter.js';

// ═══════════════════════════════════════════════════════════════════════════
// OPTION 1: Using in async context (recommended)
// ═══════════════════════════════════════════════════════════════════════════

async function setupDatabase() {
  try {
    // Create adapter
    const db = new PostgresAdapter({
      maxConnections: 15,          // Optional: configure pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Initialize (connects to DATABASE_URL, loads all tables)
    await db.init();

    // Now use like JsonDB - all operations are synchronous for reads
    // and fire-and-forget async for writes

    // CREATE
    const user = db.insert('users', {
      email: 'investor@example.com',
      password_hash: 'hashed_password',
      firstName: 'John',
      lastName: 'Investor',
      role: 'investor',
      status: 'active',
    });
    console.log('Created user:', user.id);

    // READ (synchronous)
    const found = db.findOne('users', p => p.email === 'investor@example.com');
    console.log('Found user:', found.firstName);

    // UPDATE
    const updated = db.update('users', 
      p => p.email === 'investor@example.com',
      { role: 'admin', login_count: 5 }
    );
    console.log('Updated user role to:', updated.role);

    // FIND MANY
    const allAdmins = db.findMany('users', p => p.role === 'admin');
    console.log('Admin count:', allAdmins.length);

    // COUNT
    const userCount = db.count('users', p => p.status === 'active');
    console.log('Active users:', userCount);

    // UPSERT
    const upserted = db.upsert('users',
      p => p.email === 'new@example.com',
      {
        email: 'new@example.com',
        password_hash: 'hashed',
        firstName: 'New',
        lastName: 'User',
        role: 'investor',
      }
    );

    // DELETE
    const removed = db.remove('users', p => p.email === 'investor@example.com');
    console.log('Removed user:', removed.firstName);

    // Direct access to tables (like JsonDB)
    console.log('Total positions:', db.tables.positions.length);
    const openPositions = db.tables.positions.filter(p => p.status === 'OPEN');
    console.log('Open positions:', openPositions.length);

    // Graceful shutdown
    await db.stop();
  } catch (err) {
    console.error('Database error:', err.message);
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OPTION 2: Using with Express server
// ═══════════════════════════════════════════════════════════════════════════

import express from 'express';

const app = express();
let db = null;

// Initialize database before starting server
async function startServer() {
  try {
    db = new PostgresAdapter();
    await db.init();

    app.get('/api/users/:id', (req, res) => {
      // Synchronous read from in-memory cache
      const user = db.findOne('users', p => p.id === req.params.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(user);
    });

    app.post('/api/users', express.json(), (req, res) => {
      // Synchronous insert (async write to PG happens in background)
      const user = db.insert('users', req.body);
      res.status(201).json(user);
    });

    app.patch('/api/users/:id', express.json(), (req, res) => {
      // Synchronous update
      const user = db.update('users', p => p.id === req.params.id, req.body);
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(user);
    });

    app.delete('/api/users/:id', (req, res) => {
      // Synchronous delete
      const removed = db.remove('users', p => p.id === req.params.id);
      if (!removed) return res.status(404).json({ error: 'User not found' });
      res.json({ deleted: true });
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('SIGTERM received, shutting down gracefully...');
      await db.stop();
      process.exit(0);
    });

    app.listen(4000, () => {
      console.log('Server listening on port 4000');
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OPTION 3: Complex queries with predicates
// ═══════════════════════════════════════════════════════════════════════════

function complexQueries() {
  // This is the power of keeping JS predicates — arbitrary filtering logic

  // Find all OPEN positions for a specific user opened in the last 24 hours
  const recentPositions = db.findMany('positions', p => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return p.user_id === userId 
      && p.status === 'OPEN'
      && new Date(p.opened_at) > oneDayAgo;
  });

  // Count positions by symbol for risk analysis
  const symbolCounts = {};
  for (const pos of db.findMany('positions', p => p.status === 'OPEN')) {
    symbolCounts[pos.symbol] = (symbolCounts[pos.symbol] || 0) + 1;
  }

  // Find users with >X% drawdown (complex calculation)
  const atRiskUsers = db.findMany('wallets', w => {
    const pctDown = ((w.initial_balance - w.equity) / w.initial_balance) * 100;
    return pctDown > 20; // >20% drawdown
  });

  // Find all trades that are outliers (unusual P&L)
  const avgTradePnl = db.tables.trades.length > 0
    ? db.tables.trades.reduce((sum, t) => sum + (t.pnl || 0), 0) / db.tables.trades.length
    : 0;
  const outlierTrades = db.findMany('trades', t => 
    Math.abs(t.pnl - avgTradePnl) > 2 * 1000 // >$2000 from average
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// OPTION 4: Migration from JsonDB
// ═══════════════════════════════════════════════════════════════════════════

import JsonDB from './json-db.js';  // Assuming old file exists

async function migrateFromJsonToPostgres() {
  // Load old JSON DB
  const oldDb = new JsonDB('./data');

  // Create new PG adapter
  const newDb = new PostgresAdapter();
  await newDb.init();

  // Copy all data
  const allTables = [
    'users', 'wallets', 'positions', 'trades', 'snapshots',
    'login_log', 'agent_stats', 'broker_connections', 'risk_events',
    'order_queue', 'access_requests', 'auto_trade_log', 'fund_settings',
    'verification_codes', 'qa_reports', 'feedback', 'withdrawal_requests',
    'signals', 'trade_flags', 'system_config', 'agent_preferences',
    'post_mortems', 'tax_allocations', 'tax_ledger', 'tax_lots',
    'wash_sales', 'distributions', 'capital_accounts', 'passkey_credentials',
    'equity_snapshots',
  ];

  let totalRecords = 0;
  for (const table of allTables) {
    const records = oldDb.findMany(table); // Get all records
    for (const record of records) {
      newDb.insert(table, record);
      totalRecords++;
    }
    console.log(`Migrated ${records.length} records from ${table}`);
  }

  // Close both
  oldDb.stop();
  await newDb.stop();

  console.log(`Migration complete: ${totalRecords} records moved to PostgreSQL`);
}

// ═══════════════════════════════════════════════════════════════════════════
// OPTION 5: Error handling and resilience
// ═══════════════════════════════════════════════════════════════════════════

async function resilientUsage() {
  try {
    const db = new PostgresAdapter();
    await db.init();

    // PG operations might fail, but reads always work
    try {
      const user = db.insert('users', { email: 'test@example.com' });
      console.log('User inserted (or queued for PG):', user.id);
    } catch (err) {
      console.error('Insert failed (rare, since in-memory succeeded):', err);
      // User is still in memory! Reads will work.
    }

    // Reads are always synchronous and reliable (from in-memory)
    const found = db.findOne('users', p => p.email === 'test@example.com');
    if (found) {
      console.log('Can immediately read what we just wrote');
    }

    // Graceful shutdown waits for any pending PG operations
    await db.stop();
  } catch (err) {
    if (err.message.includes('DATABASE_URL')) {
      console.error('PostgreSQL not configured. Set DATABASE_URL env var.');
    } else if (err.message.includes('connect')) {
      console.error('PostgreSQL connection failed. Check DATABASE_URL and network.');
    } else {
      console.error('Unexpected error:', err.message);
    }
    process.exit(1);
  }
}

// Export for use in other modules
export { PostgresAdapter };

// Run example
if (process.argv[1].endsWith('INTEGRATION_EXAMPLE.js')) {
  await setupDatabase();
}
