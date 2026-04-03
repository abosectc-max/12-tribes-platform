// ═══════════════════════════════════════════════════════════════════════════
//   12 TRIBES — POSTGRESQL ADAPTER
//   Drop-in replacement for JsonDB | Sync interface with async persistence
//
//   Architecture:
//   - In-memory cache (loaded from PG on init) as source of truth for reads
//   - Synchronous interface (100% compatible with JsonDB)
//   - Fire-and-forget async writes to PostgreSQL
//   - Hybrid approach: JS predicates on in-memory, PG as persistent backing store
//
//   Connection: DATABASE_URL env var (e.g., postgresql://user:pass@host/db)
//   Usage: const db = new PostgresAdapter(); await db.init();
// ═══════════════════════════════════════════════════════════════════════════

import pg from 'pg';
import { randomUUID } from 'node:crypto';

const { Pool, types } = pg;

// Override pg's default NUMERIC/DECIMAL parsing: return JS numbers instead of strings.
// pg returns NUMERIC as strings to avoid floating-point precision loss, but our app
// expects numbers for .toFixed(), arithmetic, etc. NUMERIC(18,4) fits in float64.
types.setTypeParser(1700, (val) => parseFloat(val));  // OID 1700 = NUMERIC/DECIMAL
types.setTypeParser(20, (val) => parseInt(val, 10));   // OID 20 = BIGINT (INT8)

// Table list (must match standalone.js DB_TABLES)
const DB_TABLES = [
  'users', 'wallets', 'positions', 'trades', 'snapshots',
  'login_log', 'agent_stats', 'broker_connections', 'risk_events',
  'order_queue', 'access_requests', 'auto_trade_log', 'fund_settings',
  'verification_codes', 'qa_reports', 'feedback', 'withdrawal_requests',
  'signals', 'trade_flags', 'system_config', 'agent_preferences',
  'post_mortems', 'tax_allocations', 'tax_ledger', 'tax_lots',
  'wash_sales', 'distributions', 'capital_accounts', 'passkey_credentials',
  'symbol_performance', 'audit_log', 'trade_audit', 'compliance_alerts',
  'fee_ledger', 'capital_calls', 'distribution_records', 'messages',
  'recovery_snapshots', 'settlements',
];

// Columns that should be stored as JSON in PostgreSQL
// Before INSERT/UPDATE, these are JSON.stringify'd
const JSONB_COLUMNS = {
  fund_settings: ['data'],
  risk_events: ['details'],
  signals: ['indicators', 'details'],
  qa_reports: ['report_data', 'issues', 'metrics', 'severity_counts', 'systemState', 'checks', 'agentStats', 'perUserDebug'],
  trade_flags: ['details', 'order', 'context'],
  system_config: ['value'],
  agent_preferences: ['preferences'],
  post_mortems: ['patterns', 'patterns_detected'],
  tax_allocations: ['allocation'], // May vary by actual schema
  audit_log: ['details', 'metadata'],
};

export class PostgresAdapter {
  constructor(options = {}) {
    this.tables = {};         // In-memory cache (plain object with arrays)
    this.pool = null;
    this.options = {
      maxConnections: options.maxConnections || 10,
      idleTimeoutMillis: options.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: options.connectionTimeoutMillis || 30000, // 30s — allows for PG cold-start on Render deploy
    };
    this._initialized = false;
    this._pendingWrites = new Map(); // Track pending async writes for debugging
    this._pgColumns = {};           // Cache of valid PG column names per table
  }

  /**
   * Initialize the adapter: connect to PostgreSQL and load all tables into memory
   */
  async init() {
    if (this._initialized) {
      console.warn('[PG-ADAPTER] Already initialized, skipping init()');
      return;
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL env var not set');
    }

    try {
      this.pool = new Pool({
        connectionString: dbUrl,
        max: this.options.maxConnections,
        idleTimeoutMillis: this.options.idleTimeoutMillis,
        connectionTimeoutMillis: this.options.connectionTimeoutMillis,
        ssl: dbUrl.includes('.render.com') ? { rejectUnauthorized: false } : false,
      });

      // Test connection
      const conn = await this.pool.connect();
      const result = await conn.query('SELECT NOW()');
      conn.release();
      console.log(`[PG-ADAPTER] Connected to PostgreSQL at ${result.rows[0].now}`);

      // MEMORY-SAFE: Load tables with row limits for ALL high-volume tables
      // Render Starter: 512MB total, --max-old-space-size=384MB heap
      // Memory budget: ~200MB data + ~130MB V8/Node overhead + ~50MB headroom = 380MB
      //
      // FINANCIAL TABLES now capped at boot to prevent OOM after weeks of
      // continuous auto-trading (6 agents × ~10s = ~50K+ trades/day).
      // Full historical data remains in PG and can be queried directly via
      // /api/admin/pg-query/:table when needed.
      const PG_LOAD_LIMITS = {
        // ── FINANCIAL TABLES: Capped for memory safety (PG retains all) ──
        trades: 5000,           // Most recent 5K trades (~2-3 days of trading)
        positions: 2000,        // Most recent 2K positions (includes all OPEN)
        tax_ledger: 2000,       // Most recent 2K tax entries
        tax_lots: 2000,         // Most recent 2K tax lots
        wash_sales: 1000,       // Most recent 1K wash sale records
        tax_allocations: 500,   // Most recent 500 allocations

        // ── OPERATIONAL TABLES: Tightly capped ──
        post_mortems: 200,
        signals: 300,
        risk_events: 200,
        auto_trade_log: 300,
        snapshots: 300,
        trade_flags: 150,
        qa_reports: 30,
        login_log: 150,
        order_queue: 50,
        audit_log: 300,
        feedback: 500,
        access_requests: 200,
        verification_codes: 100,
        symbol_performance: 300,
      };

      // ── PARALLEL TABLE LOAD ──────────────────────────────────────────────
      // Previously loaded all tables serially (one await per table = 1-2s total).
      // Now fires all table queries simultaneously via Promise.all — 70-80% faster boot.
      const loadOneTable = async (table) => {
        const limit = PG_LOAD_LIMITS[table];
        const primaryQuery = limit
          ? `SELECT * FROM ${table} ORDER BY created_at DESC NULLS LAST LIMIT ${limit}`
          : `SELECT * FROM ${table} ORDER BY id`;
        try {
          const rows = await this.pool.query(primaryQuery);
          return { table, rows: rows.rows };
        } catch (err) {
          if (err.code === '42P01' || err.message.includes('does not exist')) {
            console.warn(`[PG-ADAPTER] Table "${table}" does not exist, starting empty`);
            return { table, rows: [] };
          } else if (err.message.includes('column "created_at" does not exist')) {
            try {
              const fallbackQuery = limit
                ? `SELECT * FROM ${table} LIMIT ${limit}`
                : `SELECT * FROM ${table} ORDER BY id`;
              const rows = await this.pool.query(fallbackQuery);
              return { table, rows: rows.rows };
            } catch (e2) {
              console.warn(`[PG-ADAPTER] Failed to load "${table}": ${e2.message}`);
              return { table, rows: [] };
            }
          } else {
            throw err;
          }
        }
      };

      // Fire all table loads + column cache queries in parallel
      const [tableResults, colResults] = await Promise.all([
        Promise.all(DB_TABLES.map(loadOneTable)),
        // Build column cache in parallel with table loading
        Promise.all(DB_TABLES.map(async (table) => {
          try {
            const colResult = await this.pool.query(
              `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`,
              [table]
            );
            return { table, cols: new Set(colResult.rows.map(r => r.column_name)) };
          } catch {
            return { table, cols: new Set() };
          }
        })),
      ]);

      const counts = {};
      for (const { table, rows } of tableResults) {
        this.tables[table] = rows;
        counts[table] = rows.length;
      }
      for (const { table, cols } of colResults) {
        this._pgColumns[table] = cols;
      }

      // Log startup
      const countStr = Object.entries(counts)
        .map(([t, c]) => `${t}:${c}`)
        .join(', ');
      console.log(`[PG-ADAPTER] Loaded from PostgreSQL — ${countStr}`);

      // Seed AI agents if empty (matching standalone.js behavior)
      if (this.tables.agent_stats.length === 0) {
        const agents = ['Viper', 'Oracle', 'Spectre', 'Sentinel', 'Phoenix', 'Titan'];
        for (const name of agents) {
          const record = {
            id: randomUUID(),
            agent_name: name,
            total_trades: 0,
            wins: 0,
            losses: 0,
            total_pnl: 0,
            best_trade: 0,
            worst_trade: 0,
            avg_return: 0,
          };
          this.insert('agent_stats', record);
        }
      }

      // BOOT PRUNE: Immediately trim oversized operational tables (matching JsonDB behavior)
      this.pruneOperationalTables();

      this._initialized = true;
    } catch (err) {
      console.error('[PG-ADAPTER] Initialization failed:', err.message);
      if (this.pool) await this.pool.end();
      throw err;
    }
  }

  /**
   * INSERT: Add a new record to table and persist to PG asynchronously
   */
  insert(table, record) {
    if (!this.tables[table]) {
      throw new Error(`Table "${table}" does not exist in schema`);
    }

    // Generate ID and timestamps if missing
    if (!record.id) record.id = randomUUID();
    if (!record.created_at) record.created_at = new Date().toISOString();

    // Add to in-memory cache (source of truth for reads)
    this.tables[table].push(record);

    // Fire-and-forget async write to PostgreSQL
    if (this.pool) {
      this._persistInsert(table, record).catch(err => {
        console.error(`[PG-ADAPTER] Failed to persist INSERT to ${table}:`, err.message);
      });
    }

    return record;
  }

  /**
   * FIND ONE: Synchronous search in in-memory cache using JS predicate
   */
  findOne(table, predicate) {
    if (!this.tables[table]) return null;
    return this.tables[table].find(predicate) || null;
  }

  /**
   * FIND MANY: Synchronous search in in-memory cache using JS predicate
   */
  findMany(table, predicate) {
    if (!this.tables[table]) return [];
    return predicate ? this.tables[table].filter(predicate) : [...this.tables[table]];
  }

  /**
   * UPDATE: Modify a record in-memory and persist changes to PG asynchronously
   */
  update(table, predicate, updates) {
    const record = this.tables[table]?.find(predicate);
    if (record) {
      Object.assign(record, updates, { updated_at: new Date().toISOString() });

      // Fire-and-forget async write
      if (this.pool) {
        this._persistUpdate(table, record).catch(err => {
          console.error(`[PG-ADAPTER] Failed to persist UPDATE to ${table}:`, err.message);
        });
      }
    }
    return record || null;
  }

  /**
   * REMOVE: Delete a record from memory and from PG asynchronously
   */
  remove(table, predicate) {
    const idx = this.tables[table]?.findIndex(predicate);
    if (idx === undefined || idx < 0) return null;

    const removed = this.tables[table].splice(idx, 1)[0];

    // Fire-and-forget async delete
    if (this.pool && removed.id) {
      this._persistDelete(table, removed.id).catch(err => {
        console.error(`[PG-ADAPTER] Failed to persist DELETE from ${table}:`, err.message);
      });
    }

    return removed;
  }

  /**
   * COUNT: Synchronous count in in-memory cache
   */
  count(table, predicate) {
    if (!this.tables[table]) return 0;
    if (!predicate) return this.tables[table].length;
    let c = 0;
    for (const r of this.tables[table]) if (predicate(r)) c++;
    return c;
  }

  /**
   * UPSERT: Insert if not exists, update if exists
   */
  upsert(table, predicate, record) {
    if (!this.tables[table]) {
      throw new Error(`Table "${table}" does not exist in schema`);
    }

    const existing = this.tables[table].find(predicate);
    if (existing) {
      Object.assign(existing, record, { updated_at: new Date().toISOString() });
      if (this.pool) {
        this._persistUpdate(table, existing).catch(err => {
          console.error(`[PG-ADAPTER] Failed to persist UPSERT (update) to ${table}:`, err.message);
        });
      }
      return existing;
    } else {
      if (!record.id) record.id = randomUUID();
      if (!record.created_at) record.created_at = new Date().toISOString();
      this.tables[table].push(record);
      if (this.pool) {
        this._persistInsert(table, record).catch(err => {
          console.error(`[PG-ADAPTER] Failed to persist UPSERT (insert) to ${table}:`, err.message);
        });
      }
      return record;
    }
  }

  /**
   * NO-OP methods (for JsonDB compatibility)
   */
  _save(table) {
    // In PostgreSQL, data is persisted immediately (async), no file-based save needed
  }

  _deferSave(table) {
    // In PostgreSQL, all writes are async by default
  }

  flushAll() {
    // In PostgreSQL, writes are already async and will be processed
    // This is a no-op for compatibility
  }

  /**
   * PRUNE OPERATIONAL TABLES — trim in-memory arrays ONLY
   * Critical for staying under Render's 512MB memory limit
   * IMPORTANT: Never DELETE from PostgreSQL — PG is the permanent historical store.
   * Memory pruning keeps runtime safe; PG retains all data for audit/compliance.
   */
  pruneOperationalTables() {
    // In-memory limits for runtime safety (PG retains ALL rows permanently)
    const limits = {
      // Financial tables — match boot load caps
      trades: 5000,
      positions: 2000,
      tax_ledger: 2000,
      tax_lots: 2000,
      wash_sales: 1000,
      tax_allocations: 500,
      // Operational tables — tightly capped
      post_mortems: 200,
      signals: 300,
      risk_events: 200,
      auto_trade_log: 300,
      snapshots: 300,
      trade_flags: 150,
      qa_reports: 30,
      login_log: 150,
      order_queue: 50,
      feedback: 500,
      access_requests: 200,
      verification_codes: 100,
      audit_log: 300,
      symbol_performance: 300,
    };

    let totalPruned = 0;
    for (const [table, maxRows] of Object.entries(limits)) {
      if (!this.tables[table]) continue;
      const excess = this.tables[table].length - maxRows;
      if (excess > 0) {
        // Remove oldest (front of array) from in-memory cache ONLY
        this.tables[table].splice(0, excess);
        totalPruned += excess;
        // PG rows are PRESERVED — no DELETE queries fired
      }
    }

    if (totalPruned > 0) {
      console.log(`[PG-ADAPTER] Pruned ${totalPruned} rows from in-memory cache (PG preserved)`);
    }
    return totalPruned;
  }

  /**
   * STOP: Gracefully close the connection pool
   */
  async stop() {
    console.log('[PG-ADAPTER] Shutting down...');
    if (this.pool) {
      await this.pool.end();
      console.log('[PG-ADAPTER] Connection pool closed');
    }
  }

  /**
   * GET ACTUAL PG ROW COUNTS — query PostgreSQL directly for true table sizes
   * Returns { table: pgCount } for all tables, compared to in-memory counts
   */
  async getPgRowCounts() {
    if (!this.pool) return null;
    const counts = {};
    for (const table of DB_TABLES) {
      try {
        const result = await this.pool.query(`SELECT COUNT(*) as cnt FROM ${table}`);
        counts[table] = {
          pg: parseInt(result.rows[0].cnt, 10),
          memory: (this.tables[table] || []).length,
        };
      } catch (err) {
        counts[table] = { pg: -1, memory: (this.tables[table] || []).length, error: err.message };
      }
    }
    return counts;
  }

  /**
   * RELOAD TABLE FROM PG — load ALL rows from PG into memory for a specific table
   * WARNING: Use only for targeted restore operations, not routine boot.
   * For large tables, use pagination via queryPgDirect() instead.
   */
  async reloadTableFromPg(table, limit = null) {
    if (!this.pool) return { error: 'No PG pool' };
    try {
      const query = limit
        ? `SELECT * FROM ${table} ORDER BY created_at DESC NULLS LAST LIMIT ${parseInt(limit, 10)}`
        : `SELECT * FROM ${table} ORDER BY id`;
      const result = await this.pool.query(query);
      this.tables[table] = result.rows;
      return { table, loaded: result.rows.length };
    } catch (err) {
      return { table, error: err.message };
    }
  }

  /**
   * QUERY PG DIRECT — paginated query against PG for historical data access
   * Returns rows directly from PG without loading into memory
   */
  async queryPgDirect(table, { offset = 0, limit = 100, orderBy = 'created_at', direction = 'DESC' } = {}) {
    if (!this.pool) return { error: 'No PG pool' };
    if (!DB_TABLES.includes(table)) return { error: `Invalid table: ${table}` };
    const dir = direction === 'ASC' ? 'ASC' : 'DESC';
    try {
      const countResult = await this.pool.query(`SELECT COUNT(*) as cnt FROM ${table}`);
      const total = parseInt(countResult.rows[0].cnt, 10);
      const query = `SELECT * FROM ${table} ORDER BY ${orderBy} ${dir} NULLS LAST LIMIT $1 OFFSET $2`;
      const result = await this.pool.query(query, [parseInt(limit, 10), parseInt(offset, 10)]);
      return { table, total, offset, limit, returned: result.rows.length, rows: result.rows };
    } catch (err) {
      // Fallback if orderBy column doesn't exist
      if (err.message.includes('does not exist')) {
        const query = `SELECT * FROM ${table} ORDER BY id LIMIT $1 OFFSET $2`;
        const countResult = await this.pool.query(`SELECT COUNT(*) as cnt FROM ${table}`);
        const total = parseInt(countResult.rows[0].cnt, 10);
        const result = await this.pool.query(query, [parseInt(limit, 10), parseInt(offset, 10)]);
        return { table, total, offset, limit, returned: result.rows.length, rows: result.rows };
      }
      return { table, error: err.message };
    }
  }

  /**
   * DEFERRED SAVE TABLES (static for compatibility)
   */
  static DEFERRED_SAVE_TABLES = new Set([
    'signals', 'risk_events', 'auto_trade_log', 'snapshots', 'post_mortems',
    'trade_flags', 'order_queue', 'login_log', 'qa_reports',
  ]);

  // ═════════════════════════════════════════════════════════════════════════
  // PRIVATE METHODS: PostgreSQL Persistence Layer
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Persist an INSERT to PostgreSQL (async, fire-and-forget)
   */
  async _persistInsert(table, record) {
    if (!this.pool) return;

    try {
      // Filter to only columns that exist in PG schema
      const validCols = this._pgColumns[table];
      const cols = validCols && validCols.size > 0
        ? Object.keys(record).filter(k => validCols.has(k))
        : Object.keys(record);

      if (cols.length === 0) return;

      const vals = cols.map((_, i) => `$${i + 1}`).join(',');
      const colNames = cols.map(c => `"${c}"`).join(',');

      // Prepare values — normalize for PG type constraints
      const values = cols.map(col => this._normalizeForPG(table, col, record[col]));

      const query = `INSERT INTO ${table} (${colNames}) VALUES (${vals})`;
      await this.pool.query(query, values);
    } catch (err) {
      // Log but don't throw (fire-and-forget pattern)
      console.error(`[PG-ADAPTER] _persistInsert error for ${table}:`, err.message);
    }
  }

  /**
   * Persist an UPDATE to PostgreSQL (async, fire-and-forget)
   */
  async _persistUpdate(table, record) {
    if (!this.pool || !record.id) return;

    // Skip PG update if record has a non-UUID id (can't match in PG)
    if (typeof record.id === 'string' && !PostgresAdapter.UUID_RE.test(record.id)) return;

    try {
      // Filter to only columns that exist in PG schema (excluding id which is in WHERE clause)
      const validCols = this._pgColumns[table];
      const cols = validCols && validCols.size > 0
        ? Object.keys(record).filter(col => col !== 'id' && validCols.has(col))
        : Object.keys(record).filter(col => col !== 'id');

      if (cols.length === 0) return;

      const setClauses = cols.map((col, i) => `"${col}"=$${i + 1}`).join(',');
      const values = cols.map(col => this._normalizeForPG(table, col, record[col]));
      values.push(record.id); // WHERE id = $n

      const query = `UPDATE ${table} SET ${setClauses} WHERE "id"=$${cols.length + 1}`;
      await this.pool.query(query, values);
    } catch (err) {
      console.error(`[PG-ADAPTER] _persistUpdate error for ${table}:`, err.message);
    }
  }

  /**
   * Persist a DELETE to PostgreSQL (async, fire-and-forget)
   */
  async _persistDelete(table, id) {
    if (!this.pool) return;
    // Skip if non-UUID id (record was never persisted to PG)
    if (typeof id === 'string' && !PostgresAdapter.UUID_RE.test(id)) return;

    try {
      await this.pool.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
    } catch (err) {
      console.error(`[PG-ADAPTER] _persistDelete error for ${table}:`, err.message);
    }
  }

  // UUID regex for validation
  static UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Columns known to be UUID type in PG (id + common FK columns)
  static UUID_COLUMNS = new Set([
    'id', 'user_id', 'position_id', 'trade_id', 'tax_lot_id', 'wash_sale_id',
    'withdrawal_request_id',
  ]);

  // Columns with CHECK constraints requiring specific case
  static ENUM_NORMALIZERS = {
    holding_period: v => typeof v === 'string' ? v.toLowerCase() : v,
  };

  /**
   * Normalize a value for PostgreSQL type constraints:
   * - JSONB columns → JSON.stringify
   * - UUID columns with non-UUID values → NULL (preserve in-memory, skip in PG)
   * - Enum columns → case normalization
   * - Non-UUID id → generate a real UUID for PG
   */
  _normalizeForPG(table, column, value) {
    if (value === null || value === undefined) return null;

    // JSONB serialization
    const jsonbCols = JSONB_COLUMNS[table] || [];
    if (jsonbCols.includes(column)) {
      if (typeof value === 'string') return value;
      return JSON.stringify(value);
    }

    // UUID column validation — if value isn't a valid UUID, use NULL (for FKs) or generate one (for id)
    if (PostgresAdapter.UUID_COLUMNS.has(column) && typeof value === 'string' && !PostgresAdapter.UUID_RE.test(value)) {
      if (column === 'id') {
        // Generate a real UUID for PG persistence; in-memory keeps the original
        return randomUUID();
      }
      // FK references with non-UUID values → NULL to avoid FK constraint errors
      return null;
    }

    // Enum case normalization (e.g., 'SHORT_TERM' → 'short_term')
    const normalizer = PostgresAdapter.ENUM_NORMALIZERS[column];
    if (normalizer) return normalizer(value);

    // Object passed to a non-JSONB column — extract .value if it has one, otherwise NULL
    // Handles cases like exit_vix receiving {value: 17.01, regime: "complacent", ...}
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      if ('value' in value) return value.value;
      return null;
    }

    return value;
  }

  /**
   * Serialize a value for PostgreSQL (legacy, now delegates to _normalizeForPG)
   */
  _serializeValue(table, column, value) {
    return this._normalizeForPG(table, column, value);
  }

  /**
   * Deserialize a value from PostgreSQL
   * - Parse JSONB columns from JSON strings back to objects
   * - Pass other values as-is
   */
  _deserializeValue(table, column, value) {
    if (value === null || value === undefined) {
      return value;
    }

    const jsonbCols = JSONB_COLUMNS[table] || [];
    if (jsonbCols.includes(column) && typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value; // Fallback to string if parse fails
      }
    }

    return value;
  }
}

export default PostgresAdapter;
