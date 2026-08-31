-- =========================================================
-- ONCEClic Database Schema Migration 002
-- Customer Connections, Integrations & Email Verification
-- =========================================================

-- 1. Email Verifications Table (Cryptographic Single-Use Verification Tokens)
CREATE TABLE IF NOT EXISTS email_verifications (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_verifications_token ON email_verifications(token_hash);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id);

-- 2. Business Settings Extended Columns for Website Verification
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS website_last_active_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS website_verified_at TIMESTAMP WITH TIME ZONE;

-- 3. Email Connections Extended Columns for Provider Status
ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS connected_email VARCHAR(255);
ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS auth_state VARCHAR(255);
ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'NOT_CONNECTED';
