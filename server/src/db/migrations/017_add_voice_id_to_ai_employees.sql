-- =========================================================
-- ONCEClic Database Schema Migration 017
-- Add optional voice_id column to ai_employees for voice synthesis
-- =========================================================

ALTER TABLE ai_employees ADD COLUMN IF NOT EXISTS voice_id VARCHAR(100) DEFAULT 'sarah';
