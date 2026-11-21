-- =========================================================================
-- Migration: 032_vapi_knowledge_and_file_sync.sql
-- Description:
--   1. Extends organization_voice_assistants with Vapi knowledge file IDs,
--      query tool ID, and knowledge synchronization tracking columns.
--   2. Extends knowledge_sources with Vapi file ID, sync status, and file metadata.
--   3. Completely idempotent, non-destructive, preserving all existing records.
-- =========================================================================

-- 1. Extend organization_voice_assistants
ALTER TABLE organization_voice_assistants ADD COLUMN IF NOT EXISTS vapi_file_ids TEXT DEFAULT '[]';
ALTER TABLE organization_voice_assistants ADD COLUMN IF NOT EXISTS vapi_knowledge_tool_id VARCHAR(255);
ALTER TABLE organization_voice_assistants ADD COLUMN IF NOT EXISTS knowledge_sync_status VARCHAR(50) NOT NULL DEFAULT 'IDLE';
ALTER TABLE organization_voice_assistants ADD COLUMN IF NOT EXISTS knowledge_synced_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE organization_voice_assistants ADD COLUMN IF NOT EXISTS knowledge_sync_error TEXT;

CREATE INDEX IF NOT EXISTS idx_org_voice_assistants_knowledge_sync ON organization_voice_assistants(knowledge_sync_status);

-- 2. Extend knowledge_sources
ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS vapi_file_id VARCHAR(255);
ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS vapi_sync_status VARCHAR(50) DEFAULT 'PENDING';
ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS vapi_synced_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS file_type VARCHAR(50);
ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS file_size INTEGER;

CREATE INDEX IF NOT EXISTS idx_knowledge_sources_vapi_file ON knowledge_sources(vapi_file_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_vapi_sync ON knowledge_sources(vapi_sync_status);
