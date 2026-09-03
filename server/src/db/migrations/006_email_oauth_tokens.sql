-- =========================================================
-- ONCEClic Database Schema Migration 006
-- Email OAuth & Mailbox Connection Support
-- =========================================================

ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS access_token TEXT;
ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS refresh_token TEXT;
ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS token_expiry TIMESTAMP WITH TIME ZONE;
ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS error_message TEXT;
