-- =========================================================================
-- Migration: 022_voice_assistant_provisioning_and_recording_sync.sql
-- Description:
--   1. Creates organization_voice_assistants for canonical organization-level Vapi assistant tracking.
--   2. Extends voice_phone_numbers with dedicated synchronization status columns (sync_status, synced_at, sync_error).
--   3. Extends voice_call_records with robust multi-instance recording synchronization columns.
--   4. Performs an idempotent, conflict-safe backfill across all organizations, preserving existing phone line assignments.
-- =========================================================================

-- 1. Create Dedicated Organization Voice Assistant Table
CREATE TABLE IF NOT EXISTS organization_voice_assistants (
    organization_id VARCHAR(64) PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    vapi_assistant_id VARCHAR(255),
    provisioning_status VARCHAR(50) NOT NULL DEFAULT 'IDLE', -- IDLE, CLAIMED, READY, RECONCILIATION_REQUIRED, FAILED
    claim_token VARCHAR(128),
    claim_expires_at TIMESTAMP WITH TIME ZONE,
    last_reconciled_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_org_voice_assistants_status ON organization_voice_assistants(provisioning_status);
CREATE INDEX IF NOT EXISTS idx_org_voice_assistants_vapi_id ON organization_voice_assistants(vapi_assistant_id);

-- 2. Extend voice_phone_numbers with Synchronization Status
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS sync_status VARCHAR(50) DEFAULT 'PENDING'; -- PENDING, SYNCHRONIZED, FAILED
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE voice_phone_numbers ADD COLUMN IF NOT EXISTS sync_error TEXT;

CREATE INDEX IF NOT EXISTS idx_voice_phone_sync_status ON voice_phone_numbers(sync_status);

-- 3. Extend voice_call_records with Recording Synchronization Columns
ALTER TABLE voice_call_records ADD COLUMN IF NOT EXISTS recording_sync_status VARCHAR(50) DEFAULT 'PENDING'; -- PENDING, CLAIMED, COMPLETED, NOT_AVAILABLE, FAILED
ALTER TABLE voice_call_records ADD COLUMN IF NOT EXISTS recording_claim_token VARCHAR(128);
ALTER TABLE voice_call_records ADD COLUMN IF NOT EXISTS recording_lease_until TIMESTAMP WITH TIME ZONE;
ALTER TABLE voice_call_records ADD COLUMN IF NOT EXISTS recording_attempts INTEGER DEFAULT 0;
ALTER TABLE voice_call_records ADD COLUMN IF NOT EXISTS recording_next_retry_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE voice_call_records ADD COLUMN IF NOT EXISTS recording_last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_voice_calls_recording_sync 
ON voice_call_records(recording_sync_status, recording_next_retry_at, recording_lease_until) 
WHERE recording_url IS NULL;

-- 4. Safe, Idempotent Multi-Tenant Backfill
DO $$
DECLARE
    org_rec RECORD;
    existing_org_asst VARCHAR(255);
    existing_org_status VARCHAR(50);
    existing_claim_expires TIMESTAMP WITH TIME ZONE;
    total_lines_count INTEGER;
    distinct_asst_count INTEGER;
    canonical_asst_id VARCHAR(255);
    asst_list TEXT;
    ova_exists BOOLEAN;
BEGIN
    FOR org_rec IN (
        SELECT id, name FROM organizations ORDER BY id
    ) LOOP
        -- Check if an organization_voice_assistants row already exists
        SELECT vapi_assistant_id, provisioning_status, claim_expires_at
        INTO existing_org_asst, existing_org_status, existing_claim_expires
        FROM organization_voice_assistants
        WHERE organization_id = org_rec.id;

        ova_exists := FOUND;

        -- Analyze phone lines for this organization
        SELECT 
            COUNT(id),
            COUNT(DISTINCT vapi_assistant_id),
            MIN(vapi_assistant_id),
            STRING_AGG(DISTINCT vapi_assistant_id, ', ')
        INTO 
            total_lines_count,
            distinct_asst_count, 
            canonical_asst_id,
            asst_list
        FROM voice_phone_numbers
        WHERE organization_id = org_rec.id;

        -- Case 1: Active Claim in progress (claim_expires_at > CURRENT_TIMESTAMP)
        IF ova_exists AND existing_org_status = 'CLAIMED' AND existing_claim_expires > CURRENT_TIMESTAMP THEN
            -- In-flight worker owns the claim lease; do not disturb
            UPDATE voice_phone_numbers
            SET sync_status = 'PENDING'
            WHERE organization_id = org_rec.id
              AND (sync_status IS NULL OR sync_status = 'PENDING');
            CONTINUE;

        -- Case 2: Already flagged for reconciliation
        ELSIF ova_exists AND existing_org_status = 'RECONCILIATION_REQUIRED' THEN
            -- Preserve flag and existing assignments
            UPDATE voice_phone_numbers
            SET sync_status = 'PENDING'
            WHERE organization_id = org_rec.id
              AND (sync_status IS NULL OR sync_status = 'PENDING');
            CONTINUE;

        -- Case 2.5: Already initialized IDLE with zero line assistants
        ELSIF ova_exists AND existing_org_status = 'IDLE' AND distinct_asst_count = 0 THEN
            -- Preserve IDLE status
            UPDATE voice_phone_numbers
            SET sync_status = 'PENDING'
            WHERE organization_id = org_rec.id
              AND (sync_status IS NULL OR sync_status != 'PENDING');
            CONTINUE;

        -- Case 3: Valid pre-existing READY assistant (non-null assistant ID)
        ELSIF ova_exists AND existing_org_status = 'READY' AND existing_org_asst IS NOT NULL THEN
            IF distinct_asst_count > 1 OR (distinct_asst_count = 1 AND canonical_asst_id != existing_org_asst) THEN
                -- Mismatch: NEVER overwrite existing READY assistant ID! Transition status to RECONCILIATION_REQUIRED
                UPDATE organization_voice_assistants
                SET provisioning_status = 'RECONCILIATION_REQUIRED',
                    error_message = 'Conflict: Pre-existing READY assistant ' || existing_org_asst || ' differs from line assignments: ' || asst_list,
                    updated_at = CURRENT_TIMESTAMP
                WHERE organization_id = org_rec.id;

                -- Lines retain individual assignments; mark PENDING
                UPDATE voice_phone_numbers
                SET sync_status = 'PENDING',
                    sync_error = 'Line assistant differs from organization canonical assistant'
                WHERE organization_id = org_rec.id;
            ELSE
                -- Consistent (or zero lines / all lines NULL):
                -- Mark matching lines SYNCHRONIZED, NULL lines PENDING
                UPDATE voice_phone_numbers
                SET sync_status = 'SYNCHRONIZED',
                    synced_at = CURRENT_TIMESTAMP,
                    sync_error = NULL
                WHERE organization_id = org_rec.id
                  AND vapi_assistant_id = existing_org_asst;

                UPDATE voice_phone_numbers
                SET sync_status = 'PENDING'
                WHERE organization_id = org_rec.id
                  AND (vapi_assistant_id IS NULL OR vapi_assistant_id != existing_org_asst);
            END IF;

        -- Case 4: Eligible for backfill (covers: No row, IDLE, FAILED, expired CLAIMED, and READY with NULL ID)
        ELSE
            IF distinct_asst_count = 1 THEN
                -- Subcase 4A: Exactly one consistent non-null line assistant ID across lines
                IF ova_exists THEN
                    UPDATE organization_voice_assistants
                    SET vapi_assistant_id = canonical_asst_id,
                        provisioning_status = 'READY',
                        claim_token = NULL,
                        claim_expires_at = NULL,
                        error_message = NULL,
                        last_reconciled_at = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE organization_id = org_rec.id;
                ELSE
                    INSERT INTO organization_voice_assistants (
                        organization_id, vapi_assistant_id, provisioning_status, last_reconciled_at, updated_at
                    ) VALUES (
                        org_rec.id, canonical_asst_id, 'READY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                    );
                END IF;

                -- Lines with matching assistant become SYNCHRONIZED
                UPDATE voice_phone_numbers
                SET sync_status = 'SYNCHRONIZED',
                    synced_at = CURRENT_TIMESTAMP,
                    sync_error = NULL
                WHERE organization_id = org_rec.id
                  AND vapi_assistant_id = canonical_asst_id;

                -- Lines with NULL assistant remain PENDING
                UPDATE voice_phone_numbers
                SET sync_status = 'PENDING'
                WHERE organization_id = org_rec.id
                  AND vapi_assistant_id IS NULL;

            ELSIF distinct_asst_count > 1 THEN
                -- Subcase 4B: Divergent line assistant IDs across lines
                IF ova_exists THEN
                    UPDATE organization_voice_assistants
                    SET vapi_assistant_id = NULL,
                        provisioning_status = 'RECONCILIATION_REQUIRED',
                        claim_token = NULL,
                        claim_expires_at = NULL,
                        error_message = 'Divergent assistant IDs across lines: ' || asst_list,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE organization_id = org_rec.id;
                ELSE
                    INSERT INTO organization_voice_assistants (
                        organization_id, vapi_assistant_id, provisioning_status, error_message, updated_at
                    ) VALUES (
                        org_rec.id, NULL, 'RECONCILIATION_REQUIRED', 
                        'Divergent assistant IDs across lines: ' || asst_list, CURRENT_TIMESTAMP
                    );
                END IF;

                -- Preserve all line assignments untouched; mark PENDING
                UPDATE voice_phone_numbers
                SET sync_status = 'PENDING',
                    sync_error = 'Divergent line assistants; manual reconciliation required'
                WHERE organization_id = org_rec.id;

            ELSE
                -- Subcase 4C: Zero lines or all lines have NULL assistant ID
                IF ova_exists THEN
                    UPDATE organization_voice_assistants
                    SET vapi_assistant_id = NULL,
                        provisioning_status = 'IDLE',
                        claim_token = NULL,
                        claim_expires_at = NULL,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE organization_id = org_rec.id;
                ELSE
                    INSERT INTO organization_voice_assistants (
                        organization_id, vapi_assistant_id, provisioning_status, updated_at
                    ) VALUES (
                        org_rec.id, NULL, 'IDLE', CURRENT_TIMESTAMP
                    );
                END IF;

                IF total_lines_count > 0 THEN
                    UPDATE voice_phone_numbers
                    SET sync_status = 'PENDING'
                    WHERE organization_id = org_rec.id;
                END IF;
            END IF;
        END IF;
    END LOOP;
END $$;
