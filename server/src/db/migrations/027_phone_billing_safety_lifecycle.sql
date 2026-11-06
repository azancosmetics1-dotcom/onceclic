-- =========================================================================
-- Migration: 027_phone_billing_safety_lifecycle.sql
-- Description:
--   Independent phone number billing safety & lifecycle management:
--   1. release_status & released_at for Telnyx / Vapi deprovisioning lifecycle
--   2. cancellation_status & cancellation_error for retryable cancellations
--   3. refund_id & refund_status tracking on voice_phone_number_checkouts
--
-- SAFE RE-RUN: All statements use IF NOT EXISTS / IF EXISTS guards.
-- SAFE ROLLBACK:
--   ALTER TABLE voice_phone_numbers DROP COLUMN IF EXISTS release_status;
--   ALTER TABLE voice_phone_numbers DROP COLUMN IF EXISTS released_at;
--   ALTER TABLE voice_phone_numbers DROP COLUMN IF EXISTS cancellation_status;
--   ALTER TABLE voice_phone_numbers DROP COLUMN IF EXISTS cancellation_error;
--   ALTER TABLE voice_phone_number_checkouts DROP COLUMN IF EXISTS release_status;
--   ALTER TABLE voice_phone_number_checkouts DROP COLUMN IF EXISTS cancellation_status;
--   ALTER TABLE voice_phone_number_checkouts DROP COLUMN IF EXISTS refund_id;
-- =========================================================================

-- 1. Add release lifecycle columns to voice_phone_numbers
ALTER TABLE voice_phone_numbers
  ADD COLUMN IF NOT EXISTS release_status VARCHAR(64) DEFAULT 'NOT_RELEASED',
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS cancellation_status VARCHAR(64) DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS cancellation_error TEXT;

CREATE INDEX IF NOT EXISTS idx_voice_phone_release_status
  ON voice_phone_numbers (release_status);

-- 2. Add refund and cancellation tracking columns to voice_phone_number_checkouts
ALTER TABLE voice_phone_number_checkouts
  ADD COLUMN IF NOT EXISTS cancellation_status VARCHAR(64) DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS refund_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS refund_status VARCHAR(64);

