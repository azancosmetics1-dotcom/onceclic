-- =========================================================================
-- Migration: 028_phone_deprovisioning_retry.sql
-- Description:
--   Adds durable retry scheduling and tracking columns for phone number deprovisioning:
--   1. release_attempts: Integer counter for retry attempts
--   2. next_release_attempt_at: Timestamp for bounded exponential backoff
--   3. release_error: Last error message from telephony provider release failure
--
-- SAFE RE-RUN: Uses ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.
-- SAFE ROLLBACK:
--   ALTER TABLE voice_phone_numbers DROP COLUMN IF EXISTS release_attempts;
--   ALTER TABLE voice_phone_numbers DROP COLUMN IF EXISTS next_release_attempt_at;
--   ALTER TABLE voice_phone_numbers DROP COLUMN IF EXISTS release_error;
-- =========================================================================

ALTER TABLE voice_phone_numbers
  ADD COLUMN IF NOT EXISTS release_attempts INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_release_attempt_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS release_error TEXT;

CREATE INDEX IF NOT EXISTS idx_voice_phone_deprovision_queue
  ON voice_phone_numbers (release_status, next_release_attempt_at);

