-- =========================================================
-- ONCEClic Database Schema Migration 003
-- Google OAuth & Social Identity Support
-- =========================================================

-- 1. Add google_id and avatar_url columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 2. Allow password_hash to be nullable for OAuth users
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- 3. Index for fast Google ID lookups
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
