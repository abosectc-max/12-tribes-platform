#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//   12 TRIBES — DATA MIGRATION: Cloud Snapshot → PostgreSQL
//
//   Pulls current production data from JSONBlob cloud sync,
//   decompresses it, and bulk-inserts into PostgreSQL.
//
//   Prerequisites:
//     1. PostgreSQL provisioned with DATABASE_URL set
//     2. Schema created: psql $DATABASE_URL -f schema.sql
//     3. Run: DATABASE_URL=postgres://... node migrate-to-pg.js
//
//   Safe to run multiple times — uses INSERT ON CONFLICT DO NOTHING
// ═══════════════════════════════════════════════════════════════════════════

import pg from 'pg';
import { createGunzip } from 'node:zlib';
import https from 'node:https';

const { Pool } = pg;

// ─── CONFIG ───
const BLOB_ID = process.env.CLOUD_BLOB_ID || '019d4491-1740-79d9-9594-54c896f3a6c7';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL env var required');
  console.error('Usage: DATABASE_URL=postgres://user:pass@host/db node migrate-to-pg.js');
  process.exit(1);
}

// Tables to migrate (order matters for FK constraints)
const MIGRATION_ORDER = [
  'users',              // No FK deps
  'wallets',            // FK: users
  'positions',          // FK: users
  'trades',             // FK: users
  'snapshots',          // FK: users
  'login_log',          // FK: users
  'agent_stats',        // No FK deps
  'broker_connections',  // FK: users
  'risk_events',        // FK: users
  'order_queue',        // FK: users
  'access_requests',    // FK: users
  'auto_trade_log',     // FK: users
  'fund_settings',      // FK: users
  'verification_codes', // FK: users
  'qa_reports',         // No FK deps
  'feedback',           // FK: users
  'withdrawal_requests',// FK: users
  'signals',            // FK: users
  'tax_ledger',         // FK: users
  'tax_lots',           // FK: users
  'wash_sales',         // FK: users
  'tax_allocations',    // FK: users
  'distributions',      // FK: users
  'capital_accounts',   // FK: users
  'passkey_credentials',// FK: users
  'trade_flags',        // FK: users
  'system_config',      // No FK deps
  'agent_preferences',  // FK: users
  'post_mortems',       // FK: users
];

// JSONB columns — must be stringified before INSERT
const JSONB_COLUMNS = {
  fund_settings: new Set(['data']),
  risk_events: new Set(['details']),
  signals: new Set(['indicators', 'details']),
  qa_reports: new Set(['report_data']),
  trade_flags: new Set(['details']),
  system_config: new Set(['value']),
  agent_preferences: new Set(['preferences']),
  post_mortems: new Set(['patterns']),
};

// ─── STEP 1: Pull cloud snapshot ───
async function pullSnapshot() {
  console.log(`[MIGRATE] Pulling cloud snapshot from jsonblob.com (blob: ${BLOB_ID})...`);
  const zlib = await import('node:zlib');

  return new Promise((resolve, reject) => {
    https.get(`https://jsonblob.com/api/jsonBlob/${BLOB_ID}`, {
      headers: { 'Accept': 'application/json' },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`));
          }

          let snapshot = JSON.parse(body);

          // Handle compressed envelope
          if (snapshot._compressed && snapshot._gz) {
            console.log('[MIGRATE] Decompressing gzip+base64 envelope...');
            const compressed = Buffer.from(snapshot._gz, 'base64');
            const decompressed = zlib.gunzipSync(compressed);
            snapshot = JSON.parse(decompressed.toString('utf8'));
          }

          // Handle nested data wrapper
          if (snapshot.data && snapshot._meta) {
            const tables = Object.keys(snapshot.data);
            const totalRecords = tables.reduce((s, t) => s + (snapshot.data[t]?.length || 0), 0);
            console.log(`[MIGRATE] Snapshot: ${tables.length} tables, ${totalRecords} total records`);
            resolve(snapshot.data);
          } else {
            resolve(snapshot);
          }
        } catch (err) {
          reject(err);
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ─── STEP 2: Get table columns from PG schema ───
async function getTableColumns(pool, table) {
  try {
    const result = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = $1 AND table_schema = 'public'
      ORDER BY ordinal_position
    `, [table]);
    return new Set(result.rows.map(r => r.column_name));
  } catch {
    return new Set();
  }
}

// ─── STEP 3: Bulk insert rows into PG (multi-row VALUES for speed) ───
async function migrateTable(pool, table, rows) {
  if (!rows || rows.length === 0) {
    console.log(`  [${table}] — empty, skipping`);
    return 0;
  }

  const pgColumns = await getTableColumns(pool, table);
  if (pgColumns.size === 0) {
    console.warn(`  [${table}] — table not found in PG schema, skipping`);
    return 0;
  }

  const jsonbCols = JSONB_COLUMNS[table] || new Set();

  // Determine consistent column set from first row (filtered to PG schema)
  const allKeys = new Set();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (pgColumns.has(k)) allKeys.add(k);
    }
  }
  const cols = [...allKeys];
  if (cols.length === 0) return 0;

  let totalInserted = 0;
  let totalErrors = 0;

  // Multi-row INSERT in batches of 200 (1 query per batch instead of 200)
  const BATCH_SIZE = 200;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values = [];
    const rowPlaceholders = [];

    for (const row of batch) {
      const rowVals = cols.map(col => {
        let val = row[col] !== undefined ? row[col] : null;
        if (jsonbCols.has(col) && val !== null && typeof val === 'object') {
          val = JSON.stringify(val);
        }
        return val;
      });
      const offset = values.length;
      rowPlaceholders.push(`(${cols.map((_, idx) => `$${offset + idx + 1}`).join(',')})`);
      values.push(...rowVals);
    }

    try {
      const query = `INSERT INTO ${table} (${cols.join(',')}) VALUES ${rowPlaceholders.join(',')} ON CONFLICT (id) DO NOTHING`;
      const result = await pool.query(query, values);
      totalInserted += result.rowCount;
    } catch (err) {
      totalErrors++;
      if (totalErrors <= 2) {
        console.error(`  [${table}] Batch error: ${err.message.substring(0, 120)}`);
      }
      // Fallback: try row-by-row for this batch to salvage what we can
      for (const row of batch) {
        try {
          const rowVals = cols.map(col => {
            let val = row[col] !== undefined ? row[col] : null;
            if (jsonbCols.has(col) && val !== null && typeof val === 'object') val = JSON.stringify(val);
            return val;
          });
          const ph = cols.map((_, idx) => `$${idx + 1}`).join(',');
          const r = await pool.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph}) ON CONFLICT (id) DO NOTHING`, rowVals);
          totalInserted += r.rowCount;
        } catch { /* skip bad rows silently */ }
      }
    }
  }

  const status = totalErrors > 0 ? '⚠️' : '✅';
  const skipped = rows.length - totalInserted - (totalErrors > 0 ? 1 : 0);
  console.log(`  ${status} [${table}] ${totalInserted} inserted (of ${rows.length} total)${totalErrors > 0 ? `, ${totalErrors} batch errors` : ''}`);
  return totalInserted;
}

// ─── MAIN ───
async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  12 TRIBES — PostgreSQL Data Migration');
  console.log('═══════════════════════════════════════════');

  // Step 1: Pull snapshot
  const data = await pullSnapshot();

  // Step 2: Connect to PG
  console.log('\n[MIGRATE] Connecting to PostgreSQL...');
  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 5,
    ssl: DATABASE_URL.includes('.render.com') ? { rejectUnauthorized: false } : false,
  });

  const conn = await pool.connect();
  const pgTime = await conn.query('SELECT NOW()');
  conn.release();
  console.log(`[MIGRATE] Connected at ${pgTime.rows[0].now}`);

  // Step 3: Run schema if tables don't exist
  const tableCheck = await pool.query(`
    SELECT COUNT(*) as count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `);
  if (parseInt(tableCheck.rows[0].count) === 0) {
    console.log('[MIGRATE] No tables found — running schema.sql...');
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('[MIGRATE] Schema created successfully');
  } else {
    console.log(`[MIGRATE] Found ${tableCheck.rows[0].count} existing tables`);
  }

  // Step 4: Pre-filter orphan references (remove rows with user_ids not in users table)
  const validUserIds = new Set((data.users || []).map(u => u.id));
  console.log(`\n[MIGRATE] Valid user IDs: ${validUserIds.size}`);
  let totalOrphans = 0;
  for (const table of MIGRATION_ORDER) {
    if (table === 'users' || !data[table]) continue;
    const before = data[table].length;
    data[table] = data[table].filter(row => !row.user_id || validUserIds.has(row.user_id));
    const removed = before - data[table].length;
    if (removed > 0) {
      console.log(`  [${table}] Filtered ${removed} orphan rows`);
      totalOrphans += removed;
    }
  }
  if (totalOrphans > 0) console.log(`[MIGRATE] Total orphans removed: ${totalOrphans}`);

  // Step 5: Migrate each table (multi-row bulk INSERT for speed)
  console.log('\n[MIGRATE] Starting bulk data migration...');
  let totalInserted = 0;

  for (const table of MIGRATION_ORDER) {
    const rows = data[table];
    const count = await migrateTable(pool, table, rows);
    totalInserted += count;
  }

  // Step 5: Summary
  console.log('\n═══════════════════════════════════════════');
  console.log(`  MIGRATION COMPLETE: ${totalInserted} records inserted`);
  console.log('═══════════════════════════════════════════');

  // Verify
  console.log('\n[VERIFY] Table counts in PostgreSQL:');
  for (const table of MIGRATION_ORDER) {
    try {
      const result = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
      const count = parseInt(result.rows[0].count);
      if (count > 0) console.log(`  ${table}: ${count}`);
    } catch (err) {
      console.log(`  ${table}: ERROR — ${err.message.substring(0, 50)}`);
    }
  }

  await pool.end();
  console.log('\n[MIGRATE] Done. Set DATABASE_URL on Render and redeploy to activate PostgreSQL mode.');
}

main().catch(err => {
  console.error('MIGRATION FAILED:', err);
  process.exit(1);
});
