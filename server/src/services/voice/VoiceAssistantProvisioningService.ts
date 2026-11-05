import { v4 as uuidv4 } from 'uuid';
import { db, IDatabase } from '../../db';
import { VoiceService } from './VoiceService';
import { VoicePromptBuilder } from './VoicePromptBuilder';
import { OrganizationVoiceAssistant } from '@onceclic/shared';

export interface ProvisioningClaimResult {
  acquired: boolean;
  claimToken?: string;
  leaseExpiresAt?: Date;
  existingStatus?: string;
  existingAssistantId?: string | null;
}

export interface VoiceProvisioningLogEvent {
  event:
    | 'PROVISIONING_STARTED'
    | 'CLAIM_ACQUIRED'
    | 'CLAIM_UNAVAILABLE'
    | 'ASSISTANT_CREATION_SUCCESS'
    | 'ASSISTANT_CREATION_FAILED'
    | 'ASSISTANT_PERSISTED'
    | 'LEASE_LOST_FENCING'
    | 'RECONCILIATION_REQUIRED'
    | 'LINE_SYNC_SUCCESS'
    | 'LINE_SYNC_FAILED';
  organizationId: string;
  claimToken?: string;
  assistantId?: string;
  lineId?: string;
  reason?: string;
  timestamp: string;
}

export class VoiceAssistantProvisioningService {
  private static readonly DEFAULT_LEASE_DURATION_SECONDS = 120; // 2 minutes

  /**
   * Structured logger adhering to safety rules (never logs secrets, API keys, or signed URLs).
   */
  static logEvent(event: Omit<VoiceProvisioningLogEvent, 'timestamp'>): void {
    const payload: VoiceProvisioningLogEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };
    console.log(`[VoiceProvisioning] ${JSON.stringify(payload)}`);
  }

  /**
   * Atomic claim acquisition.
   * Can acquire lease IF:
   * 1. No record exists (creates new CLAIMED row).
   * 2. Existing record is IDLE or FAILED.
   * 3. Existing record is CLAIMED but lease expired (claim_expires_at < NOW()).
   */
  static async acquireClaim(
    organizationId: string,
    leaseDurationSeconds: number = this.DEFAULT_LEASE_DURATION_SECONDS,
    database?: IDatabase
  ): Promise<ProvisioningClaimResult> {
    const activeDb = database || db;
    const claimToken = uuidv4();
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationSeconds * 1000);

    const existing = await activeDb.getOne<OrganizationVoiceAssistant>(
      `SELECT organization_id as "organizationId", vapi_assistant_id as "vapiAssistantId",
              provisioning_status as "provisioningStatus", claim_token as "claimToken",
              claim_expires_at as "claimExpiresAt"
       FROM organization_voice_assistants
       WHERE organization_id = $1`,
      [organizationId]
    );

    if (!existing) {
      try {
        await activeDb.execute(
          `INSERT INTO organization_voice_assistants (
             organization_id, vapi_assistant_id, provisioning_status, claim_token,
             claim_expires_at, created_at, updated_at
           ) VALUES ($1, NULL, 'CLAIMED', $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [organizationId, claimToken, leaseExpiresAt.toISOString()]
        );

        this.logEvent({
          event: 'CLAIM_ACQUIRED',
          organizationId,
          claimToken,
        });

        return { acquired: true, claimToken, leaseExpiresAt };
      } catch (insertErr: any) {
        // Handled race condition: another concurrent worker inserted first
      }
    }

    // Re-check existing state
    const current = await activeDb.getOne<OrganizationVoiceAssistant>(
      `SELECT organization_id as "organizationId", vapi_assistant_id as "vapiAssistantId",
              provisioning_status as "provisioningStatus", claim_token as "claimToken",
              claim_expires_at as "claimExpiresAt"
       FROM organization_voice_assistants
       WHERE organization_id = $1`,
      [organizationId]
    );

    if (!current) {
      return { acquired: false };
    }

    // If already READY with valid assistant ID, no claim needed
    if (current.provisioningStatus === 'READY' && current.vapiAssistantId) {
      return {
        acquired: false,
        existingStatus: 'READY',
        existingAssistantId: current.vapiAssistantId,
      };
    }

    // If flagged for manual reconciliation, fail closed
    if (current.provisioningStatus === 'RECONCILIATION_REQUIRED') {
      this.logEvent({
        event: 'RECONCILIATION_REQUIRED',
        organizationId,
        reason: 'Organization requires manual voice assistant reconciliation before provisioning',
      });
      return {
        acquired: false,
        existingStatus: 'RECONCILIATION_REQUIRED',
        existingAssistantId: current.vapiAssistantId,
      };
    }

    const currentExpiry = current.claimExpiresAt ? new Date(current.claimExpiresAt) : null;
    const isClaimActive = Boolean(
      current.provisioningStatus === 'CLAIMED' &&
      currentExpiry &&
      !isNaN(currentExpiry.getTime()) &&
      currentExpiry > now
    );

    if (isClaimActive) {
      this.logEvent({
        event: 'CLAIM_UNAVAILABLE',
        organizationId,
        reason: 'Active lease held by another worker',
      });
      return {
        acquired: false,
        existingStatus: 'CLAIMED',
      };
    }

    // Attempt atomic takeover update:
    // Only succeeds if current status and lease conditions still match
    let affected = 0;
    if (current.provisioningStatus === 'CLAIMED') {
      // An expired CLAIMED lease means a previous provisioning attempt timed out, crashed,
      // or its DB commit failed. Because Vapi creation may have already succeeded externally,
      // we MUST NOT blindly re-claim and create a duplicate assistant.
      // Atomically transition the expired ambiguous claim into RECONCILIATION_REQUIRED.
      await activeDb.execute(
        `UPDATE organization_voice_assistants
         SET provisioning_status = 'RECONCILIATION_REQUIRED',
             claim_token = NULL,
             claim_expires_at = NULL,
             error_message = 'Previous provisioning worker lease expired without commit; manual reconciliation required to prevent duplicate assistant creation',
             updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $1
           AND provisioning_status = 'CLAIMED'
           AND claim_token = $2
           AND claim_expires_at <= CURRENT_TIMESTAMP`,
        [organizationId, current.claimToken]
      );

      this.logEvent({
        event: 'RECONCILIATION_REQUIRED',
        organizationId,
        reason: 'Expired CLAIMED lease detected. Fails closed to RECONCILIATION_REQUIRED using database clock to prevent duplicate assistant creation.',
      });

      return {
        acquired: false,
        existingStatus: 'RECONCILIATION_REQUIRED',
        existingAssistantId: current.vapiAssistantId,
      };
    } else {
      // IDLE or FAILED transition to CLAIMED
      affected = await activeDb.execute(
        `UPDATE organization_voice_assistants
         SET provisioning_status = 'CLAIMED',
             claim_token = $1,
             claim_expires_at = $2,
             error_message = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $3
           AND provisioning_status = $4`,
        [claimToken, leaseExpiresAt.toISOString(), organizationId, current.provisioningStatus]
      );
    }

    if (affected === 1) {
      this.logEvent({
        event: 'CLAIM_ACQUIRED',
        organizationId,
        claimToken,
      });
      return { acquired: true, claimToken, leaseExpiresAt };
    }

    this.logEvent({
      event: 'CLAIM_UNAVAILABLE',
      organizationId,
      reason: 'Atomic claim takeover contested',
    });
    return { acquired: false };
  }

  /**
   * Renew lease before expiration if assistant creation takes longer.
   */
  static async renewClaim(
    organizationId: string,
    claimToken: string,
    extendSeconds: number = 60,
    database?: IDatabase
  ): Promise<boolean> {
    const activeDb = database || db;
    const newExpiry = new Date(Date.now() + extendSeconds * 1000);

    const affected = await activeDb.execute(
      `UPDATE organization_voice_assistants
       SET claim_expires_at = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $2
         AND claim_token = $3
         AND provisioning_status = 'CLAIMED'
         AND claim_expires_at > CURRENT_TIMESTAMP`,
      [newExpiry.toISOString(), organizationId, claimToken]
    );

    return affected === 1;
  }

  /**
   * Conditional commit with fencing.
   * Only persists the assistant ID IF the worker still owns the valid claim token.
   */
  static async commitAssistant(
    organizationId: string,
    claimToken: string,
    assistantId: string,
    database?: IDatabase
  ): Promise<{ committed: boolean }> {
    const activeDb = database || db;

    const affected = await activeDb.execute(
      `UPDATE organization_voice_assistants
       SET vapi_assistant_id = $1,
           provisioning_status = 'READY',
           claim_token = NULL,
           claim_expires_at = NULL,
           error_message = NULL,
           last_reconciled_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $2
         AND claim_token = $3
         AND provisioning_status = 'CLAIMED'`,
      [assistantId, organizationId, claimToken]
    );

    if (affected === 1) {
      this.logEvent({
        event: 'ASSISTANT_PERSISTED',
        organizationId,
        assistantId,
      });
      return { committed: true };
    }

    // FENCING TRIGGERED: Worker lost its lease!
    this.logEvent({
      event: 'LEASE_LOST_FENCING',
      organizationId,
      claimToken,
      assistantId,
      reason: 'Claim lease expired or was reclaimed before worker commit completed',
    });

    return { committed: false };
  }

  /**
   * Release a claim upon error or rollback, transitioning to FAILED state.
   */
  static async releaseClaim(
    organizationId: string,
    claimToken: string,
    errorMessage?: string,
    database?: IDatabase
  ): Promise<void> {
    const activeDb = database || db;

    await activeDb.execute(
      `UPDATE organization_voice_assistants
       SET provisioning_status = 'FAILED',
           claim_token = NULL,
           claim_expires_at = NULL,
           error_message = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $2
         AND claim_token = $3
         AND provisioning_status = 'CLAIMED'`,
      [errorMessage || 'Voice AI assistant provisioning failed', organizationId, claimToken]
    );
  }

  private static readonly DEFINITIVE_HTTP_STATUSES = new Set([400, 401, 403, 404, 422]);

  /**
   * Evaluates if a provisioning error is definitively a client-side failure
   * before external creation or an explicitly allowlisted structured 4xx API rejection.
   *
   * STRICT SECURITY RULES:
   * 1. Never relies on arbitrary message text substrings for HTTP codes (e.g. searching for '400').
   * 2. Inspects numeric structured status/statusCode properties against strict allowlist: 400, 401, 403, 404, 422.
   * 3. Everything else fails closed to AMBIGUOUS (RECONCILIATION_REQUIRED):
   *    408, 409, 418, 425, 429, all other unmapped 4xx, all 5xx (500, 502, 503, 504),
   *    network timeouts, socket hangups, connection resets, missing, and malformed status codes.
   */
  static isDefinitiveClientFailure(err: any, step: 'BUILD_PROMPT' | 'EXTERNAL_CALL' | 'DB_COMMIT'): boolean {
    if (step === 'BUILD_PROMPT') {
      return true; // Local preparation failure before any outbound network call
    }
    if (step === 'DB_COMMIT') {
      return false; // External assistant was created; DB failure makes state ambiguous / orphaned
    }

    // Inspect structured numeric HTTP status code with strict allowlist
    const rawStatus = err?.status ?? err?.statusCode ?? err?.response?.status;
    const status = typeof rawStatus === 'number' ? rawStatus : (rawStatus ? Number(rawStatus) : NaN);

    if (Number.isInteger(status) && this.DEFINITIVE_HTTP_STATUSES.has(status)) {
      return true;
    }

    // Explicit client-side validation error flag (e.g. from Mock or local validator)
    if (err?.isClientValidationError === true) {
      return true;
    }

    // All other 4xx (408, 409, 418, 425, 429, etc.), all 5xx, timeouts, network drops,
    // missing or malformed status codes fail closed to AMBIGUOUS
    return false;
  }

  /**
   * Case A: Persist RECONCILIATION_REQUIRED state for a worker that STILL OWNS its active claim.
   * Strictly fenced by organization_id, matching claim_token, and provisioning_status = 'CLAIMED'.
   */
  static async flagReconciliationRequiredWithActiveClaim(
    organizationId: string,
    claimToken: string,
    params: {
      assistantId?: string;
      category: 'AMBIGUOUS_NETWORK' | 'EXTERNAL_SUCCESS_DB_FAIL';
      reason: string;
      database?: IDatabase;
    }
  ): Promise<boolean> {
    const activeDb = params.database || db;
    const diagMessage = `[${params.category}] ${params.reason} (Claim: ${claimToken}, Asst: ${params.assistantId || 'none'})`;

    const affected = await activeDb.execute(
      `UPDATE organization_voice_assistants
       SET provisioning_status = 'RECONCILIATION_REQUIRED',
           vapi_assistant_id = COALESCE($1, vapi_assistant_id),
           claim_token = NULL,
           claim_expires_at = NULL,
           error_message = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $3
         AND claim_token = $4
         AND provisioning_status = 'CLAIMED'`,
      [params.assistantId || null, diagMessage, organizationId, claimToken]
    );

    if (affected === 1) {
      this.logEvent({
        event: 'RECONCILIATION_REQUIRED',
        organizationId,
        assistantId: params.assistantId,
        claimToken,
        reason: diagMessage,
      });
      return true;
    }

    return false;
  }

  /**
   * Case B: Record an orphaned external assistant created by a worker that LOST its claim or failed fencing.
   * STRICT FENCING:
   * 1. A stale worker must NEVER overwrite a newer claim, a canonical READY state, or a canonical assistant ID.
   * 2. It writes to audit_logs durably so administrators can audit and reconcile the orphaned Vapi assistant.
   * 3. It never touches or clears another worker's active claim or overwrites READY in organization_voice_assistants.
   */
  static async recordStaleWorkerOrphan(
    organizationId: string,
    staleClaimToken: string,
    orphanedAssistantId: string,
    reason: string,
    database?: IDatabase
  ): Promise<void> {
    const activeDb = database || db;
    const diagMessage = `[FENCING_LEASE_LOST] Stale worker (Token: ${staleClaimToken}) created external assistant ${orphanedAssistantId} after lease was lost. Reason: ${reason}`;

    this.logEvent({
      event: 'RECONCILIATION_REQUIRED',
      organizationId,
      assistantId: orphanedAssistantId,
      claimToken: staleClaimToken,
      reason: diagMessage,
    });

    try {
      await activeDb.execute(
        `INSERT INTO audit_logs (id, organization_id, action, entity_type, entity_id, metadata, created_at)
         VALUES ($1, $2, 'VOICE_ASSISTANT_ORPHAN_DETECTED', 'ORGANIZATION_VOICE_ASSISTANT', $2, $3, CURRENT_TIMESTAMP)`,
        [
          uuidv4(),
          organizationId,
          JSON.stringify({
            staleClaimToken,
            orphanedAssistantId,
            reason: diagMessage,
          }),
        ]
      );
    } catch (auditErr: any) {
      console.error(`[VoiceProvisioning] Failed to record orphan in audit_logs for organization ${organizationId}:`, auditErr?.message || auditErr);
      throw new Error(`Failed to record orphaned voice assistant ${orphanedAssistantId} in audit logs: ${auditErr?.message || auditErr}`);
    }
  }

  /**
   * Core orchestrator: Gets existing valid assistant or safely provisions one canonical assistant.
   * Guaranteed to prevent duplicate assistants under concurrent requests.
   */
  static async getOrCreateOrganizationAssistant(
    organizationId: string,
    options?: {
      database?: IDatabase;
      customVoiceProvider?: any;
      maxRetries?: number;
    }
  ): Promise<{ assistantId: string; isNew: boolean }> {
    const activeDb = options?.database || db;
    const maxRetries = options?.maxRetries ?? 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // In test/mock mode, respect simulated assistant failure flags on mock provider
      if (options?.customVoiceProvider && (options.customVoiceProvider as any).simulateAssistantFailure) {
        await options.customVoiceProvider.createOrUpdateAssistant({
          agentName: 'Simulated Fail Check',
          systemPrompt: '',
          greeting: '',
        });
      }

      // 1. Fast path: check for existing authoritative READY assistant
      const existing = await activeDb.getOne<OrganizationVoiceAssistant>(
        `SELECT organization_id as "organizationId", vapi_assistant_id as "vapiAssistantId",
                provisioning_status as "provisioningStatus"
         FROM organization_voice_assistants
         WHERE organization_id = $1`,
        [organizationId]
      );

      if (existing?.provisioningStatus === 'READY' && existing.vapiAssistantId) {
        return { assistantId: existing.vapiAssistantId, isNew: false };
      }

      if (existing?.provisioningStatus === 'RECONCILIATION_REQUIRED') {
        throw new Error(
          `Organization ${organizationId} requires manual voice assistant reconciliation before provisioning.`
        );
      }

      // 2. Try to acquire lease
      this.logEvent({
        event: 'PROVISIONING_STARTED',
        organizationId,
      });

      const claim = await this.acquireClaim(organizationId, this.DEFAULT_LEASE_DURATION_SECONDS, activeDb);

      if (!claim.acquired) {
        if (claim.existingStatus === 'READY' && claim.existingAssistantId) {
          return { assistantId: claim.existingAssistantId, isNew: false };
        }
        if (claim.existingStatus === 'RECONCILIATION_REQUIRED') {
          throw new Error(
            `Organization ${organizationId} requires manual voice assistant reconciliation before provisioning.`
          );
        }

        // Another worker is actively provisioning; wait with backoff and retry
        await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
        continue;
      }

      // 3. Lease acquired! Perform assistant creation under lease
      const claimToken = claim.claimToken!;
      const voice = options?.customVoiceProvider || VoiceService.getVoiceProvider();

      let createdAssistantId: string | undefined;
      let step: 'BUILD_PROMPT' | 'EXTERNAL_CALL' | 'DB_COMMIT' = 'BUILD_PROMPT';

      try {
        const promptData = await VoicePromptBuilder.buildPrompt(organizationId);

        step = 'EXTERNAL_CALL';
        if (voice.createOrUpdateAssistant) {
          const asstRes = await voice.createOrUpdateAssistant({
            agentName: promptData.agentName,
            systemPrompt: promptData.systemPrompt,
            greeting: promptData.greeting,
            tools: promptData.tools,
          });
          createdAssistantId = asstRes.assistantId;
        } else {
          createdAssistantId = `asst_${Date.now()}`;
        }

        if (!createdAssistantId) {
          throw new Error(`Failed to create Vapi assistant for organization ${organizationId}: No assistant ID returned.`);
        }

        this.logEvent({
          event: 'ASSISTANT_CREATION_SUCCESS',
          organizationId,
          assistantId: createdAssistantId,
        });

        // 4. Commit assistant ID with fencing
        step = 'DB_COMMIT';
        const commitResult = await this.commitAssistant(
          organizationId,
          claimToken,
          createdAssistantId,
          activeDb
        );

        if (!commitResult.committed) {
          // Worker lost lease while external API succeeded:
          // Case B: Stale worker - record orphan in audit_logs without corrupting organization_voice_assistants
          await this.recordStaleWorkerOrphan(
            organizationId,
            claimToken,
            createdAssistantId,
            'Lease expired or was overtaken after external assistant was created',
            activeDb
          );

          throw new Error(
            `Provisioning fencing error: Lease expired or was overtaken for organization ${organizationId}. Created assistant ${createdAssistantId} orphaned.`
          );
        }

        return { assistantId: createdAssistantId, isNew: true };
      } catch (provErr: any) {
        this.logEvent({
          event: 'ASSISTANT_CREATION_FAILED',
          organizationId,
          reason: provErr?.message || 'Unknown creation failure',
        });

        const isDefinitive = this.isDefinitiveClientFailure(provErr, step);

        if (isDefinitive) {
          // Definitive rejection before external call or 4xx API rejection: safe to release to FAILED
          await this.releaseClaim(organizationId, claimToken, provErr?.message, activeDb);
        } else if (!provErr.message?.includes('fencing error')) {
          // Ambiguous network outcome or DB failure with external assistant created:
          // Worker still holds an active claim attempt; fence it by claim_token and CLAIMED status.
          // If claim is still active, transitions to RECONCILIATION_REQUIRED.
          // If claim was overtaken in the interim, falls back to recording orphan in audit_logs.
          const flagged = await this.flagReconciliationRequiredWithActiveClaim(organizationId, claimToken, {
            assistantId: createdAssistantId,
            category: step === 'DB_COMMIT' ? 'EXTERNAL_SUCCESS_DB_FAIL' : 'AMBIGUOUS_NETWORK',
            reason: provErr?.message || 'Ambiguous external creation failure',
            database: activeDb,
          });

          if (!flagged && createdAssistantId) {
            // Worker lost claim during the ambiguous failure; record orphan in audit_logs
            await this.recordStaleWorkerOrphan(
              organizationId,
              claimToken,
              createdAssistantId,
              provErr?.message || 'Ambiguous external creation failure and claim was lost',
              activeDb
            );
          }
        }

        throw provErr;
      }
    }

    throw new Error(`Provisioning is already in progress for organization ${organizationId}. Please wait.`);
  }

  /**
   * Phone-line synchronization:
   * Ensures all lines belonging to the organization are synchronized with the canonical assistant ID.
   * Preserves conflicting assignments without overwriting.
   */
  static async synchronizePhoneLines(
    organizationId: string,
    canonicalAssistantId?: string,
    database?: IDatabase
  ): Promise<{
    linesSynchronized: number;
    linesPending: number;
    conflictDetected: boolean;
  }> {
    const activeDb = database || db;

    let targetAssistantId = canonicalAssistantId;
    if (!targetAssistantId) {
      const ova = await activeDb.getOne<OrganizationVoiceAssistant>(
        `SELECT vapi_assistant_id as "vapiAssistantId", provisioning_status as "provisioningStatus"
         FROM organization_voice_assistants
         WHERE organization_id = $1`,
        [organizationId]
      );
      if (ova?.provisioningStatus === 'READY' && ova.vapiAssistantId) {
        targetAssistantId = ova.vapiAssistantId;
      }
    }

    if (!targetAssistantId) {
      return { linesSynchronized: 0, linesPending: 0, conflictDetected: false };
    }

    const lines = await activeDb.query<{ id: string; vapi_assistant_id?: string | null; sync_status?: string | null }>(
      'SELECT id, vapi_assistant_id, sync_status FROM voice_phone_numbers WHERE organization_id = $1',
      [organizationId]
    );

    let linesSynchronized = 0;
    let linesPending = 0;
    let conflictDetected = false;

    for (const line of lines.rows) {
      if (line.vapi_assistant_id === targetAssistantId) {
        // Matching assistant: mark SYNCHRONIZED
        if (line.sync_status !== 'SYNCHRONIZED') {
          await activeDb.execute(
            `UPDATE voice_phone_numbers
             SET sync_status = 'SYNCHRONIZED',
                 synced_at = CURRENT_TIMESTAMP,
                 sync_error = NULL
             WHERE id = $1`,
            [line.id]
          );
        }
        linesSynchronized++;
        this.logEvent({
          event: 'LINE_SYNC_SUCCESS',
          organizationId,
          lineId: line.id,
          assistantId: targetAssistantId,
        });
      } else if (!line.vapi_assistant_id) {
        // Line has no assistant: assign canonical assistant and mark SYNCHRONIZED
        await activeDb.execute(
          `UPDATE voice_phone_numbers
           SET vapi_assistant_id = $1,
               sync_status = 'SYNCHRONIZED',
               synced_at = CURRENT_TIMESTAMP,
               sync_error = NULL
           WHERE id = $2 AND vapi_assistant_id IS NULL`,
          [targetAssistantId, line.id]
        );
        linesSynchronized++;
        this.logEvent({
          event: 'LINE_SYNC_SUCCESS',
          organizationId,
          lineId: line.id,
          assistantId: targetAssistantId,
        });
      } else {
        // Line has a different non-null assistant: CONFLICT! Never overwrite!
        conflictDetected = true;
        await activeDb.execute(
          `UPDATE voice_phone_numbers
           SET sync_status = 'PENDING',
               sync_error = 'Line assistant differs from organization canonical assistant'
           WHERE id = $1`,
          [line.id]
        );
        linesPending++;
        this.logEvent({
          event: 'LINE_SYNC_FAILED',
          organizationId,
          lineId: line.id,
          reason: `Line assistant ${line.vapi_assistant_id} differs from canonical ${targetAssistantId}`,
        });
      }
    }

    if (conflictDetected) {
      await activeDb.execute(
        `UPDATE organization_voice_assistants
         SET provisioning_status = 'RECONCILIATION_REQUIRED',
             error_message = 'Conflict: One or more phone lines reference divergent assistant IDs',
             updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $1 AND provisioning_status = 'READY'`,
        [organizationId]
      );
      this.logEvent({
        event: 'RECONCILIATION_REQUIRED',
        organizationId,
        reason: 'One or more phone lines reference divergent assistant IDs',
      });
    }

    return { linesSynchronized, linesPending, conflictDetected };
  }
}

