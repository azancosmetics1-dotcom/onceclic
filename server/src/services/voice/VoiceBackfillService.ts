import { IDatabase, db as defaultDb } from '../../db';

export type BackfillProposedAction =
  | 'NO_OP_ACTIVE_CLAIM'
  | 'NO_OP_ALREADY_FLAGGED'
  | 'NO_OP_ALREADY_CONSISTENT'
  | 'NO_OP_ALREADY_IDLE'
  | 'NO_OP_PREEXISTING_READY'
  | 'FLAG_RECONCILIATION_REQUIRED_PREEXISTING_READY_MISMATCH'
  | 'BACKFILL_TO_READY'
  | 'FLAG_RECONCILIATION_REQUIRED_DIVERGENT'
  | 'INITIALIZE_IDLE';

export interface BackfillDryRunItem {
  organizationId: string;
  organizationName: string;
  currentOrgAssistantId: string | null;
  currentOrgStatus: string | null;
  totalLines: number;
  linesWithAssistant: number;
  distinctLineAssistants: number;
  lineAssistantIds: string[];
  proposedAction: BackfillProposedAction;
}

export interface BackfillDryRunSummary {
  totalProcessed: number;
  noOpActiveClaim: number;
  noOpAlreadyFlagged: number;
  noOpAlreadyConsistent: number;
  noOpAlreadyIdle: number;
  noOpPreexistingReady: number;
  flagReconciliationRequiredMismatch: number;
  flagReconciliationRequiredDivergent: number;
  backfillToReady: number;
  initializeIdle: number;
}

export interface BackfillDryRunReport {
  items: BackfillDryRunItem[];
  summary: BackfillDryRunSummary;
}

export interface BackfillExecutionMetrics {
  totalOrganizations: number;
  backfilledToReady: number;
  flaggedReconciliationRequired: number;
  initializedIdle: number;
  noOpUnchanged: number;
  linesSynchronized: number;
  linesPending: number;
  preservedLinesCount: number;
}

export class VoiceBackfillService {
  /**
   * Pre-migration dry-run: evaluates all organizations without writing any database records.
   */
  static async dryRun(database?: IDatabase): Promise<BackfillDryRunReport> {
    const activeDb = database || defaultDb;
    const now = new Date();

    const orgs = await activeDb.query<{ id: string; name: string }>(
      'SELECT id, name FROM organizations ORDER BY id'
    );

    const items: BackfillDryRunItem[] = [];
    const summary: BackfillDryRunSummary = {
      totalProcessed: orgs.rows.length,
      noOpActiveClaim: 0,
      noOpAlreadyFlagged: 0,
      noOpAlreadyConsistent: 0,
      noOpAlreadyIdle: 0,
      noOpPreexistingReady: 0,
      flagReconciliationRequiredMismatch: 0,
      flagReconciliationRequiredDivergent: 0,
      backfillToReady: 0,
      initializeIdle: 0,
    };

    for (const org of orgs.rows) {
      const ova = await activeDb.getOne<{
        vapi_assistant_id?: string | null;
        provisioning_status?: string | null;
        claim_expires_at?: string | Date | null;
      }>(
        'SELECT vapi_assistant_id, provisioning_status, claim_expires_at FROM organization_voice_assistants WHERE organization_id = $1',
        [org.id]
      );

      const lines = await activeDb.query<{ id: string; vapi_assistant_id?: string | null; sync_status?: string | null }>(
        'SELECT id, vapi_assistant_id, sync_status FROM voice_phone_numbers WHERE organization_id = $1 ORDER BY id',
        [org.id]
      );

      const totalLines = lines.rows.length;
      const nonNullLines = lines.rows.filter(l => Boolean(l.vapi_assistant_id));
      const distinctAssistantIds = Array.from(
        new Set(nonNullLines.map(l => String(l.vapi_assistant_id).trim()))
      ).filter(Boolean);

      let action: BackfillProposedAction;

      const ovaExists = Boolean(ova);
      const existingStatus = ova?.provisioning_status || null;
      const existingAsst = ova?.vapi_assistant_id || null;
      const claimExpires = ova?.claim_expires_at ? new Date(ova.claim_expires_at) : null;
      const isClaimActive = Boolean(
        claimExpires && !isNaN(claimExpires.getTime()) && claimExpires > now
      );

      // 1. Active claim in progress: Do not disturb
      if (ovaExists && existingStatus === 'CLAIMED' && isClaimActive) {
        action = 'NO_OP_ACTIVE_CLAIM';
        summary.noOpActiveClaim++;
      }
      // 2. Already flagged for reconciliation: Preserve
      else if (ovaExists && existingStatus === 'RECONCILIATION_REQUIRED') {
        action = 'NO_OP_ALREADY_FLAGGED';
        summary.noOpAlreadyFlagged++;
      }
      // 3. Valid pre-existing READY assistant: Protect against overwrite
      else if (ovaExists && existingStatus === 'READY' && existingAsst) {
        if (distinctAssistantIds.length === 1 && distinctAssistantIds[0] === existingAsst) {
          action = 'NO_OP_ALREADY_CONSISTENT';
          summary.noOpAlreadyConsistent++;
        } else if (nonNullLines.length === 0) {
          action = 'NO_OP_PREEXISTING_READY';
          summary.noOpPreexistingReady++;
        } else {
          action = 'FLAG_RECONCILIATION_REQUIRED_PREEXISTING_READY_MISMATCH';
          summary.flagReconciliationRequiredMismatch++;
        }
      }
      // 3.5. Already initialized IDLE with zero line assistants: Preserve
      else if (ovaExists && existingStatus === 'IDLE' && distinctAssistantIds.length === 0) {
        action = 'NO_OP_ALREADY_IDLE';
        summary.noOpAlreadyIdle++;
      }
      // 4. Eligible for backfill: Single consistent line assistant
      else if (distinctAssistantIds.length === 1) {
        action = 'BACKFILL_TO_READY';
        summary.backfillToReady++;
      }
      // 5. Eligible for backfill: Divergent line assistants
      else if (distinctAssistantIds.length > 1) {
        action = 'FLAG_RECONCILIATION_REQUIRED_DIVERGENT';
        summary.flagReconciliationRequiredDivergent++;
      }
      // 6. Eligible for backfill: Zero lines or all lines NULL
      else {
        action = 'INITIALIZE_IDLE';
        summary.initializeIdle++;
      }

      items.push({
        organizationId: org.id,
        organizationName: org.name || 'Unnamed Organization',
        currentOrgAssistantId: existingAsst,
        currentOrgStatus: existingStatus,
        totalLines,
        linesWithAssistant: nonNullLines.length,
        distinctLineAssistants: distinctAssistantIds.length,
        lineAssistantIds: distinctAssistantIds,
        proposedAction: action,
      });
    }

    return { items, summary };
  }

  /**
   * Safe, idempotent backfill execution.
   * Can be executed repeatedly with zero unwanted modifications or duplicate records.
   */
  static async executeBackfill(database?: IDatabase): Promise<BackfillExecutionMetrics> {
    const activeDb = database || defaultDb;
    const now = new Date();

    const metrics: BackfillExecutionMetrics = {
      totalOrganizations: 0,
      backfilledToReady: 0,
      flaggedReconciliationRequired: 0,
      initializedIdle: 0,
      noOpUnchanged: 0,
      linesSynchronized: 0,
      linesPending: 0,
      preservedLinesCount: 0,
    };

    const orgs = await activeDb.query<{ id: string; name: string }>(
      'SELECT id, name FROM organizations ORDER BY id'
    );
    metrics.totalOrganizations = orgs.rows.length;

    for (const org of orgs.rows) {
      const ova = await activeDb.getOne<{
        vapi_assistant_id?: string | null;
        provisioning_status?: string | null;
        claim_expires_at?: string | Date | null;
      }>(
        'SELECT vapi_assistant_id, provisioning_status, claim_expires_at FROM organization_voice_assistants WHERE organization_id = $1',
        [org.id]
      );

      const lines = await activeDb.query<{ id: string; vapi_assistant_id?: string | null; sync_status?: string | null }>(
        'SELECT id, vapi_assistant_id, sync_status FROM voice_phone_numbers WHERE organization_id = $1 ORDER BY id',
        [org.id]
      );

      metrics.preservedLinesCount += lines.rows.length;
      const nonNullLines = lines.rows.filter(l => Boolean(l.vapi_assistant_id));
      const distinctAssistantIds = Array.from(
        new Set(nonNullLines.map(l => String(l.vapi_assistant_id).trim()))
      ).filter(Boolean);

      const ovaExists = Boolean(ova);
      const existingStatus = ova?.provisioning_status || null;
      const existingAsst = ova?.vapi_assistant_id || null;
      const claimExpires = ova?.claim_expires_at ? new Date(ova.claim_expires_at) : null;
      const isClaimActive = Boolean(
        claimExpires && !isNaN(claimExpires.getTime()) && claimExpires > now
      );

      // 1. Active claim in progress: Do not disturb
      if (ovaExists && existingStatus === 'CLAIMED' && isClaimActive) {
        metrics.noOpUnchanged++;
        for (const line of lines.rows) {
          if (line.sync_status !== 'PENDING') {
            await activeDb.execute(
              `UPDATE voice_phone_numbers 
               SET sync_status = 'PENDING'
               WHERE id = $1`,
              [line.id]
            );
          }
          metrics.linesPending++;
        }
        continue;
      }

      // 2. Already flagged for reconciliation: Preserve
      if (ovaExists && existingStatus === 'RECONCILIATION_REQUIRED') {
        metrics.noOpUnchanged++;
        for (const line of lines.rows) {
          if (line.sync_status !== 'PENDING') {
            await activeDb.execute(
              `UPDATE voice_phone_numbers 
               SET sync_status = 'PENDING'
               WHERE id = $1`,
              [line.id]
            );
          }
          metrics.linesPending++;
        }
        continue;
      }

      // 3. Valid pre-existing READY assistant (non-null assistant ID)
      if (ovaExists && existingStatus === 'READY' && existingAsst) {
        if (distinctAssistantIds.length > 1 || (distinctAssistantIds.length === 1 && distinctAssistantIds[0] !== existingAsst)) {
          // Mismatch: NEVER overwrite existing READY assistant ID!
          await activeDb.execute(
            `UPDATE organization_voice_assistants
             SET provisioning_status = 'RECONCILIATION_REQUIRED',
                 error_message = $1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = $2`,
            [
              `Conflict: Pre-existing READY assistant ${existingAsst} differs from line assignments: ${distinctAssistantIds.join(', ')}`,
              org.id,
            ]
          );
          metrics.flaggedReconciliationRequired++;

          // Lines retain individual assignments; mark PENDING
          for (const line of lines.rows) {
            await activeDb.execute(
              `UPDATE voice_phone_numbers
               SET sync_status = 'PENDING',
                   sync_error = 'Line assistant differs from organization canonical assistant'
               WHERE id = $1`,
              [line.id]
            );
            metrics.linesPending++;
          }
        } else {
          // Consistent: Mark matching lines SYNCHRONIZED, NULL lines PENDING
          metrics.noOpUnchanged++;
          for (const line of lines.rows) {
            if (line.vapi_assistant_id === existingAsst) {
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
              metrics.linesSynchronized++;
            } else {
              if (line.sync_status !== 'PENDING') {
                await activeDb.execute(
                  `UPDATE voice_phone_numbers
                   SET sync_status = 'PENDING'
                   WHERE id = $1`,
                  [line.id]
                );
              }
              metrics.linesPending++;
            }
          }
        }
        continue;
      }

      // 3.5. Already initialized IDLE with zero line assistants: Preserve (No-Op)
      if (ovaExists && existingStatus === 'IDLE' && distinctAssistantIds.length === 0) {
        metrics.noOpUnchanged++;
        for (const line of lines.rows) {
          if (line.sync_status !== 'PENDING') {
            await activeDb.execute(
              `UPDATE voice_phone_numbers
               SET sync_status = 'PENDING'
               WHERE id = $1`,
              [line.id]
            );
          }
          metrics.linesPending++;
        }
        continue;
      }

      // 4. Eligible for backfill (covers: No row, IDLE, FAILED, expired CLAIMED, and READY with NULL ID)
      if (distinctAssistantIds.length === 1) {
        const canonicalId = distinctAssistantIds[0];
        if (ovaExists) {
          await activeDb.execute(
            `UPDATE organization_voice_assistants
             SET vapi_assistant_id = $1,
                 provisioning_status = 'READY',
                 claim_token = NULL,
                 claim_expires_at = NULL,
                 error_message = NULL,
                 last_reconciled_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = $2`,
            [canonicalId, org.id]
          );
        } else {
          await activeDb.execute(
            `INSERT INTO organization_voice_assistants (
               organization_id, vapi_assistant_id, provisioning_status, last_reconciled_at, created_at, updated_at
             ) VALUES ($1, $2, 'READY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [org.id, canonicalId]
          );
        }
        metrics.backfilledToReady++;

        for (const line of lines.rows) {
          if (line.vapi_assistant_id === canonicalId) {
            await activeDb.execute(
              `UPDATE voice_phone_numbers
               SET sync_status = 'SYNCHRONIZED',
                   synced_at = CURRENT_TIMESTAMP,
                   sync_error = NULL
               WHERE id = $1`,
              [line.id]
            );
            metrics.linesSynchronized++;
          } else {
            await activeDb.execute(
              `UPDATE voice_phone_numbers
               SET sync_status = 'PENDING'
               WHERE id = $1`,
              [line.id]
            );
            metrics.linesPending++;
          }
        }
      } else if (distinctAssistantIds.length > 1) {
        const asstList = distinctAssistantIds.join(', ');
        const errMsg = `Divergent assistant IDs across lines: ${asstList}`;
        if (ovaExists) {
          await activeDb.execute(
            `UPDATE organization_voice_assistants
             SET vapi_assistant_id = NULL,
                 provisioning_status = 'RECONCILIATION_REQUIRED',
                 claim_token = NULL,
                 claim_expires_at = NULL,
                 error_message = $1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = $2`,
            [errMsg, org.id]
          );
        } else {
          await activeDb.execute(
            `INSERT INTO organization_voice_assistants (
               organization_id, vapi_assistant_id, provisioning_status, error_message, created_at, updated_at
             ) VALUES ($1, NULL, 'RECONCILIATION_REQUIRED', $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [org.id, errMsg]
          );
        }
        metrics.flaggedReconciliationRequired++;

        for (const line of lines.rows) {
          await activeDb.execute(
            `UPDATE voice_phone_numbers
             SET sync_status = 'PENDING',
                 sync_error = 'Divergent line assistants; manual reconciliation required'
             WHERE id = $1`,
            [line.id]
          );
          metrics.linesPending++;
        }
      } else {
        // Zero lines or all lines have NULL assistant ID
        if (ovaExists) {
          await activeDb.execute(
            `UPDATE organization_voice_assistants
             SET vapi_assistant_id = NULL,
                 provisioning_status = 'IDLE',
                 claim_token = NULL,
                 claim_expires_at = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = $1`,
            [org.id]
          );
        } else {
          await activeDb.execute(
            `INSERT INTO organization_voice_assistants (
               organization_id, vapi_assistant_id, provisioning_status, created_at, updated_at
             ) VALUES ($1, NULL, 'IDLE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [org.id]
          );
        }
        metrics.initializedIdle++;

        for (const line of lines.rows) {
          await activeDb.execute(
            `UPDATE voice_phone_numbers
             SET sync_status = 'PENDING'
             WHERE id = $1`,
            [line.id]
          );
          metrics.linesPending++;
        }
      }
    }

    return metrics;
  }
}
