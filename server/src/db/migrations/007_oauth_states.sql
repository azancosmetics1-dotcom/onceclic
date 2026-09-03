-- =========================================================
-- ONCEClic Database Schema Migration 007
-- OAuth State Security, One-Time Consumption & Replay Defense
-- =========================================================

CREATE TABLE IF NOT EXISTS oauth_states (
    id VARCHAR(64) PRIMARY KEY,
    state_hash VARCHAR(255) UNIQUE NOT NULL,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL DEFAULT 'GOOGLE_EMAIL',
    return_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    consumed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_hash ON oauth_states(state_hash);
CREATE INDEX IF NOT EXISTS idx_oauth_states_org ON oauth_states(organization_id);
CREATE INDEX IF NOT EXISTS idx_oauth_states_user ON oauth_states(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);
