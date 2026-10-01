-- =========================================================
-- ONCEClic Database Schema Migration 012
-- Trial Notifications & Reminder Idempotency Tracking
-- =========================================================

CREATE TABLE IF NOT EXISTS trial_notifications (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id VARCHAR(64) REFERENCES subscriptions(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL,
    idempotency_key VARCHAR(128) UNIQUE NOT NULL,
    recipient_email VARCHAR(255) NOT NULL,
    dispatched_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trial_notifications_idemp ON trial_notifications(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_trial_notifications_org ON trial_notifications(organization_id);
CREATE INDEX IF NOT EXISTS idx_trial_notifications_type ON trial_notifications(notification_type);
