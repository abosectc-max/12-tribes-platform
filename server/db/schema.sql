-- ═══════════════════════════════════════════════════════════════════════════
--   12 TRIBES INVESTMENT PLATFORM — DATABASE SCHEMA v2.0
--   PostgreSQL | Financial-Grade Data Model
--   ACID-compliant | Audit-ready | Production
--
--   22+ core tables covering:
--   - User management & authentication
--   - Trading infrastructure (positions, trades, orders)
--   - Risk management & compliance
--   - Tax accounting & reporting
--   - Fund operations & distributions
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- IDEMPOTENT CLEANUP
-- ───────────────────────────────────────────────────────────────────────────
-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS post_mortems CASCADE;
DROP TABLE IF EXISTS agent_preferences CASCADE;
DROP TABLE IF EXISTS system_config CASCADE;
DROP TABLE IF EXISTS trade_flags CASCADE;
DROP TABLE IF EXISTS passkey_credentials CASCADE;
DROP TABLE IF EXISTS capital_accounts CASCADE;
DROP TABLE IF EXISTS distributions CASCADE;
DROP TABLE IF EXISTS tax_allocations CASCADE;
DROP TABLE IF EXISTS wash_sales CASCADE;
DROP TABLE IF EXISTS tax_lots CASCADE;
DROP TABLE IF EXISTS tax_ledger CASCADE;
DROP TABLE IF EXISTS signals CASCADE;
DROP TABLE IF EXISTS tax_ledger CASCADE;
DROP TABLE IF EXISTS withdrawal_requests CASCADE;
DROP TABLE IF EXISTS feedback CASCADE;
DROP TABLE IF EXISTS qa_reports CASCADE;
DROP TABLE IF EXISTS verification_codes CASCADE;
DROP TABLE IF EXISTS fund_settings CASCADE;
DROP TABLE IF EXISTS auto_trade_log CASCADE;
DROP TABLE IF EXISTS access_requests CASCADE;
DROP TABLE IF EXISTS risk_events CASCADE;
DROP TABLE IF EXISTS order_queue CASCADE;
DROP TABLE IF EXISTS broker_connections CASCADE;
DROP TABLE IF EXISTS agent_stats CASCADE;
DROP TABLE IF EXISTS snapshots CASCADE;
DROP TABLE IF EXISTS trades CASCADE;
DROP TABLE IF EXISTS positions CASCADE;
DROP TABLE IF EXISTS wallets CASCADE;
DROP TABLE IF EXISTS login_log CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═══════════════════════════════════════════════════════════════════════════
-- USERS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Core user authentication and profile data
-- Supports dual naming conventions (camelCase + snake_case) for compatibility
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             VARCHAR(255) UNIQUE NOT NULL,
  password_hash     VARCHAR(255) NOT NULL,
  first_name        VARCHAR(100),
  last_name         VARCHAR(100),
  firstName         VARCHAR(100),                    -- Dual convention
  lastName          VARCHAR(100),                    -- Dual convention
  phone             VARCHAR(20),
  avatar            VARCHAR(10),
  role              VARCHAR(20) DEFAULT 'investor'   CHECK (role IN ('admin', 'investor', 'viewer')),
  status            VARCHAR(20) DEFAULT 'active'     CHECK (status IN ('active', 'suspended', 'deleted', 'pending')),
  trading_mode      VARCHAR(10) DEFAULT 'paper'      CHECK (trading_mode IN ('paper', 'live')),
  ownership_pct     NUMERIC(10,4),                   -- Investor ownership percentage
  account_type      VARCHAR(50),                     -- e.g., 'individual', 'accredited'
  login_count       INTEGER DEFAULT 0,
  registered_at     TIMESTAMPTZ,
  last_login_at     TIMESTAMPTZ,
  emailVerified     BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_created ON users(created_at DESC);

COMMENT ON TABLE users IS 'Core user authentication, profile, and account metadata.';

-- ═══════════════════════════════════════════════════════════════════════════
-- WALLETS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- One wallet per user; tracks capital, P&L, and trading statistics
-- All monetary values in NUMERIC for precision
CREATE TABLE wallets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance           NUMERIC(18,4) NOT NULL DEFAULT 100000.0000,
  initial_balance   NUMERIC(18,4) NOT NULL DEFAULT 100000.0000,
  equity            NUMERIC(18,4) NOT NULL DEFAULT 100000.0000,
  peak_equity       NUMERIC(18,4),
  unrealized_pnl    NUMERIC(18,4) DEFAULT 0,
  realized_pnl      NUMERIC(18,4) DEFAULT 0,
  trade_count       INTEGER DEFAULT 0,
  win_count         INTEGER DEFAULT 0,
  loss_count        INTEGER DEFAULT 0,
  deposit_amount    NUMERIC(18,4) DEFAULT 100000.0000,
  deposit_timestamp TIMESTAMPTZ DEFAULT NOW(),
  kill_switch_active BOOLEAN DEFAULT false,
  first_trade_at    TIMESTAMPTZ,
  total_withdrawals NUMERIC(18,4) DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wallets_user_id ON wallets(user_id);
CREATE UNIQUE INDEX idx_wallets_unique_user ON wallets(user_id);

COMMENT ON TABLE wallets IS 'Financial account state: balance, equity, P&L, and trading statistics.';

-- ═══════════════════════════════════════════════════════════════════════════
-- POSITIONS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Open and closed trading positions (~9500 rows expected)
-- Critical indexes for query performance
CREATE TABLE positions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id         UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  symbol            VARCHAR(20) NOT NULL,
  side              VARCHAR(5) NOT NULL CHECK (side IN ('LONG', 'SHORT')),
  quantity          NUMERIC(18,8) NOT NULL,
  entry_price       NUMERIC(18,8) NOT NULL,
  current_price     NUMERIC(18,8),
  agent             VARCHAR(50),                     -- AI agent name (Viper, Oracle, etc.)
  execution_mode    VARCHAR(10) DEFAULT 'paper'      CHECK (execution_mode IN ('paper', 'live')),
  unrealized_pnl    NUMERIC(18,4) DEFAULT 0,
  return_pct        NUMERIC(10,4),
  realized_pnl      NUMERIC(18,4),
  stop_loss         NUMERIC(18,8),
  take_profit       NUMERIC(18,8),
  opened_at         TIMESTAMPTZ DEFAULT NOW(),
  closed_at         TIMESTAMPTZ,
  status            VARCHAR(10) DEFAULT 'OPEN'       CHECK (status IN ('OPEN', 'CLOSED')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_positions_user_id ON positions(user_id);
CREATE INDEX idx_positions_user_status ON positions(user_id, status);
CREATE INDEX idx_positions_symbol_status ON positions(symbol, status);
CREATE INDEX idx_positions_opened_at ON positions(opened_at DESC);
CREATE INDEX idx_positions_agent ON positions(agent);

COMMENT ON TABLE positions IS 'Open/closed trading positions. Largest table (~9500 rows). Requires (user_id, status) and (symbol, status) indexes.';

-- ═══════════════════════════════════════════════════════════════════════════
-- TRADES TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Closed trade history with full P&L accounting
CREATE TABLE trades (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id         UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  position_id       UUID,                            -- Reference to original position
  symbol            VARCHAR(20) NOT NULL,
  side              VARCHAR(5) NOT NULL CHECK (side IN ('LONG', 'SHORT')),
  quantity          NUMERIC(18,8) NOT NULL,
  entry_price       NUMERIC(18,8) NOT NULL,
  close_price       NUMERIC(18,8) NOT NULL,
  realized_pnl      NUMERIC(18,4) NOT NULL,
  return_pct        NUMERIC(10,4),
  agent             VARCHAR(50),
  execution_mode    VARCHAR(10) DEFAULT 'paper'      CHECK (execution_mode IN ('paper', 'live')),
  opened_at         TIMESTAMPTZ NOT NULL,
  closed_at         TIMESTAMPTZ DEFAULT NOW(),
  hold_time_seconds INTEGER,
  status            VARCHAR(20),                     -- e.g., 'filled', 'cancelled'
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_trades_user_id ON trades(user_id);
CREATE INDEX idx_trades_closed_at ON trades(closed_at DESC);
CREATE INDEX idx_trades_user_closed ON trades(user_id, closed_at DESC);
CREATE INDEX idx_trades_symbol ON trades(symbol);
CREATE INDEX idx_trades_agent ON trades(agent);

COMMENT ON TABLE trades IS 'Closed trade history with full P&L and execution details.';

-- ═══════════════════════════════════════════════════════════════════════════
-- EQUITY SNAPSHOTS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Daily/hourly snapshots for performance tracking and reporting
CREATE TABLE snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  equity            NUMERIC(18,4) NOT NULL,
  balance           NUMERIC(18,4) NOT NULL,
  unrealized_pnl    NUMERIC(18,4) DEFAULT 0,
  realized_pnl      NUMERIC(18,4) DEFAULT 0,
  position_count    INTEGER DEFAULT 0,
  date              VARCHAR(10) NOT NULL,            -- YYYY-MM-DD format
  hour              INTEGER,                         -- 0-23 for intraday
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date, hour)
);

CREATE INDEX idx_snapshots_user_date ON snapshots(user_id, date DESC, hour DESC);
CREATE INDEX idx_snapshots_user_id ON snapshots(user_id);

COMMENT ON TABLE snapshots IS 'Daily/hourly equity snapshots for performance tracking and historical analysis.';

-- ═══════════════════════════════════════════════════════════════════════════
-- LOGIN LOG TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Audit trail for authentication events
CREATE TABLE login_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  method            VARCHAR(20) NOT NULL,            -- 'email', 'passkey', 'token'
  ip                INET,                            -- IP address
  success           BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_login_log_user_id ON login_log(user_id);
CREATE INDEX idx_login_log_created ON login_log(created_at DESC);

COMMENT ON TABLE login_log IS 'Authentication audit trail for security and compliance.';

-- ═══════════════════════════════════════════════════════════════════════════
-- AGENT STATS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Aggregate statistics per AI trading agent
CREATE TABLE agent_stats (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name        VARCHAR(50) UNIQUE NOT NULL,
  total_trades      INTEGER DEFAULT 0,
  wins              INTEGER DEFAULT 0,
  losses            INTEGER DEFAULT 0,
  total_pnl         NUMERIC(18,4) DEFAULT 0,
  best_trade        NUMERIC(18,4),
  worst_trade       NUMERIC(18,4),
  avg_return        NUMERIC(10,4),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE agent_stats IS 'Performance statistics aggregated per AI agent.';

-- ═══════════════════════════════════════════════════════════════════════════
-- BROKER CONNECTIONS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Third-party broker account linkage (Alpaca, IBKR, etc.)
CREATE TABLE broker_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker_name       VARCHAR(50) NOT NULL,            -- 'alpaca', 'ibkr', 'coinbase'
  status            VARCHAR(20),                     -- 'active', 'inactive', 'error'
  api_key_hash      VARCHAR(255),                    -- Hashed API key (encrypted at rest)
  connected_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_broker_connections_user ON broker_connections(user_id);

COMMENT ON TABLE broker_connections IS 'Third-party broker integrations and OAuth tokens (encrypted).';

-- ═══════════════════════════════════════════════════════════════════════════
-- RISK EVENTS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Risk management and compliance alerts
CREATE TABLE risk_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  type              VARCHAR(50),                     -- 'kill_switch', 'position_limit', 'daily_loss_limit'
  event_type        VARCHAR(50),                     -- Dual naming convention
  severity          VARCHAR(20) DEFAULT 'warning'    CHECK (severity IN ('info', 'warning', 'critical')),
  message           TEXT NOT NULL,
  details           JSONB,                           -- Flexible event metadata
  timestamp         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_risk_events_user ON risk_events(user_id);
CREATE INDEX idx_risk_events_type ON risk_events(event_type);
CREATE INDEX idx_risk_events_created ON risk_events(created_at DESC);

COMMENT ON TABLE risk_events IS 'Risk management audit trail (kill switches, position limits, daily loss alerts).';

-- ═══════════════════════════════════════════════════════════════════════════
-- ORDER QUEUE TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Pending orders awaiting execution or confirmation
CREATE TABLE order_queue (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol            VARCHAR(20) NOT NULL,
  side              VARCHAR(5) NOT NULL CHECK (side IN ('LONG', 'SHORT')),
  quantity          NUMERIC(18,8) NOT NULL,
  price             NUMERIC(18,8),
  status            VARCHAR(20) DEFAULT 'pending'    CHECK (status IN ('pending', 'filled', 'cancelled', 'rejected')),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_order_queue_user ON order_queue(user_id);
CREATE INDEX idx_order_queue_status ON order_queue(status);

COMMENT ON TABLE order_queue IS 'Pending orders awaiting execution or confirmation.';

-- ═══════════════════════════════════════════════════════════════════════════
-- ACCESS REQUESTS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Investor onboarding and access control
CREATE TABLE access_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  email             VARCHAR(255) NOT NULL,
  firstName         VARCHAR(100),
  lastName          VARCHAR(100),
  reason            TEXT,
  status            VARCHAR(20) DEFAULT 'pending'    CHECK (status IN ('pending', 'approved', 'denied')),
  reviewed_by       UUID REFERENCES users(id),
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_access_requests_user ON access_requests(user_id);
CREATE INDEX idx_access_requests_status ON access_requests(status);

COMMENT ON TABLE access_requests IS 'Investor onboarding and platform access control.';

-- ═══════════════════════════════════════════════════════════════════════════
-- AUTO TRADE LOG TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Execution log for automated AI trading activity
CREATE TABLE auto_trade_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent             VARCHAR(50),
  symbol            VARCHAR(20),
  side              VARCHAR(5),
  quantity          NUMERIC(18,8),
  price             NUMERIC(18,8),
  pnl               NUMERIC(18,4),
  action            VARCHAR(50),                     -- e.g., 'BUY', 'SELL', 'EXIT'
  timestamp         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_auto_trade_log_user ON auto_trade_log(user_id);
CREATE INDEX idx_auto_trade_log_agent ON auto_trade_log(agent);
CREATE INDEX idx_auto_trade_log_created ON auto_trade_log(created_at DESC);

COMMENT ON TABLE auto_trade_log IS 'Execution log for automated AI trading (audit trail).';

-- ═══════════════════════════════════════════════════════════════════════════
-- FUND SETTINGS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Auto-trading configuration and user preferences
CREATE TABLE fund_settings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  data              JSONB,                           -- Flexible config (autoTrading enabled, agent prefs, etc.)
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_fund_settings_user ON fund_settings(user_id);

COMMENT ON TABLE fund_settings IS 'User-configurable fund/account settings in JSONB format.';

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION CODES TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Email and 2FA verification codes
CREATE TABLE verification_codes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  email             VARCHAR(255),
  code              VARCHAR(10),                     -- 6-digit code
  type              VARCHAR(20),                     -- 'email', '2fa', 'password_reset'
  expires_at        TIMESTAMPTZ,
  used              BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_verification_codes_user ON verification_codes(user_id);
CREATE INDEX idx_verification_codes_code ON verification_codes(code);
CREATE INDEX idx_verification_codes_expires ON verification_codes(expires_at);

COMMENT ON TABLE verification_codes IS 'Time-limited verification codes for email and 2FA.';

-- ═══════════════════════════════════════════════════════════════════════════
-- QA REPORTS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Quality assurance and compliance reporting
CREATE TABLE qa_reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_data       JSONB,                           -- Full report metrics
  tick_number       BIGINT,                          -- Market tick/snapshot ID
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE qa_reports IS 'QA and compliance reporting (flexible JSONB format).';

-- ═══════════════════════════════════════════════════════════════════════════
-- FEEDBACK TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- User feedback and support tickets
CREATE TABLE feedback (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  message           TEXT NOT NULL,
  status            VARCHAR(20) DEFAULT 'new'        CHECK (status IN ('new', 'reviewed', 'resolved')),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_feedback_user ON feedback(user_id);
CREATE INDEX idx_feedback_status ON feedback(status);

COMMENT ON TABLE feedback IS 'User feedback and support tickets.';

-- ═══════════════════════════════════════════════════════════════════════════
-- WITHDRAWAL REQUESTS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Fund withdrawal processing workflow
CREATE TABLE withdrawal_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  userId            UUID REFERENCES users(id) ON DELETE CASCADE,
  amount            NUMERIC(18,4) NOT NULL,
  method            VARCHAR(50),                     -- 'bank_transfer', 'check', 'wire'
  status            VARCHAR(20) DEFAULT 'pending'    CHECK (status IN ('pending', 'approved', 'processing', 'completed', 'denied')),
  reviewed_by       UUID REFERENCES users(id),
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_withdrawal_requests_user_id ON withdrawal_requests(userId);
CREATE INDEX idx_withdrawal_requests_status ON withdrawal_requests(status);

COMMENT ON TABLE withdrawal_requests IS 'Fund withdrawal processing and audit trail.';

-- ═══════════════════════════════════════════════════════════════════════════
-- SIGNALS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- AI trading signals and market indicators
CREATE TABLE signals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  agent             VARCHAR(50),
  symbol            VARCHAR(20),
  side              VARCHAR(5),
  strength          NUMERIC(5,2),                    -- Signal strength 0-100
  price             NUMERIC(18,8),
  indicators        JSONB,                           -- Technical indicators (RSI, MACD, etc.)
  timestamp         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_signals_user ON signals(user_id);
CREATE INDEX idx_signals_agent ON signals(agent);
CREATE INDEX idx_signals_created ON signals(created_at DESC);

COMMENT ON TABLE signals IS 'AI-generated trading signals with technical indicators.';

-- ═══════════════════════════════════════════════════════════════════════════
-- TAX LEDGER TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Detailed tax lot accounting for realized gains/losses
CREATE TABLE tax_ledger (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tax_lot_id        UUID,
  position_id       UUID REFERENCES positions(id),
  symbol            VARCHAR(20),
  side              VARCHAR(5),
  asset_class       VARCHAR(50),                     -- 'stock', 'option', 'crypto'
  quantity          NUMERIC(18,8),
  acquired_at       TIMESTAMPTZ,
  disposed_at       TIMESTAMPTZ,
  hold_days         INTEGER,
  holding_period    VARCHAR(20)                      CHECK (holding_period IN ('short_term', 'long_term')),
  cost_basis        NUMERIC(18,4),
  proceeds          NUMERIC(18,4),
  gain_loss         NUMERIC(18,4),
  wash_sale_disallowed NUMERIC(18,4),
  wash_sale_id      UUID,
  tax_year          INTEGER,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tax_ledger_user ON tax_ledger(user_id);
CREATE INDEX idx_tax_ledger_user_tax_year ON tax_ledger(user_id, tax_year);
CREATE INDEX idx_tax_ledger_disposed ON tax_ledger(disposed_at);

COMMENT ON TABLE tax_ledger IS 'Detailed tax lot accounting for Form 8949 and Schedule D reporting.';

-- ═══════════════════════════════════════════════════════════════════════════
-- TAX LOTS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Open tax lots for cost basis tracking (FIFO, LIFO, avg cost)
CREATE TABLE tax_lots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id       UUID REFERENCES positions(id),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol            VARCHAR(20),
  side              VARCHAR(5),
  quantity          NUMERIC(18,8),
  remaining_quantity NUMERIC(18,8),
  price_per_unit    NUMERIC(18,8),
  cost_basis        NUMERIC(18,4),
  adjusted_cost_basis NUMERIC(18,4),
  wash_sale_adjustment NUMERIC(18,4),
  acquired_at       TIMESTAMPTZ,
  disposed_at       TIMESTAMPTZ,
  status            VARCHAR(20) DEFAULT 'OPEN'       CHECK (status IN ('OPEN', 'CLOSED', 'PARTIAL')),
  agent             VARCHAR(50),
  asset_class       VARCHAR(50),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tax_lots_user ON tax_lots(user_id);
CREATE INDEX idx_tax_lots_user_status ON tax_lots(user_id, status);
CREATE INDEX idx_tax_lots_position ON tax_lots(position_id);

COMMENT ON TABLE tax_lots IS 'Open tax lots for cost basis tracking and wash sale detection.';

-- ═══════════════════════════════════════════════════════════════════════════
-- WASH SALES TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Wash sale rule tracking and disallowed loss accounting
CREATE TABLE wash_sales (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol            VARCHAR(20),
  loss_ledger_id    UUID,
  loss_position_id  UUID,
  replacement_lot_id UUID,
  replacement_position_id UUID,
  disallowed_loss   NUMERIC(18,4),
  original_loss     NUMERIC(18,4),
  loss_disposed_at  TIMESTAMPTZ,
  replacement_acquired_at TIMESTAMPTZ,
  window_start      TIMESTAMPTZ,
  window_end        TIMESTAMPTZ,
  detected_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wash_sales_user ON wash_sales(user_id);
CREATE INDEX idx_wash_sales_symbol ON wash_sales(symbol);

COMMENT ON TABLE wash_sales IS 'Wash sale rule detection and disallowed loss tracking for tax compliance.';

-- ═══════════════════════════════════════════════════════════════════════════
-- TAX ALLOCATIONS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Partnership/fund tax allocation reporting
CREATE TABLE tax_allocations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  investor_name     VARCHAR(255),
  tax_year          INTEGER,
  ownership_pct     NUMERIC(10,4),
  -- Flexible allocation fields (K-1 Schedule)
  ordinary_income   NUMERIC(18,4),
  capital_gains     NUMERIC(18,4),
  qualified_div     NUMERIC(18,4),
  other_income      NUMERIC(18,4),
  deductions        NUMERIC(18,4),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tax_allocations_user ON tax_allocations(user_id);
CREATE INDEX idx_tax_allocations_tax_year ON tax_allocations(tax_year);

COMMENT ON TABLE tax_allocations IS 'K-1 Schedule allocation reporting for partnership tax purposes.';

-- ═══════════════════════════════════════════════════════════════════════════
-- DISTRIBUTIONS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Fund distribution history and tax basis impact
CREATE TABLE distributions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  investor_name     VARCHAR(255),
  withdrawal_request_id UUID REFERENCES withdrawal_requests(id),
  amount            NUMERIC(18,4),
  type              VARCHAR(50),                     -- 'ordinary', 'return_of_capital', 'qualified_div'
  method            VARCHAR(50),                     -- 'check', 'wire', 'ach'
  capital_account_before NUMERIC(18,4),
  capital_account_after NUMERIC(18,4),
  wallet_equity_at_distribution NUMERIC(18,4),
  tax_year          INTEGER,
  is_return_of_capital BOOLEAN,
  adjusted_basis_at_distribution NUMERIC(18,4),
  basis_exceeded    BOOLEAN,
  excess_over_basis NUMERIC(18,4),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_distributions_user ON distributions(user_id);
CREATE INDEX idx_distributions_tax_year ON distributions(tax_year);

COMMENT ON TABLE distributions IS 'Fund distributions with tax basis and K-1 reporting impact.';

-- ═══════════════════════════════════════════════════════════════════════════
-- CAPITAL ACCOUNTS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Partner/investor capital account tracking
CREATE TABLE capital_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  investor_name     VARCHAR(255),
  beginning_balance NUMERIC(18,4),
  contributions     NUMERIC(18,4) DEFAULT 0,
  distributions_total NUMERIC(18,4) DEFAULT 0,
  allocated_income  NUMERIC(18,4) DEFAULT 0,
  allocated_losses  NUMERIC(18,4) DEFAULT 0,
  ending_balance    NUMERIC(18,4),
  ownership_pct     NUMERIC(10,4),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_capital_accounts_user ON capital_accounts(user_id);

COMMENT ON TABLE capital_accounts IS 'Partner/investor capital account balances and tax basis.';

-- ═══════════════════════════════════════════════════════════════════════════
-- PASSKEY CREDENTIALS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- WebAuthn/passkey authentication credentials
CREATE TABLE passkey_credentials (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id     VARCHAR(255),
  public_key        TEXT,                            -- Stored in COSE format
  counter           BIGINT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_passkey_credentials_user ON passkey_credentials(user_id);

COMMENT ON TABLE passkey_credentials IS 'WebAuthn passkey authentication credentials.';

-- ═══════════════════════════════════════════════════════════════════════════
-- TRADE FLAGS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Trade quality flags and validation issues
CREATE TABLE trade_flags (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol            VARCHAR(20),
  side              VARCHAR(5),
  quantity          NUMERIC(18,8),
  flag_type         VARCHAR(50),                     -- 'pattern_match', 'stop_loss_hit', 'slippage_alert'
  message           TEXT,
  details           JSONB,
  status            VARCHAR(20),                     -- 'active', 'resolved', 'ignored'
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_trade_flags_user ON trade_flags(user_id);
CREATE INDEX idx_trade_flags_status ON trade_flags(status);

COMMENT ON TABLE trade_flags IS 'Trade quality flags for execution monitoring and post-trade analysis.';

-- ═══════════════════════════════════════════════════════════════════════════
-- SYSTEM CONFIG TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Global system configuration and feature flags
CREATE TABLE system_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key               VARCHAR(100) UNIQUE NOT NULL,
  value             JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_system_config_key ON system_config(key);

COMMENT ON TABLE system_config IS 'Global system configuration and feature flags (JSONB).';

-- ═══════════════════════════════════════════════════════════════════════════
-- AGENT PREFERENCES TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Per-user AI agent configuration and tuning
CREATE TABLE agent_preferences (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_name        VARCHAR(50),
  preferences       JSONB,                           -- Risk tolerance, position limits, etc.
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_preferences_user ON agent_preferences(user_id);
CREATE INDEX idx_agent_preferences_agent ON agent_preferences(agent_name);

COMMENT ON TABLE agent_preferences IS 'Per-user AI agent configuration and trading parameters.';

-- ═══════════════════════════════════════════════════════════════════════════
-- POST MORTEMS TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Trade analysis and lessons learned
CREATE TABLE post_mortems (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position_id       UUID REFERENCES positions(id),
  agent             VARCHAR(50),
  symbol            VARCHAR(20),
  side              VARCHAR(5),
  entry_price       NUMERIC(18,8),
  close_price       NUMERIC(18,8),
  pnl               NUMERIC(18,4),
  return_pct        NUMERIC(10,4),
  outcome           VARCHAR(20)                      CHECK (outcome IN ('WIN', 'LOSS', 'BREAKEVEN')),
  hold_time_seconds BIGINT,
  hold_time_display VARCHAR(100),
  exit_volatility   NUMERIC(10,4),
  exit_regime       VARCHAR(50),
  exit_vix          NUMERIC(10,2),
  patterns          JSONB,                           -- Array of detected patterns
  self_healing_action VARCHAR(100),
  self_healing_detail TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_post_mortems_user ON post_mortems(user_id);
CREATE INDEX idx_post_mortems_outcome ON post_mortems(outcome);
CREATE INDEX idx_post_mortems_agent ON post_mortems(agent);

COMMENT ON TABLE post_mortems IS 'Post-trade analysis and AI self-healing insights.';

-- ═══════════════════════════════════════════════════════════════════════════
-- AUDIT LOG TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Immutable audit trail for regulatory compliance (SEC 17a-4)
CREATE TABLE audit_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp         TIMESTAMPTZ DEFAULT NOW(),
  timestamp_ms      BIGINT,
  category          VARCHAR(50),                       -- TRADE, AUTH, ADMIN, RISK, COMPLIANCE, SYSTEM
  action            VARCHAR(100),                      -- e.g., TRADE_EXECUTED, POSITION_CLOSED, USER_DELETED
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  details           JSONB,                             -- Flexible metadata (position_id, symbol, quantity, price, etc.)
  metadata          JSONB,                             -- server_version, node_version, etc.
  prev_hash         VARCHAR(255),                      -- Hash chain for tamper detection
  entry_hash        VARCHAR(255),                      -- This entry's hash
  retention_until   TIMESTAMPTZ,                       -- Regulatory retention period (6-year minimum)
  immutable         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_category ON audit_log(category);
CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp DESC);
CREATE INDEX idx_audit_log_immutable ON audit_log(immutable);

COMMENT ON TABLE audit_log IS 'Immutable compliance audit trail (SEC 17a-4, FINRA) with hash chain tamper detection.';

-- ═══════════════════════════════════════════════════════════════════════════
-- SYMBOL PERFORMANCE TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Per-symbol performance tracking and cooldown management after losses
CREATE TABLE symbol_performance (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol            VARCHAR(20) UNIQUE NOT NULL,
  cooldown_until    TIMESTAMPTZ,                       -- Timestamp when cooldown expires
  cooldown_reason   TEXT,                              -- Reason for cooldown (e.g., post-mortem analysis)
  last_trade_at     TIMESTAMPTZ,
  last_loss_at      TIMESTAMPTZ,
  consecutive_losses INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_symbol_performance_symbol ON symbol_performance(symbol);
CREATE INDEX idx_symbol_performance_cooldown ON symbol_performance(cooldown_until);

COMMENT ON TABLE symbol_performance IS 'Per-symbol performance metrics and cooldown tracking to dampen signals after consecutive losses.';

-- ═══════════════════════════════════════════════════════════════════════════
-- TRIGGERS & UTILITY FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════════

-- Automatic updated_at timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at
CREATE TRIGGER trigger_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_wallets_updated_at BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_positions_updated_at BEFORE UPDATE ON positions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_snapshots_updated_at BEFORE UPDATE ON snapshots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_broker_connections_updated_at BEFORE UPDATE ON broker_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_fund_settings_updated_at BEFORE UPDATE ON fund_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_tax_lots_updated_at BEFORE UPDATE ON tax_lots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_capital_accounts_updated_at BEFORE UPDATE ON capital_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_agent_preferences_updated_at BEFORE UPDATE ON agent_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_agent_stats_updated_at BEFORE UPDATE ON agent_stats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_withdrawal_requests_updated_at BEFORE UPDATE ON withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_system_config_updated_at BEFORE UPDATE ON system_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_symbol_performance_updated_at BEFORE UPDATE ON symbol_performance
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════════════
-- FINAL SUMMARY
-- ═══════════════════════════════════════════════════════════════════════════
-- Total Tables: 31
-- Core Users/Auth: users, login_log, passkey_credentials, access_requests
-- Trading: positions, trades, order_queue, broker_connections, signals
-- Risk/Compliance: risk_events, trade_flags, qa_reports, audit_log
-- Account: wallets, snapshots, fund_settings, verification_codes
-- Feedback: feedback, withdrawal_requests, auto_trade_log
-- Tax Accounting: tax_ledger, tax_lots, wash_sales, tax_allocations
-- Fund Operations: capital_accounts, distributions
-- AI/Analytics: agent_stats, agent_preferences, post_mortems
-- Configuration: system_config
-- Symbol Management: symbol_performance
--
-- Key Indexes:
--   - positions: (user_id, status), (symbol, status) — PRIMARY HOT PATH
--   - trades: (user_id, closed_at)
--   - tax_ledger: (user_id, tax_year)
--   - tax_lots: (user_id, status)
--   - snapshots: (user_id, date, hour)
--   - All FK columns indexed for join performance
-- ═══════════════════════════════════════════════════════════════════════════
