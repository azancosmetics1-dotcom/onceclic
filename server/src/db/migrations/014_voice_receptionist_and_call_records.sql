-- =========================================================
-- ONCEClic Database Schema Migration 014
-- AI Phone Receptionist Phone Numbers & Call Records
-- =========================================================

-- 1. Voice Phone Numbers Table
CREATE TABLE IF NOT EXISTS voice_phone_numbers (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL DEFAULT 'RETELL',
    phone_number VARCHAR(50) NOT NULL,
    phone_number_type VARCHAR(50) NOT NULL DEFAULT 'EXISTING',
    connection_method VARCHAR(50) NOT NULL DEFAULT 'EXISTING_FORWARDING',
    provider_phone_number_id VARCHAR(255),
    forwarding_target VARCHAR(50),
    sip_endpoint VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_voice_phone_number UNIQUE (phone_number)
);

CREATE INDEX IF NOT EXISTS idx_voice_phone_org ON voice_phone_numbers(organization_id);
CREATE INDEX IF NOT EXISTS idx_voice_phone_number ON voice_phone_numbers(phone_number);
CREATE INDEX IF NOT EXISTS idx_voice_phone_status ON voice_phone_numbers(status);

-- 2. Voice Call Records Table (Product-level minute tracking)
CREATE TABLE IF NOT EXISTS voice_call_records (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL DEFAULT 'RETELL',
    provider_call_id VARCHAR(255) NOT NULL,
    phone_number_id VARCHAR(64) REFERENCES voice_phone_numbers(id) ON DELETE SET NULL,
    caller_phone VARCHAR(50),
    direction VARCHAR(20) NOT NULL DEFAULT 'INBOUND',
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    duration_minutes NUMERIC(10, 2) NOT NULL DEFAULT 0.0,
    status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED',
    outcome VARCHAR(50) DEFAULT 'GENERAL_INQUIRY',
    booked_appointment_id VARCHAR(64) REFERENCES appointments(id) ON DELETE SET NULL,
    conversation_id VARCHAR(64) REFERENCES conversations(id) ON DELETE SET NULL,
    transcript TEXT,
    recording_url TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_voice_provider_call_id UNIQUE (provider_call_id)
);

CREATE INDEX IF NOT EXISTS idx_voice_calls_org ON voice_call_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_voice_calls_started ON voice_call_records(started_at);
CREATE INDEX IF NOT EXISTS idx_voice_calls_status ON voice_call_records(status);
CREATE INDEX IF NOT EXISTS idx_voice_calls_outcome ON voice_call_records(outcome);
CREATE INDEX IF NOT EXISTS idx_voice_calls_booked_appt ON voice_call_records(booked_appointment_id);

-- 3. Business Settings Voice Extension
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS voice_receptionist_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS voice_silence_timeout_seconds INTEGER DEFAULT 10;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS voice_max_duration_seconds INTEGER DEFAULT 600;
