-- =========================================================
-- ONCEClic Database Schema Migration 009: Trial Redemptions
-- Permanent One-Trial-Per-Email Enforcement & Audit Tracking
-- =========================================================

CREATE TABLE IF NOT EXISTS trial_redemptions (
    id VARCHAR(64) PRIMARY KEY,
    normalized_email VARCHAR(255) UNIQUE NOT NULL,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    organization_id VARCHAR(64) REFERENCES organizations(id) ON DELETE SET NULL,
    trial_started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    trial_ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trial_redemptions_email ON trial_redemptions(normalized_email);
CREATE INDEX IF NOT EXISTS idx_trial_redemptions_user ON trial_redemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_trial_redemptions_org ON trial_redemptions(organization_id);
