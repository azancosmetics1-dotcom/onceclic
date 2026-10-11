-- =========================================================
-- ONCEClic Database Schema Migration 016
-- Global AI Phone Receptionist Provisioning, Vapi & Telnyx
-- =========================================================

-- Add global provisioning and telephony columns to voice_phone_numbers
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS country_code VARCHAR(10) DEFAULT 'US';
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS provisioning_status VARCHAR(50) DEFAULT 'ACTIVE';
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS monthly_cost_usd NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS setup_cost_usd NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS regulatory_status VARCHAR(50) DEFAULT 'NOT_REQUIRED';
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS required_documents JSONB DEFAULT '[]'::jsonb;
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS action_required_reason TEXT;
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS vapi_assistant_id VARCHAR(255);
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS vapi_phone_number_id VARCHAR(255);
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS telnyx_phone_number_id VARCHAR(255);
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS verification_code VARCHAR(20);
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS verification_status VARCHAR(50) DEFAULT 'UNVERIFIED';
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS verification_attempts INTEGER DEFAULT 0;
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMP WITH TIME ZONE;

-- Indexes for efficient querying and database-enforced idempotency
CREATE INDEX IF NOT EXISTS idx_voice_phone_prov_status ON voice_phone_numbers(provisioning_status);
CREATE INDEX IF NOT EXISTS idx_voice_phone_country ON voice_phone_numbers(country_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_phone_org_idempotency ON voice_phone_numbers(organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
