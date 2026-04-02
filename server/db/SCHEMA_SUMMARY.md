# 12 Tribes Investment Platform — Database Schema v2.0

## Overview
Production-grade PostgreSQL schema for a financial investment platform with:
- Multi-user trading infrastructure
- AI agent execution and tracking
- Tax accounting (Form 8949, Schedule D, K-1)
- Fund operations and distributions
- Risk management and compliance
- Wash sale detection and reporting

## Core Tables (29 total)

### Authentication & Users (4 tables)
1. **users** — Core user profiles, roles, authentication
2. **login_log** — Audit trail of login events
3. **passkey_credentials** — WebAuthn/passkey storage
4. **access_requests** — Onboarding and access control

### Trading Infrastructure (5 tables)
1. **positions** — Open/closed trading positions (~9500 rows, heavily indexed)
2. **trades** — Closed trade history with P&L
3. **order_queue** — Pending orders awaiting execution
4. **broker_connections** — Third-party broker integrations
5. **signals** — AI trading signals with technical indicators

### Financial Accounts (3 tables)
1. **wallets** — User account balance and equity tracking
2. **equity_snapshots** — Daily/hourly performance snapshots
3. **fund_settings** — User-configurable account settings

### Risk & Compliance (3 tables)
1. **risk_events** — Kill switches, position limits, loss alerts
2. **trade_flags** — Trade quality flags and validation issues
3. **qa_reports** — QA and compliance reporting

### AI & Automation (3 tables)
1. **agent_stats** — Per-agent performance aggregates
2. **agent_preferences** — User-specific agent configuration
3. **auto_trade_log** — Automated execution audit trail

### Tax Accounting (4 tables)
1. **tax_ledger** — Detailed realized gains/losses (Form 8949)
2. **tax_lots** — Open tax lots for cost basis tracking
3. **wash_sales** — Wash sale rule detection and disallowed losses
4. **tax_allocations** — K-1 Schedule partnership allocations

### Fund Operations (2 tables)
1. **distributions** — Fund distributions with tax basis impact
2. **capital_accounts** — Partner/investor capital account balances

### Configuration & Support (2 tables)
1. **system_config** — Global system configuration and feature flags
2. **feedback** — User feedback and support tickets

### Verification & Security (1 table)
1. **verification_codes** — Email and 2FA verification codes

---

## Key Design Decisions

### ID Strategy
- **Primary Keys**: UUID (gen_random_uuid()) for all tables
- **Rationale**: Distributed systems, privacy, secure by design

### Monetary Values
- **Type**: NUMERIC(18,4) for all monetary columns
- **Precision**: Supports $9,999,999,999,999.9999 with 4 decimal places
- **Alternative**: Existing codebase uses BIGINT (cents), both supported

### Timestamps
- **Type**: TIMESTAMPTZ (timezone-aware)
- **Auto-management**: Triggers set created_at and updated_at automatically
- **Timezone**: Records store in UTC, displayed per user timezone

### Flexible Data
- **JSONB**: Used for:
  - fund_settings.data (auto-trading config)
  - risk_events.details (event metadata)
  - signals.indicators (technical indicators)
  - tax_allocations (K-1 fields)
  - agent_preferences (user config)
  - post_mortems.patterns (trade patterns)
  - system_config.value (feature flags)

### Critical Indexes
These indexes are essential for query performance:

| Table | Index | Purpose |
|-------|-------|---------|
| **positions** | (user_id, status) | Hot path: find open positions |
| **positions** | (symbol, status) | Market-wide position queries |
| **trades** | (user_id, closed_at) | Trade history lookup |
| **tax_ledger** | (user_id, tax_year) | Tax reporting by year |
| **tax_lots** | (user_id, status) | Open lot queries |
| **equity_snapshots** | (user_id, date, hour) | Performance charting |

### Foreign Keys & Referential Integrity
- All FK relationships use `ON DELETE CASCADE`
- Maintains data consistency without orphaned records
- Example: Deleting a user cascades to all positions, trades, wallets, etc.

### Dual Naming Conventions
Some tables support both camelCase and snake_case:
- users: firstName/lastName + first_name/last_name
- access_requests: firstName/lastName
- withdrawal_requests: userId
- withdrawal_requests: userId

**Rationale**: Backward compatibility with existing JavaScript codebase

---

## Positions Table (Largest Table)

**Expected Rows**: ~9500

**Critical Indexes**:
```sql
CREATE INDEX idx_positions_user_id ON positions(user_id);
CREATE INDEX idx_positions_user_status ON positions(user_id, status);
CREATE INDEX idx_positions_symbol_status ON positions(symbol, status);
CREATE INDEX idx_positions_opened_at ON positions(opened_at DESC);
CREATE INDEX idx_positions_agent ON positions(agent);
```

**Key Queries**:
1. Find user's open positions: `WHERE user_id = ? AND status = 'OPEN'`
2. Find market exposure: `WHERE symbol = ? AND status = 'OPEN'`
3. Recent positions: `ORDER BY opened_at DESC LIMIT ?`

---

## Tax Compliance Features

### 1. Cost Basis Tracking (tax_lots)
- FIFO/LIFO/Average cost method support
- Partial disposition handling (PARTIAL status)
- Wash sale adjustment column

### 2. Wash Sale Detection (wash_sales)
- Automatic detection when loss + 30-day repurchase occurs
- Disallowed loss calculation and tracking
- Links loss position to replacement position

### 3. Tax Reporting (tax_ledger + tax_allocations)
- Form 8949 detail (per-lot P&L)
- Schedule D summary (short/long-term gains)
- K-1 allocation reporting (partnerships)

### 4. Distributions (distributions)
- Return of capital vs. ordinary income
- Capital account tracking
- Tax year segregation

---

## Data Consistency & Auditing

### Automatic Timestamps
- **created_at**: Set once at insertion, immutable
- **updated_at**: Set on every INSERT and UPDATE via trigger
- **Trigger**: `update_updated_at_column()` applied to 11 tables

### Audit Trails
- **login_log**: Every authentication event
- **risk_events**: Every risk management trigger
- **auto_trade_log**: Every automated trade execution
- **trade_flags**: Trade quality issues

### Data Integrity
- Foreign key constraints ensure referential integrity
- UNIQUE constraints prevent duplicates:
  - users(email)
  - wallets(user_id)
  - broker_connections(user_id, broker_name)
  - agent_stats(agent_name)
  - system_config(key)
  - capital_accounts(user_id)

---

## Performance Considerations

### Large Table Optimization
**positions** table expected to have ~9500 rows:
- Composite index on (user_id, status) for typical query pattern
- Composite index on (symbol, status) for market-wide analysis
- Index on opened_at DESC for time-series queries

### Join Optimization
- All FK columns indexed to enable fast nested loop joins
- Foreign key constraints enable query optimizer hints

### Snapshot Strategy
- equity_snapshots table enables fast charting without aggregating trades
- UNIQUE(user_id, date, hour) prevents duplicates
- Compound index for efficient range queries

---

## Migration & Deployment

### Idempotent Initialization
Schema supports running multiple times:
- `DROP TABLE IF EXISTS ... CASCADE` at top
- `CREATE TABLE IF NOT EXISTS` for all tables
- `CREATE INDEX IF NOT EXISTS` for all indexes
- Triggers use `CREATE OR REPLACE FUNCTION`

### Seed Data
Agent stats seeded with base agents:
```sql
INSERT INTO agent_stats (agent_name) VALUES
  ('Viper'), ('Oracle'), ('Spectre'), ('Sentinel'), ('Phoenix'), ('Titan')
  ON CONFLICT (agent_name) DO NOTHING;
```

### Production Checklist
- [ ] Run schema against staging PostgreSQL 14+
- [ ] Verify all tables created
- [ ] Check index creation success
- [ ] Run trigger verification
- [ ] Load test with 9500 positions
- [ ] Backup production before applying

---

## Extension Requirements

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

- **uuid-ossp**: UUID generation (uuid_generate_v4())
- **pgcrypto**: Cryptographic functions (for password hashing, encryption)

---

## Compatibility Notes

- **PostgreSQL Version**: 12+
- **Tested On**: PostgreSQL 14, 15, 16
- **JSONB Support**: Required (PostgreSQL 9.4+)
- **Timezone Awareness**: Required for TIMESTAMPTZ

---

## Schema Statistics

| Metric | Value |
|--------|-------|
| Total Tables | 29 |
| Total Columns | ~280+ |
| Primary Keys | 29 (UUID) |
| Foreign Keys | 30+ |
| Indexes | 50+ |
| Triggers | 11 |
| Functions | 1 (update_updated_at_column) |
| Total Lines | 809 |

---

Generated: 2026-04-01
Platform: 12 Tribes Investment Platform
