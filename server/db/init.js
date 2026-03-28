// ═══════════════════════════════════════════
//   12 TRIBES — DATABASE INITIALIZER
//   Run: node db/init.js
// ═══════════════════════════════════════════

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const { Pool } = pg;

async function initDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
  });

  try {
    console.log('═══ 12 TRIBES — Database Initialization ═══\n');

    // Test connection
    const { rows } = await pool.query('SELECT NOW()');
    console.log(`✅ Connected to PostgreSQL at ${rows[0].now}`);

    // Read and execute schema
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('✅ Schema created successfully');

    // Verify tables
    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `);
    console.log(`\n📋 Tables created (${tables.rows.length}):`);
    tables.rows.forEach(t => console.log(`   • ${t.table_name}`));

    // Verify indexes
    const indexes = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND indexname LIKE 'idx_%'
      ORDER BY indexname
    `);
    console.log(`\n🔍 Indexes created (${indexes.rows.length}):`);
    indexes.rows.forEach(i => console.log(`   • ${i.indexname}`));

    console.log('\n═══ Database initialization complete ═══');
  } catch (err) {
    console.error('❌ Database initialization failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initDatabase();
