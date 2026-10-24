-- =========================================================
-- ONCEClic Database Schema Migration 021
-- Creem Billing Integration & Subscriptions
-- =========================================================

-- 1. Add Creem columns to subscriptions table while preserving historical Paddle columns
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS creem_customer_id VARCHAR(100);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS creem_subscription_id VARCHAR(100);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS creem_checkout_id VARCHAR(100);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS creem_product_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_subscriptions_creem_sub ON subscriptions(creem_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_creem_cust ON subscriptions(creem_customer_id);

-- 2. Add Creem support to voice phone numbers and phone checkouts
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS creem_subscription_id VARCHAR(100);
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS creem_product_id VARCHAR(100);
ALTER TABLE voice_phone_number_checkouts ADD COLUMN IF NOT EXISTS creem_checkout_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_voice_phone_creem_sub ON voice_phone_numbers(creem_subscription_id);
