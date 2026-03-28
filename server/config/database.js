// ═══════════════════════════════════════════
//   12 TRIBES — DATABASE CONNECTION
//   PostgreSQL pool with connection management
// ═══════════════════════════════════════════

import pg from 'pg';
import config from './index.js';
import { logger } from '../services/logger.js';

const { Pool } = pg;

const poolConfig = config.db.connectionString
  ? {
      connectionString: config.db.connectionString,
      ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
    }
  : {
      host: config.db.host,
      port: config.db.port,
      database: config.db.name,
      user: config.db.user,
      password: config.db.password,
      ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
    };

// Connection pool settings
const pool = new Pool({
  ...poolConfig,
  max: 20,                // Maximum connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Connection event handlers
pool.on('connect', () => {
  logger.debug('New database connection established');
});

pool.on('error', (err) => {
  logger.error('Unexpected database pool error:', err);
});

// ─── Query Helpers ───

export async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 100) {
      logger.warn(`Slow query (${duration}ms): ${text.substring(0, 80)}`);
    }
    return result;
  } catch (err) {
    logger.error(`Query failed: ${text.substring(0, 80)}`, err);
    throw err;
  }
}

export async function getOne(text, params) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

export async function getMany(text, params) {
  const result = await query(text, params);
  return result.rows;
}

// Transaction helper
export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Health check
export async function checkConnection() {
  try {
    const result = await pool.query('SELECT NOW()');
    return { connected: true, time: result.rows[0].now };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

export async function closePool() {
  await pool.end();
  logger.info('Database pool closed');
}

export default pool;
