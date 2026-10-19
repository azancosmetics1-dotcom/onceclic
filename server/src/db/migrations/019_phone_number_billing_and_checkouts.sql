-- =========================================================
-- ONCEClic Database Schema Migration 019
-- Phone Number Billing, Checkouts & Separate Recurring Rental
-- =========================================================

-- 1. Add Phone Number Billing Columns to voice_phone_numbers
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS provider_cost_usd NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS markup_usd NUMERIC(10, 2) DEFAULT 1.00;
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS customer_monthly_cost_usd NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS paddle_subscription_id VARCHAR(100);
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS paddle_transaction_id VARCHAR(100);
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS paddle_price_id VARCHAR(100);
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS billing_status VARCHAR(50) DEFAULT 'ACTIVE';
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS billing_currency VARCHAR(10) DEFAULT 'USD';
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS pricing_policy_version VARCHAR(50) DEFAULT '2026-10-v1';
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT FALSE;
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS refund_status VARCHAR(50) DEFAULT 'NONE';
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS refund_amount_usd NUMERIC(10, 2);
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_voice_phone_paddle_sub ON voice_phone_numbers(paddle_subscription_id);
CREATE INDEX IF NOT EXISTS idx_voice_phone_billing_status ON voice_phone_numbers(billing_status);

-- 2. Phone Number Checkout Sessions (Customer payment authorization before Telnyx purchase)
CREATE TABLE IF NOT EXISTS voice_phone_number_checkouts (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    phone_number VARCHAR(50) NOT NULL,
    country_code VARCHAR(10) NOT NULL DEFAULT 'US',
    number_type VARCHAR(50) NOT NULL DEFAULT 'local',
    provider_cost_usd NUMERIC(10, 2) NOT NULL,
    markup_usd NUMERIC(10, 2) NOT NULL DEFAULT 1.00,
    customer_monthly_cost_usd NUMERIC(10, 2) NOT NULL,
    setup_cost_usd NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    pricing_policy_version VARCHAR(50) NOT NULL DEFAULT '2026-10-v1',
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- PENDING, AUTHORIZED, PAID, COMPLETED, CANCELLED, FAILED
    paddle_transaction_id VARCHAR(100),
    paddle_subscription_id VARCHAR(100),
    idempotency_key VARCHAR(128),
    failure_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pnc_org ON voice_phone_number_checkouts(organization_id);
CREATE INDEX IF NOT EXISTS idx_pnc_phone ON voice_phone_number_checkouts(phone_number);
CREATE INDEX IF NOT EXISTS idx_pnc_status ON voice_phone_number_checkouts(status);
CREATE INDEX IF NOT EXISTS idx_pnc_paddle_sub ON voice_phone_number_checkouts(paddle_subscription_id);
