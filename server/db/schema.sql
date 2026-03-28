-- ═══════════════════════════════════════════
--   12 TRIBES — DATABASE SCHEMA v1.0
--   PostgreSQL | Financial-Grade Data Model
--   ACID-compliant | Audit-ready
-- ═══════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═══════ USERS ═══════
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100) NOT NULL,
  avatar        VARCHAR(10),
  phone         VARCHAR(20),
  role          VARCHAR(20) DEFAULT 'investor' CHECK (role IN ('investor', 'admin', 'viewer')),
  status        VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending')),

  -- Passkey / WebAuthn
  passkey_credential_id TEXT,
  passkey_public_key    TEXT,

  -- Trading mode
  trading_mode  VARCHAR(10) DEFAULT 'paper' CHECK (trading_mode IN ('paper', 'live')),

  -- Metadata
  registered_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  login_count   INTEGER DEFAULT 0,

  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);

-- ═══════ LOGIN AUDIT LOG ═══════
CREATE TABLE IF NOT EXISTS login_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  login_at    TIMESTAMPTZ DEFAULT NOW(),
  method      VARCHAR(20) NOT NULL, -- 'email', 'passkey', 'token'
  ip_address  INET,
  user_agent  TEXT,
  success     BOOLEAN DEFAULT true
);

CREATE INDEX idx_login_log_user ON login_log(user_id);
CREATE INDEX idx_login_log_time ON login_log(login_at DESC);

-- ═══════ WALLETS ═══════
CREATE TABLE IF NOT EXISTS wallets (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  -- Balances (stored as BIGINT cents for precision — divide by 100 for dollars)
  balance         BIGINT NOT NULL DEFAULT 10000000,    -- $100,000.00 in cents
  initial_balance BIGINT NOT NULL DEFAULT 10000000,
  equity          BIGINT NOT NULL DEFAULT 10000000,

  -- P&L tracking
  unrealized_pnl  BIGINT DEFAULT 0,
  realized_pnl    BIGINT DEFAULT 0,

  -- Trade stats
  trade_count     INTEGER DEFAULT 0,
  win_count       INTEGER DEFAULT 0,
  loss_count      INTEGER DEFAULT 0,

  -- Deposit info
  deposit_amount    BIGINT DEFAULT 10000000,
  deposit_timestamp TIMESTAMPTZ DEFAULT NOW(),

  -- Broker linkage
  broker_name         VARCHAR(50),     -- 'alpaca', 'ibkr', etc.
  broker_account_id   VARCHAR(100),
  broker_access_token TEXT,            -- Encrypted
  broker_token_expiry TIMESTAMPTZ,
  broker_linked_at    TIMESTAMPTZ,

  -- Risk controls
  kill_switch_active  BOOLEAN DEFAULT false,
  max_daily_loss      BIGINT,          -- Custom per-user override
  max_position_size   BIGINT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wallets_user ON wallets(user_id);

-- ═══════ POSITIONS (Open) ═══════
CREATE TABLE IF NOT EXISTS positions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  wallet_id     UUID REFERENCES wallets(id) ON DELETE CASCADE,

  -- Trade details
  symbol        VARCHAR(20) NOT NULL,
  side          VARCHAR(5) NOT NULL CHECK (side IN ('LONG', 'SHORT')),
  quantity      DECIMAL(18, 8) NOT NULL,
  entry_price   DECIMAL(18, 8) NOT NULL,
  current_price DECIMAL(18, 8),

  -- P&L
  unrealized_pnl BIGINT DEFAULT 0,
  return_pct     DECIMAL(10, 4) DEFAULT 0,

  -- Execution
  agent           VARCHAR(20),       -- AI agent that initiated
  execution_mode  VARCHAR(10) DEFAULT 'paper' CHECK (execution_mode IN ('paper', 'live')),
  broker_order_id VARCHAR(100),      -- External broker order ID

  -- Risk
  stop_loss_price   DECIMAL(18, 8),
  take_profit_price DECIMAL(18, 8),

  -- Timestamps
  opened_at   TIMESTAMPTZ DEFAULT NOW(),
  status      VARCHAR(10) DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSING', 'CLOSED')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_positions_user ON positions(user_id);
CREATE INDEX idx_positions_status ON positions(status);
CREATE INDEX idx_positions_symbol ON positions(symbol);
CREATE INDEX idx_positions_agent ON positions(agent);

-- ═══════ TRADE HISTORY (Closed) ═══════
CREATE TABLE IF NOT EXISTS trades (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  wallet_id     UUID REFERENCES wallets(id) ON DELETE CASCADE,
  position_id   UUID,                -- Reference to original position

  -- Trade details
  symbol        VARCHAR(20) NOT NULL,
  side          VARCHAR(5) NOT NULL,
  quantity      DECIMAL(18, 8) NOT NULL,
  entry_price   DECIMAL(18, 8) NOT NULL,
  close_price   DECIMAL(18, 8) NOT NULL,

  -- P&L
  realized_pnl  BIGINT NOT NULL,
  return_pct    DECIMAL(10, 4),

  -- Execution
  agent           VARCHAR(20),
  execution_mode  VARCHAR(10) DEFAULT 'paper',
  broker_order_id VARCHAR(100),

  -- Timing
  opened_at  TIMESTAMPTZ NOT NULL,
  closed_at  TIMESTAMPTZ DEFAULT NOW(),
  hold_time_seconds INTEGER,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_trades_user ON trades(user_id);
CREATE INDEX idx_trades_symbol ON trades(symbol);
CREATE INDEX idx_trades_closed ON trades(closed_at DESC);
CREATE INDEX idx_trades_agent ON trades(agent);

-- ═══════ EQUITY SNAPSHOTS (Performance Tracking) ═══════
CREATE TABLE IF NOT EXISTS equity_snapshots (
  id        BIGSERIAL PRIMARY KEY,
  user_id   UUID REFERENCES users(id) ON DELETE CASCADE,

  -- Snapshot data
  equity          BIGINT NOT NULL,
  balance         BIGINT NOT NULL,
  unrealized_pnl  BIGINT DEFAULT 0,
  realized_pnl    BIGINT DEFAULT 0,
  position_count  INTEGER DEFAULT 0,

  -- Time
  snapshot_date DATE NOT NULL,
  snapshot_hour SMALLINT,           -- 0-23, for intraday
  snapped_at    TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, snapshot_date, snapshot_hour)
);

CREATE INDEX idx_snapshots_user_date ON equity_snapshots(user_id, snapshot_date DESC);

-- ═══════ AI AGENT STATS ═══════
CREATE TABLE IF NOT EXISTS agent_stats (
  id           SERIAL PRIMARY KEY,
  agent_name   VARCHAR(20) NOT NULL UNIQUE,
  total_trades INTEGER DEFAULT 0,
  wins         INTEGER DEFAULT 0,
  losses       INTEGER DEFAULT 0,
  total_pnl    BIGINT DEFAULT 0,
  best_trade   BIGINT DEFAULT 0,
  worst_trade  BIGINT DEFAULT 0,
  avg_return   DECIMAL(10, 4) DEFAULT 0,

  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed AI agents
INSERT INTO agent_stats (agent_name) VALUES
  ('Viper'), ('Oracle'), ('Spectre'), ('Sentinel'), ('Phoenix'), ('Titan')
ON CONFLICT (agent_name) DO NOTHING;

-- ═══════ BROKER CONNECTIONS ═══════
CREATE TABLE IF NOT EXISTS broker_connections (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  broker_name     VARCHAR(50) NOT NULL,    -- 'alpaca', 'ibkr', 'coinbase'
  account_id      VARCHAR(100),

  -- OAuth tokens (encrypted at rest)
  access_token    TEXT,
  refresh_token   TEXT,
  token_expiry    TIMESTAMPTZ,

  -- Account info
  account_type    VARCHAR(20),             -- 'margin', 'cash', 'crypto'
  account_status  VARCHAR(20),
  buying_power    BIGINT,

  -- Status
  is_active       BOOLEAN DEFAULT true,
  linked_at       TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at  TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, broker_name)
);

CREATE INDEX idx_broker_conn_user ON broker_connections(user_id);

-- ═══════ ORDER QUEUE (for confirmation flow) ═══════
CREATE TABLE IF NOT EXISTS order_queue (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,

  -- Order details
  symbol        VARCHAR(20) NOT NULL,
  side          VARCHAR(5) NOT NULL,
  quantity      DECIMAL(18, 8) NOT NULL,
  order_type    VARCHAR(10) DEFAULT 'MARKET' CHECK (order_type IN ('MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT')),
  limit_price   DECIMAL(18, 8),
  stop_price    DECIMAL(18, 8),

  -- Execution target
  execution_mode VARCHAR(10) NOT NULL,
  agent          VARCHAR(20),

  -- Confirmation
  status         VARCHAR(20) DEFAULT 'pending_confirmation'
                 CHECK (status IN ('pending_confirmation', 'confirmed', 'executing', 'filled', 'rejected', 'cancelled', 'expired')),
  requires_confirmation BOOLEAN DEFAULT false,
  confirmed_at   TIMESTAMPTZ,
  confirmed_by   UUID REFERENCES users(id),

  -- Result
  fill_price     DECIMAL(18, 8),
  broker_order_id VARCHAR(100),
  error_message  TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '5 minutes'),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_user ON order_queue(user_id);
CREATE INDEX idx_orders_status ON order_queue(status);

-- ═══════ RISK EVENTS LOG ═══════
CREATE TABLE IF NOT EXISTS risk_events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id),
  event_type  VARCHAR(30) NOT NULL,   -- 'kill_switch', 'position_limit', 'daily_loss_limit', 'drawdown_alert'
  severity    VARCHAR(10) NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  message     TEXT NOT NULL,
  metadata    JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_risk_events_user ON risk_events(user_id);
CREATE INDEX idx_risk_events_type ON risk_events(event_type);

-- ═══════ UPDATED_AT TRIGGER ═══════
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_wallets_updated_at BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_positions_updated_at BEFORE UPDATE ON positions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_broker_conn_updated_at BEFORE UPDATE ON broker_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON order_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
