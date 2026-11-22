-- =========================================================
-- ONCEClic Database Schema Migration 033
-- Voice Sessions Lifecycle & Durable Cross-Process Reconciliation
-- =========================================================

CREATE TABLE IF NOT EXISTS voice_sessions (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    call_id VARCHAR(255) NOT NULL,
    session_ticket_hash VARCHAR(64) NOT NULL,
    max_duration_seconds INTEGER NOT NULL DEFAULT 180,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    reconciliation_lock_until TIMESTAMP WITH TIME ZONE,
    reconciliation_worker_id VARCHAR(255),
    finalization_reason VARCHAR(100),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_voice_sessions_call_id UNIQUE (call_id)
);

CREATE INDEX IF NOT EXISTS idx_voice_sessions_org ON voice_sessions(organization_id);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_status ON voice_sessions(status);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_started ON voice_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_lock ON voice_sessions(reconciliation_lock_until);
