-- =========================================================
-- ONCEClic Database Schema Migration 013
-- Composio Inbound Trigger Instances & Webhook Tracking
-- =========================================================

-- 1. Composio Trigger Instances Table
CREATE TABLE IF NOT EXISTS composio_trigger_instances (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    app VARCHAR(50) NOT NULL,
    trigger_slug VARCHAR(100) NOT NULL,
    trigger_id VARCHAR(255) NOT NULL,
    connected_account_id VARCHAR(255),
    status VARCHAR(50) DEFAULT 'ACTIVE',
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_composio_trigger_account UNIQUE (connected_account_id, trigger_slug)
);

CREATE INDEX IF NOT EXISTS idx_composio_triggers_org ON composio_trigger_instances(organization_id);
CREATE INDEX IF NOT EXISTS idx_composio_triggers_account ON composio_trigger_instances(connected_account_id);
CREATE INDEX IF NOT EXISTS idx_composio_triggers_tid ON composio_trigger_instances(trigger_id);

-- 2. Extended Columns for Channel Connection Tables
ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS composio_connected_account_id VARCHAR(255);
ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS trigger_id VARCHAR(255);
ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS automation_status VARCHAR(50) DEFAULT 'NOT_CONFIGURED';

ALTER TABLE instagram_connections ADD COLUMN IF NOT EXISTS composio_connected_account_id VARCHAR(255);
ALTER TABLE instagram_connections ADD COLUMN IF NOT EXISTS trigger_id VARCHAR(255);
ALTER TABLE instagram_connections ADD COLUMN IF NOT EXISTS automation_status VARCHAR(50) DEFAULT 'NOT_CONFIGURED';

ALTER TABLE facebook_connections ADD COLUMN IF NOT EXISTS composio_connected_account_id VARCHAR(255);
ALTER TABLE facebook_connections ADD COLUMN IF NOT EXISTS trigger_id VARCHAR(255);
ALTER TABLE facebook_connections ADD COLUMN IF NOT EXISTS automation_status VARCHAR(50) DEFAULT 'NOT_CONFIGURED';

CREATE INDEX IF NOT EXISTS idx_email_conn_composio_acc ON email_connections(composio_connected_account_id);
CREATE INDEX IF NOT EXISTS idx_instagram_conn_composio_acc ON instagram_connections(composio_connected_account_id);
CREATE INDEX IF NOT EXISTS idx_facebook_conn_composio_acc ON facebook_connections(composio_connected_account_id);
