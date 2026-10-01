-- =========================================================
-- ONCEClic Database Schema Migration 010
-- Facebook Page Channel Integration via Composio
-- =========================================================

-- 1. Facebook Connections Table (Composio Managed Connection State)
CREATE TABLE IF NOT EXISTS facebook_connections (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) UNIQUE NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    page_id VARCHAR(255),
    page_name VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    status VARCHAR(50) DEFAULT 'CONNECTED',
    error_message TEXT,
    last_synced_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_facebook_conn_org ON facebook_connections(organization_id);
CREATE INDEX IF NOT EXISTS idx_facebook_conn_page ON facebook_connections(page_id);
