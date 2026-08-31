-- =========================================================
-- ONCEClic Database Schema Migration 001: Initial Schema
-- Production PostgreSQL & Multi-tenant Schema
-- =========================================================

-- Enable UUID extension if in PostgreSQL
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    is_email_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 2. Organizations Table
CREATE TABLE IF NOT EXISTS organizations (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    business_type VARCHAR(100) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(255),
    website VARCHAR(255),
    address TEXT,
    timezone VARCHAR(100) DEFAULT 'UTC',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);

-- 3. Organization Memberships Table (Multi-tenant User-Org Link with RBAC)
CREATE TABLE IF NOT EXISTS organization_memberships (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'EMPLOYEE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_org_user UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_org ON organization_memberships(organization_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON organization_memberships(user_id);

-- 4. Subscriptions Table (Paddle Billing v2)
CREATE TABLE IF NOT EXISTS subscriptions (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) UNIQUE NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    paddle_customer_id VARCHAR(100),
    paddle_subscription_id VARCHAR(100) UNIQUE,
    paddle_transaction_id VARCHAR(100),
    price_id VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'TRIALING',
    trial_started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    trial_ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
    current_period_start TIMESTAMP WITH TIME ZONE,
    current_period_end TIMESTAMP WITH TIME ZONE,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_org ON subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_paddle_sub ON subscriptions(paddle_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- 5. AI Employees Table (Receptionist Configuration)
CREATE TABLE IF NOT EXISTS ai_employees (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    role_title VARCHAR(255) NOT NULL,
    description TEXT,
    personality TEXT,
    tone VARCHAR(100) DEFAULT 'friendly, professional, concise',
    instructions TEXT NOT NULL,
    business_context TEXT,
    greeting_message TEXT NOT NULL,
    fallback_message TEXT NOT NULL,
    operating_hours TEXT,
    appointment_rules TEXT,
    handoff_rules TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_employees_org ON ai_employees(organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_employees_status ON ai_employees(status);

-- 6. Business Settings Table
CREATE TABLE IF NOT EXISTS business_settings (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) UNIQUE NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    business_hours TEXT NOT NULL, -- JSON array of DayBusinessHours
    services TEXT NOT NULL,       -- JSON array of ServiceItem
    cancellation_policy TEXT,
    contact_instructions TEXT,
    website_chat_enabled BOOLEAN DEFAULT TRUE,
    email_answering_enabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_business_settings_org ON business_settings(organization_id);

-- 7. Knowledge Sources Table
CREATE TABLE IF NOT EXISTS knowledge_sources (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    source_type VARCHAR(50) NOT NULL DEFAULT 'FAQ',
    title VARCHAR(255) NOT NULL,
    raw_content TEXT NOT NULL,
    chunk_count INT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'PROCESSED',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_knowledge_sources_org ON knowledge_sources(organization_id);

-- 8. Knowledge Chunks Table (RAG Embeddings & Text Segments)
CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    source_id VARCHAR(64) NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
    chunk_content TEXT NOT NULL,
    chunk_index INT NOT NULL,
    embedding TEXT, -- JSON float array representation of vector embeddings
    metadata TEXT,  -- JSON metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_org ON knowledge_chunks(organization_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source ON knowledge_chunks(source_id);

-- 9. Availability Rules Table (Weekly Appointment Slots)
CREATE TABLE IF NOT EXISTS availability_rules (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    day_of_week INT NOT NULL, -- 0=Sun, 1=Mon, ..., 6=Sat
    start_time VARCHAR(10) NOT NULL, -- '09:00'
    end_time VARCHAR(10) NOT NULL,   -- '17:00'
    slot_duration_minutes INT DEFAULT 30,
    buffer_minutes INT DEFAULT 10,
    is_available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_avail_rules_org ON availability_rules(organization_id);

-- 10. Appointments Table
CREATE TABLE IF NOT EXISTS appointments (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    service_id VARCHAR(64),
    service_name VARCHAR(255) NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    customer_email VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(50),
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'CONFIRMED',
    notes TEXT,
    conversation_id VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_appointments_org ON appointments(organization_id);
CREATE INDEX IF NOT EXISTS idx_appointments_times ON appointments(organization_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_appointments_customer ON appointments(customer_email);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

-- 11. Conversations Table
CREATE TABLE IF NOT EXISTS conversations (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    ai_employee_id VARCHAR(64) REFERENCES ai_employees(id) ON DELETE SET NULL,
    channel VARCHAR(50) NOT NULL DEFAULT 'WEB',
    customer_name VARCHAR(255),
    customer_email VARCHAR(255),
    customer_phone VARCHAR(50),
    status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE,
    archived_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_conversations_org ON conversations(organization_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel);

-- 12. Conversation Messages Table
CREATE TABLE IF NOT EXISTS conversation_messages (
    id VARCHAR(64) PRIMARY KEY,
    conversation_id VARCHAR(64) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL, -- 'CUSTOMER', 'AI', 'HUMAN_AGENT', 'SYSTEM'
    content TEXT NOT NULL,
    client_message_id VARCHAR(100),
    status VARCHAR(50) DEFAULT 'SENT',
    grounded BOOLEAN DEFAULT TRUE,
    handoff_required BOOLEAN DEFAULT FALSE,
    source_references TEXT, -- JSON array of references
    ai_employee_id VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_org ON conversation_messages(organization_id);
CREATE INDEX IF NOT EXISTS idx_messages_client_id ON conversation_messages(conversation_id, client_message_id);

-- 13. Email Connections Table
CREATE TABLE IF NOT EXISTS email_connections (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) UNIQUE NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider_type VARCHAR(50) NOT NULL DEFAULT 'WEBHOOK',
    inbound_address VARCHAR(255) NOT NULL,
    smtp_host VARCHAR(255),
    smtp_port INT,
    smtp_user VARCHAR(255),
    smtp_pass VARCHAR(255),
    imap_host VARCHAR(255),
    imap_port INT,
    imap_user VARCHAR(255),
    imap_pass VARCHAR(255),
    webhook_token VARCHAR(100) UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT FALSE,
    last_synced_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_conn_org ON email_connections(organization_id);
CREATE INDEX IF NOT EXISTS idx_email_conn_token ON email_connections(webhook_token);

-- 14. Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id VARCHAR(64),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(64),
    metadata TEXT, -- JSON
    ip_address VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- 15. AI Usage Records Table
CREATE TABLE IF NOT EXISTS ai_usage_records (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    ai_employee_id VARCHAR(64),
    conversation_id VARCHAR(64),
    provider VARCHAR(50) NOT NULL,
    model VARCHAR(100) NOT NULL,
    prompt_tokens INT DEFAULT 0,
    completion_tokens INT DEFAULT 0,
    total_tokens INT DEFAULT 0,
    estimated_cost_usd NUMERIC(10, 6) DEFAULT 0.000000,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_org ON ai_usage_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_records(created_at);

-- 16. Sessions Table (User Authentication Sessions)
CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    user_agent TEXT,
    ip_address VARCHAR(100),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- 17. Password Resets Table
CREATE TABLE IF NOT EXISTS password_resets (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token_hash);

