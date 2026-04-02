# PostgreSQL Schema Deployment Guide

## File Structure
```
server/db/
├── schema.sql              (809 lines) — Full PostgreSQL schema
├── SCHEMA_SUMMARY.md       (267 lines) — Design decisions and overview
├── TABLE_REFERENCE.txt     (246 lines) — Quick lookup for all 29 tables
├── DEPLOYMENT_NOTES.md     (this file) — Deployment and validation
└── init.js                 (existing) — Node.js initialization helper
```

## Schema Overview

### Tables: 29 Total
- **Authentication**: users, login_log, passkey_credentials, access_requests (4)
- **Trading**: positions, trades, order_queue, broker_connections, signals (5)
- **Accounts**: wallets, equity_snapshots, fund_settings (3)
- **Risk/Compliance**: risk_events, trade_flags, qa_reports (3)
- **AI/Analytics**: agent_stats, agent_preferences, auto_trade_log, post_mortems (4)
- **Tax Accounting**: tax_ledger, tax_lots, wash_sales, tax_allocations (4)
- **Fund Ops**: distributions, capital_accounts (2)
- **Support**: withdrawal_requests, feedback, verification_codes (3)
- **Config**: system_config (1)

### Key Metrics
- **Total Columns**: 280+
- **Primary Keys**: 29 (all UUID)
- **Foreign Keys**: 30+
- **Indexes**: 50+
- **Triggers**: 11 (auto-update updated_at)
- **Functions**: 1 (update_updated_at_column)

## Deployment Steps

### 1. Pre-Deployment Validation

#### Check PostgreSQL Version
```bash
psql -c "SELECT version();"
```
Requires: PostgreSQL 12+ (tested on 14, 15, 16)

#### Verify Extensions Available
```bash
psql -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"
psql -c "CREATE EXTENSION IF NOT EXISTS \"pgcrypto\";"
```

### 2. Apply Schema

#### From CLI
```bash
psql -U postgres -d your_database_name -f schema.sql
```

#### From Node.js
```javascript
const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const schema = fs.readFileSync('./server/db/schema.sql', 'utf-8');
await pool.query(schema);
```

#### From Docker
```bash
docker exec -i postgres_container psql -U postgres -d database_name < schema.sql
```

### 3. Post-Deployment Validation

#### Verify All Tables Created
```sql
SELECT count(*) as table_count FROM information_schema.tables 
WHERE table_schema = 'public';
-- Expected: 29
```

#### Verify Indexes
```sql
SELECT count(*) as index_count FROM pg_indexes 
WHERE schemaname = 'public';
-- Expected: 50+
```

#### Verify Triggers
```sql
SELECT count(*) as trigger_count FROM information_schema.triggers 
WHERE trigger_schema = 'public';
-- Expected: 11
```

#### Test Sample Queries
```sql
-- Test users table
SELECT * FROM users LIMIT 1;

-- Test positions (largest table)
SELECT count(*) FROM positions;

-- Test trigger (should auto-set updated_at)
INSERT INTO users (email, password_hash, first_name, last_name) 
VALUES ('test@example.com', 'hash', 'Test', 'User');
UPDATE users SET email = 'test2@example.com' WHERE email = 'test@example.com';
SELECT created_at, updated_at FROM users WHERE email = 'test2@example.com';
-- Verify: updated_at > created_at

-- Test JSONB columns
SELECT system_config.value::jsonb FROM system_config LIMIT 1;
```

## Important Notes

### 1. Idempotent Execution
Schema can be run multiple times safely:
- `DROP TABLE IF EXISTS ... CASCADE` at start
- `CREATE TABLE IF NOT EXISTS` for all tables
- Existing data will be cleared on re-run

### 2. Backup Before Production
```bash
pg_dump -Fc database_name > backup.dump
```

### 3. Foreign Key Constraints
All relationships use `ON DELETE CASCADE`:
- Deleting a user cascades to all positions, trades, wallets, etc.
- Test this behavior before production

### 4. Monetary Values
- Type: NUMERIC(18,4)
- Supports: $9,999,999,999,999.9999
- No floating-point errors
- Always use string for precision in queries

### 5. Timestamps
- Type: TIMESTAMPTZ (timezone-aware)
- Stored: UTC
- Auto-set: created_at (immutable), updated_at (via trigger)
- Query with timezone: `AT TIME ZONE 'US/Eastern'`

### 6. Performance Optimization

#### Connection Pool Settings (Node.js)
```javascript
const pool = new Pool({
  max: 20,                    // Max connections
  idleTimeoutMillis: 30000,   // Idle timeout
  connectionTimeoutMillis: 2000,
  maxUses: 7500               // Recycle old connections
});
```

#### Critical Indexes to Monitor
These must exist and be healthy:
1. `positions(user_id, status)` — Find open positions
2. `positions(symbol, status)` — Market exposure
3. `trades(user_id, closed_at DESC)` — Trade history
4. `tax_ledger(user_id, tax_year)` — Tax reporting
5. `equity_snapshots(user_id, date DESC, hour DESC)` — Charts

Verify:
```sql
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE tablename IN ('positions', 'trades', 'tax_ledger', 'equity_snapshots')
ORDER BY idx_scan DESC;
```

### 7. Data Integrity

#### Referential Integrity
All foreign keys are enforced. Common cascading deletes:
- User → Positions, Trades, Wallets, Tax Lots
- Wallet → Positions, Trades
- Position → Tax Lots, Trades

#### Unique Constraints
- `users(email)` — Email uniqueness
- `wallets(user_id)` — One wallet per user
- `broker_connections(user_id, broker_name)` — Prevent duplicate broker links
- `agent_stats(agent_name)` — Unique agent names
- `capital_accounts(user_id)` — One capital account per user

### 8. Monitoring & Maintenance

#### Table Bloat Analysis
```sql
SELECT schemaname, tablename, 
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

#### Slow Query Logging
```sql
ALTER SYSTEM SET log_min_duration_statement = 1000;  -- Log queries > 1 second
SELECT pg_reload_conf();
```

#### Index Bloat Check
```sql
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;
```

### 9. Backups & Recovery

#### Full Database Backup (Binary)
```bash
pg_dump -Fc -j 4 database_name > backup.dump
pg_restore -Fc -j 4 -d new_database backup.dump
```

#### Text Backup
```bash
pg_dump -p 5432 -U postgres database_name > backup.sql
psql -p 5432 -U postgres new_database < backup.sql
```

#### Point-in-Time Recovery (PITR)
Enable WAL archiving in postgresql.conf:
```
archive_mode = on
archive_command = 'test ! -f /wal_archive/%f && cp %p /wal_archive/%f'
```

## Rollback Plan

If schema deployment fails:

1. **Check Error Logs**
   ```bash
   tail -f /var/log/postgresql/postgresql.log
   ```

2. **Restore from Backup**
   ```bash
   pg_restore -Fc -d database_name backup.dump
   ```

3. **Verify Restore**
   ```sql
   SELECT count(*) FROM users;
   SELECT count(*) FROM positions;
   ```

## Common Issues & Solutions

### Issue: "uuid-ossp extension not found"
**Solution**: Install PostgreSQL dev packages
```bash
# Ubuntu/Debian
sudo apt-get install postgresql-contrib

# macOS
brew install postgresql
brew install postgresql-uuid-ossp
```

### Issue: "relation already exists"
**Solution**: Schema is idempotent, safe to re-run
- Existing data will be cleared (DROP TABLE IF EXISTS)
- Or manually drop: `DROP TABLE IF EXISTS table_name CASCADE;`

### Issue: Foreign key constraint violation
**Solution**: Ensure deletion order respects cascades
```sql
-- Safe: depends on CASCADE rules
DELETE FROM users WHERE id = $1;

-- Unsafe: explicit constraint violation
DELETE FROM positions WHERE user_id = $1;  -- violates wallet FK
```

### Issue: "too many connections"
**Solution**: Adjust connection pool or increase max_connections
```sql
SHOW max_connections;
ALTER SYSTEM SET max_connections = 200;
SELECT pg_reload_conf();
```

## Performance Tips

1. **Regularly VACUUM & ANALYZE**
   ```bash
   # Run weekly
   psql -d database_name -c "VACUUM ANALYZE;"
   ```

2. **Monitor positions Table** (largest ~9500 rows)
   - Ensure indexes are not fragmented
   - Run `REINDEX` if scans slow down
   ```sql
   REINDEX TABLE positions;
   ```

3. **Archive Old Data**
   - Move closed positions to archive table
   - Partition by date for large datasets
   ```sql
   CREATE TABLE positions_archive AS
   SELECT * FROM positions WHERE closed_at < NOW() - INTERVAL '1 year';
   DELETE FROM positions WHERE closed_at < NOW() - INTERVAL '1 year';
   ```

4. **Tax Data Partitioning**
   ```sql
   CREATE TABLE tax_ledger_2025 PARTITION OF tax_ledger
   FOR VALUES FROM (2025) TO (2026);
   ```

## Security Checklist

- [ ] Passwords hashed (schema assumes password_hash column)
- [ ] API keys encrypted at rest (broker_connections.api_key_hash)
- [ ] All timestamps TIMESTAMPTZ (timezone-aware)
- [ ] Foreign key constraints enforce referential integrity
- [ ] User IDs always indexed for security filtering
- [ ] Audit trails in place (login_log, risk_events, auto_trade_log)
- [ ] Backup strategy documented and tested
- [ ] SSL/TLS enabled for connections
- [ ] User roles properly configured (role IN ('admin', 'investor', 'viewer'))

## Support & Documentation

- **Quick Reference**: See `TABLE_REFERENCE.txt`
- **Design Decisions**: See `SCHEMA_SUMMARY.md`
- **Full Schema**: See `schema.sql`
- **Version**: 2.0 (2026-04-01)
- **Platform**: 12 Tribes Investment Platform

---

**Last Updated**: 2026-04-01
**Status**: Production Ready
