-- =========================================================
-- ONCEClic Database Schema Migration 005
-- Paddle Webhook Idempotency & Event Deduplication
-- =========================================================

CREATE TABLE IF NOT EXISTS processed_webhook_events (
    event_id VARCHAR(100) PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_processed_webhooks_type ON processed_webhook_events(event_type);
