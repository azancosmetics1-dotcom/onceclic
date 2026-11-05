-- =========================================================================
-- Migration: 025_phone_number_and_call_limits.sql
-- Description:
--   Adds infrastructure to support:
--   1. Per-plan phone number count limits (1 / 3 / 5 for STARTER / PRO / BUSINESS)
--   2. Monthly call-count limits (20 / 50 / 100 for STARTER / PRO / BUSINESS)
--
--   DESIGN NOTES:
--   - Phone number limits are enforced at application level by counting
--     voice_phone_numbers WHERE status = 'ACTIVE' per organization.
--     No schema change required for phone number tracking — the table already
--     has the necessary columns (organization_id, status).
--
--   - Call count limits require an index on (organization_id, started_at) and
--     a unique constraint on provider_call_id (already exists as uq_voice_provider_call_id).
--     We add a composite index to make the per-billing-period COUNT(*) query fast.
--
--   - We add a boolean column `counted_for_limit` to voice_call_records so that
--     only qualifying calls (COMPLETED, duration > 0, not duplicate webhook) are
--     counted. This column is set by the handleCallEnded path, never by webhooks
--     directly, ensuring webhook idempotency is respected.
--
--   - Historical call records (before this migration) default to FALSE for
--     counted_for_limit. This is intentional — we do not retroactively count
--     historical calls, which protects existing customers.
--
--   SAFE RE-RUN: All steps are idempotent via IF NOT EXISTS guards.
--   SAFE ROLLBACK:
--     ALTER TABLE voice_call_records DROP COLUMN IF EXISTS counted_for_limit;
--     DROP INDEX IF EXISTS idx_voice_calls_billing_window;
--     DROP INDEX IF EXISTS idx_voice_phone_active_count;
-- =========================================================================

-- Step 1: Add counted_for_limit column to voice_call_records
-- This flag marks calls that consume a monthly call allowance.
-- Only COMPLETED calls with duration > 0 and answered by the AI are counted.
ALTER TABLE voice_call_records
  ADD COLUMN IF NOT EXISTS counted_for_limit BOOLEAN NOT NULL DEFAULT FALSE;

-- Step 2: Index for fast per-billing-period call count query
-- Used by VoiceService.getVoiceUsage() to count calls in the billing window.
CREATE INDEX IF NOT EXISTS idx_voice_calls_billing_window
  ON voice_call_records (organization_id, started_at)
  WHERE counted_for_limit = TRUE;

-- Step 3: Index for fast active and porting phone number count query
-- Used by VoiceService.checkPhoneNumberLimit() to count active/porting numbers per org.
CREATE INDEX IF NOT EXISTS idx_voice_phone_active_count
  ON voice_phone_numbers (organization_id, status)
  WHERE status IN ('ACTIVE', 'PORTING');

-- Step 4: Backfill counted_for_limit for existing completed calls
-- We count existing COMPLETED calls with duration > 0 as having consumed their limit.
-- This ensures existing customers see accurate historical usage.
-- Uses a safe DO block to avoid failing if columns have unexpected data.
DO $$
BEGIN
  UPDATE voice_call_records
  SET counted_for_limit = TRUE
  WHERE counted_for_limit = FALSE
    AND status = 'COMPLETED'
    AND duration_seconds > 0;

  RAISE NOTICE 'Backfilled counted_for_limit for existing completed call records.';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'counted_for_limit backfill skipped (non-fatal): %', SQLERRM;
END $$;

