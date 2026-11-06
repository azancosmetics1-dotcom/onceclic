-- =========================================================================
-- Migration: 026_creem_phone_number_billing.sql
-- Description:
--   Adds independent recurring Creem billing columns and indexes for phone numbers:
--   1. Creem subscription, customer, and checkout tracking on voice_phone_numbers
--   2. Creem subscription, customer, and reservation tracking on voice_phone_number_checkouts
--   3. Composite indexes for atomic reservation checks and webhook resolution
--
-- SAFE RE-RUN: All statements use IF NOT EXISTS / IF EXISTS guards.
-- SAFE ROLLBACK:
--   ALTER TABLE voice_phone_numbers DROP COLUMN IF EXISTS creem_subscription_id;
--   ALTER TABLE voice_phone_numbers DROP COLUMN IF EXISTS creem_customer_id;
--   ALTER TABLE voice_phone_numbers DROP COLUMN IF EXISTS creem_checkout_id;
--   ALTER TABLE voice_phone_numbers DROP COLUMN IF EXISTS billing_interval;
--   ALTER TABLE voice_phone_number_checkouts DROP COLUMN IF EXISTS creem_checkout_id;
--   ALTER TABLE voice_phone_number_checkouts DROP COLUMN IF EXISTS creem_subscription_id;
--   ALTER TABLE voice_phone_number_checkouts DROP COLUMN IF EXISTS creem_customer_id;
--   ALTER TABLE voice_phone_number_checkouts DROP COLUMN IF EXISTS creem_product_id;
--   ALTER TABLE voice_phone_number_checkouts DROP COLUMN IF EXISTS reservation_id;
-- =========================================================================

-- 1. Add Creem columns to voice_phone_numbers
ALTER TABLE voice_phone_numbers
  ADD COLUMN IF NOT EXISTS creem_subscription_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS creem_customer_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS creem_checkout_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS billing_interval VARCHAR(20) DEFAULT 'monthly';

CREATE INDEX IF NOT EXISTS idx_voice_phone_creem_sub
  ON voice_phone_numbers (creem_subscription_id);

CREATE INDEX IF NOT EXISTS idx_voice_phone_creem_customer
  ON voice_phone_numbers (creem_customer_id);

-- 2. Add Creem and reservation columns to voice_phone_number_checkouts
ALTER TABLE voice_phone_number_checkouts
  ADD COLUMN IF NOT EXISTS creem_checkout_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS creem_subscription_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS creem_customer_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS creem_product_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS reservation_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_pnc_creem_checkout
  ON voice_phone_number_checkouts (creem_checkout_id);

CREATE INDEX IF NOT EXISTS idx_pnc_creem_sub
  ON voice_phone_number_checkouts (creem_subscription_id);

CREATE INDEX IF NOT EXISTS idx_pnc_reservation
  ON voice_phone_number_checkouts (reservation_id);

CREATE INDEX IF NOT EXISTS idx_pnc_org_status_expires
  ON voice_phone_number_checkouts (organization_id, status, expires_at);

