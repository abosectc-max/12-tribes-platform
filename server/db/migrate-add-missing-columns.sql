-- ═══════════════════════════════════════════════════════════════════════════
--   12 TRIBES — SCHEMA PATCH: Add missing columns for runtime compatibility
--   Safe to run multiple times (IF NOT EXISTS / IF EXISTS checks)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── TAX_LEDGER: missing columns from trade backfill ───
ALTER TABLE tax_ledger ADD COLUMN IF NOT EXISTS adjusted_gain_loss NUMERIC(18,4);
ALTER TABLE tax_ledger ADD COLUMN IF NOT EXISTS agent VARCHAR(50);
ALTER TABLE tax_ledger ADD COLUMN IF NOT EXISTS cost_basis_method VARCHAR(30);
ALTER TABLE tax_ledger ADD COLUMN IF NOT EXISTS is_wash_sale BOOLEAN DEFAULT FALSE;
ALTER TABLE tax_ledger ADD COLUMN IF NOT EXISTS form_8949_box VARCHAR(10);

-- ─── AUTO_TRADE_LOG: missing 'reason' column ───
ALTER TABLE auto_trade_log ADD COLUMN IF NOT EXISTS reason TEXT;

-- ─── SIGNALS: JS uses score/confluence/action/trade_id instead of strength/price/indicators ───
ALTER TABLE signals ADD COLUMN IF NOT EXISTS score NUMERIC(5,2);
ALTER TABLE signals ADD COLUMN IF NOT EXISTS confluence NUMERIC(5,2);
ALTER TABLE signals ADD COLUMN IF NOT EXISTS action VARCHAR(50);
ALTER TABLE signals ADD COLUMN IF NOT EXISTS trade_id UUID;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS details JSONB;

-- ─── TRADE_FLAGS: JS uses guard_type/reason/order/context instead of flag_type/message/details ───
ALTER TABLE trade_flags ADD COLUMN IF NOT EXISTS guard_type VARCHAR(50);
ALTER TABLE trade_flags ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE trade_flags ADD COLUMN IF NOT EXISTS "order" JSONB;
ALTER TABLE trade_flags ADD COLUMN IF NOT EXISTS context JSONB;
ALTER TABLE trade_flags ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE trade_flags ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(255);
ALTER TABLE trade_flags ADD COLUMN IF NOT EXISTS resolution TEXT;
ALTER TABLE trade_flags ADD COLUMN IF NOT EXISTS resolution_action VARCHAR(100);

-- ─── POST_MORTEMS: missing exit_fear_greed, patterns_detected, pattern_count ───
ALTER TABLE post_mortems ADD COLUMN IF NOT EXISTS exit_fear_greed NUMERIC(10,2);
ALTER TABLE post_mortems ADD COLUMN IF NOT EXISTS patterns_detected JSONB;
ALTER TABLE post_mortems ADD COLUMN IF NOT EXISTS pattern_count INTEGER;

-- ─── QA_REPORTS: JS inserts individual fields, not just report_data JSONB ───
ALTER TABLE qa_reports ADD COLUMN IF NOT EXISTS source VARCHAR(50);
ALTER TABLE qa_reports ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE qa_reports ADD COLUMN IF NOT EXISTS issues JSONB;
ALTER TABLE qa_reports ADD COLUMN IF NOT EXISTS metrics JSONB;
ALTER TABLE qa_reports ADD COLUMN IF NOT EXISTS severity_counts JSONB;
ALTER TABLE qa_reports ADD COLUMN IF NOT EXISTS status VARCHAR(50);
ALTER TABLE qa_reports ADD COLUMN IF NOT EXISTS type VARCHAR(50);
ALTER TABLE qa_reports ADD COLUMN IF NOT EXISTS severity VARCHAR(50);
ALTER TABLE qa_reports ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ;
ALTER TABLE qa_reports ADD COLUMN IF NOT EXISTS "tickCount" INTEGER;
ALTER TABLE qa_reports ADD COLUMN IF NOT EXISTS "uptimeMinutes" NUMERIC(12,2);
ALTER TABLE qa_reports ADD COLUMN IF NOT EXISTS "systemState" JSONB;
ALTER TABLE qa_reports ADD COLUMN IF NOT EXISTS checks JSONB;
ALTER TABLE qa_reports ADD COLUMN IF NOT EXISTS "agentStats" JSONB;
ALTER TABLE qa_reports ADD COLUMN IF NOT EXISTS "perUserDebug" JSONB;
ALTER TABLE qa_reports ADD COLUMN IF NOT EXISTS "reportId" VARCHAR(100);

-- ─── WITHDRAWAL_REQUESTS: JS uses camelCase field names ───
ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS "userId" UUID;
ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS "userName" VARCHAR(255);
ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS "userEmail" VARCHAR(255);
ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS "walletEquityAtRequest" NUMERIC(18,4);
ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS "adminNotes" TEXT;
ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ;
ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ;
ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS "processedAt" TIMESTAMPTZ;
ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMPTZ;

-- ─── DISTRIBUTIONS: missing columns ───
ALTER TABLE distributions ADD COLUMN IF NOT EXISTS return_of_capital_portion NUMERIC(18,4);
ALTER TABLE distributions ADD COLUMN IF NOT EXISTS distribution_date TIMESTAMPTZ;

-- ═══════════════════════════════════════════════════════════════════════════
-- Done. All columns added with IF NOT EXISTS — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════
