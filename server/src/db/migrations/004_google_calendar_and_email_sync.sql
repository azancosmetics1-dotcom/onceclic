-- =========================================================
-- ONCEClic Database Schema Migration 004
-- Google Calendar Integration & Sync Support
-- =========================================================

-- 1. Calendar Connections Table (OAuth Tokens & Integration State)
CREATE TABLE IF NOT EXISTS calendar_connections (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) UNIQUE NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL DEFAULT 'GOOGLE_CALENDAR',
    calendar_id VARCHAR(255),
    calendar_summary VARCHAR(255),
    access_token TEXT,
    refresh_token TEXT,
    token_expiry TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    last_synced_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_calendar_conn_org ON calendar_connections(organization_id);

-- 2. Extended Columns on Appointments Table for Google Calendar Sync
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS google_calendar_event_id VARCHAR(255);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS calendar_sync_status VARCHAR(50) DEFAULT 'NOT_SYNCED';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS calendar_sync_error TEXT;

CREATE INDEX IF NOT EXISTS idx_appointments_gcal_event ON appointments(google_calendar_event_id);
