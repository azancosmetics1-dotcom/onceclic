-- =========================================================================
-- Migration: 030_phone_deprovisioning_lease.sql
-- Description:
--   Adds durable multi-instance lease coordination columns to voice_phone_numbers:
--   1. release_worker_id: Unique identifier / token of the worker process claiming the lease
--   2. release_locked_until: Timestamp until which the release claim lease is exclusively held
--
-- Rollback:
--   ALTER TABLE voice_phone_numbers DROP COLUMN IF EXISTS release_worker_id;
--   ALTER TABLE voice_phone_numbers DROP COLUMN IF EXISTS release_locked_until;
-- =========================================================================

ALTER TABLE voice_phone_numbers
  ADD COLUMN IF NOT EXISTS release_worker_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS release_locked_until TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_voice_phone_release_lease
  ON voice_phone_numbers (release_status, release_locked_until);

