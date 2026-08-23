-- ============================================================================
-- Omix SACCO — 002_phase1_core.sql
-- Phase 1 core schema: member identity/lifecycle, savings confirmation
-- workflow columns, loan lifecycle + schedule, notifications, audit trail.
--
-- Apply:   psql "$DATABASE_URL" -f prisma/migrations/002_phase1_core.sql
-- Idempotent: safe to re-run (IF NOT EXISTS / guarded backfills throughout).
--
-- NOTE: after this lands, do NOT run `prisma db push` — it will attempt to
-- drop unknown objects. Schema changes go through sequential SQL files.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- users: member identity & lifecycle
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS member_no   VARCHAR(20) UNIQUE,          -- e.g. 'OMX-000123'
  ADD COLUMN IF NOT EXISTS status      VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                       CHECK (status IN ('ACTIVE','SUSPENDED','DORMANT')),
  ADD COLUMN IF NOT EXISTS created_by  UUID REFERENCES users(id);

-- Backfill member_no for existing rows. New signups get their number from an
-- app-layer sequence; re-running this only fills rows that are still NULL.
UPDATE users SET member_no = 'OMX-' || LPAD((ROW_NUMBER() OVER (ORDER BY created_at))::text, 6, '0')
WHERE member_no IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- ---------------------------------------------------------------------------
-- savings: staff-confirmation workflow support
--   MEMBER deposits/withdrawals are created PENDING and stamped by the
--   STAFF/ADMIN who confirms or rejects them.
-- ---------------------------------------------------------------------------
ALTER TABLE savings
  ADD COLUMN IF NOT EXISTS processed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_savings_status ON savings(status);
CREATE INDEX IF NOT EXISTS idx_savings_user_created ON savings(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- loans: lifecycle + computed terms
-- ---------------------------------------------------------------------------
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS loan_type           VARCHAR(30) NOT NULL DEFAULT 'NORMAL'
                               CHECK (loan_type IN ('NORMAL','EMERGENCY','DEVELOPMENT','EDUCATION')),
  ADD COLUMN IF NOT EXISTS total_interest      DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS total_payable       DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS monthly_installment DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS repaid_amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_by         UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_reason     TEXT,
  ADD COLUMN IF NOT EXISTS disbursed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS due_date            DATE;

-- ---------------------------------------------------------------------------
-- guarantors: partial guarantees
-- ---------------------------------------------------------------------------
ALTER TABLE guarantors
  ADD COLUMN IF NOT EXISTS guaranteed_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS responded_at      TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- loan_repayments: repayment schedule (one row per installment)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loan_repayments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id         UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  installment_no  INTEGER NOT NULL,
  due_date        DATE NOT NULL,
  expected_amount DECIMAL(12,2) NOT NULL,
  paid_amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
  status          VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','PARTIAL','PAID')),
  paid_at         TIMESTAMPTZ,
  UNIQUE (loan_id, installment_no)
);

CREATE INDEX IF NOT EXISTS idx_loan_repayments_loan ON loan_repayments(loan_id);

-- ---------------------------------------------------------------------------
-- notifications: in-app notification center (Phase 2 adds sms_channel fields)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel    VARCHAR(10) NOT NULL DEFAULT 'IN_APP' CHECK (channel IN ('IN_APP','SMS')),
  event_type VARCHAR(50) NOT NULL,           -- e.g. 'LOAN_APPROVED', 'GUARANTOR_REQUEST'
  title      VARCHAR(200) NOT NULL,
  body       TEXT NOT NULL,
  meta       JSONB NOT NULL DEFAULT '{}',
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);

-- ---------------------------------------------------------------------------
-- audit_logs: immutable audit trail
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   UUID REFERENCES users(id),
  action     VARCHAR(50) NOT NULL,            -- 'LOAN_APPROVE', 'WITHDRAWAL_CONFIRM', ...
  entity     VARCHAR(30) NOT NULL,            -- 'loan' | 'savings' | 'user' | ...
  entity_id  UUID,
  meta       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id, created_at DESC);

COMMIT;
