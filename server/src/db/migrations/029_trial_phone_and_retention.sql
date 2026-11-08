-- =========================================================================
-- Migration: 029_trial_phone_and_retention.sql
-- Description:
--   Supports 14-day temporary phone number rentals for trial users and 30-day retention:
--   1. is_trial_number: Boolean indicating one-time 14-day trial rental
--   2. rental_started_at & rental_ends_at: Exact 14-day rental duration timestamps
--   3. retention_ends_at & is_retained: 30-day grace/retention period timestamps
--   4. renewed_to_subscription_id: Links renewed monthly Creem subscription
--   5. retention_warning_sent_at: Tracking for renewal reminder notifications
--   6. checkout_type & target_phone_number_id on voice_phone_number_checkouts
--
-- SAFE RE-RUN: Uses ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.
-- SAFE ROLLBACK:
--   ALTER TABLE voice_phone_numbers DROP COLUMN IF EXISTS is_trial_number;
--   ALTER TABLE voice_phone_numbers DROP COLUMN IF EXISTS rental_started_at;
--   ALTER TABLE voice_phone_numbers DROP COLUMN IF EXISTS rental_ends_at;
--   ALTER TABLE voice_phone_numbers DROP COLUMN IF EXISTS retention_ends_at;
--   ALTER TABLE voice_phone_numbers DROP COLUMN IF EXISTS is_retained;
--   ALTER TABLE voice_phone_numbers DROP COLUMN IF EXISTS renewed_to_subscription_id;
--   ALTER TABLE voice_phone_numbers DROP COLUMN IF EXISTS retention_warning_sent_at;
--   ALTER TABLE voice_phone_number_checkouts DROP COLUMN IF EXISTS checkout_type;
--   ALTER TABLE voice_phone_number_checkouts DROP COLUMN IF EXISTS target_phone_number_id;
-- =========================================================================

-- 1. Add trial and retention columns to voice_phone_numbers
ALTER TABLE voice_phone_numbers
  ADD COLUMN IF NOT EXISTS is_trial_number BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS rental_started_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS rental_ends_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS retention_ends_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS is_retained BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS renewed_to_subscription_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS retention_warning_sent_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_voice_phone_rental_expiry
  ON voice_phone_numbers (is_trial_number, rental_ends_at);

CREATE INDEX IF NOT EXISTS idx_voice_phone_retention_expiry
  ON voice_phone_numbers (is_retained, retention_ends_at);

-- 2. Add checkout_type and target_phone_number_id to voice_phone_number_checkouts
ALTER TABLE voice_phone_number_checkouts
  ADD COLUMN IF NOT EXISTS checkout_type VARCHAR(50) DEFAULT 'RECURRING',
  ADD COLUMN IF NOT EXISTS target_phone_number_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_pnc_checkout_type
  ON voice_phone_number_checkouts (checkout_type);

