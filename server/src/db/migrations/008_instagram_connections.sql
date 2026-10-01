-- =========================================================
-- ONCEClic Database Schema Migration 008
-- Instagram Channel Integration via Composio
-- =========================================================

-- 1. Instagram Connections Table (Composio Managed Connection State)
CREATE TABLE IF NOT EXISTS instagram_connections (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) UNIQUE NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    instagram_user_id VARCHAR(255),
    username VARCHAR(255),
    account_type VARCHAR(50) DEFAULT 'BUSINESS',
    is_active BOOLEAN DEFAULT TRUE,
    status VARCHAR(50) DEFAULT 'CONNECTED',
    error_message TEXT,
    last_synced_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_instagram_conn_org ON instagram_connections(organization_id);
CREATE INDEX IF NOT EXISTS idx_instagram_conn_user ON instagram_connections(instagram_user_id);
