import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db';
import { VoiceService } from './VoiceService';

export interface ReconciledSessionSummary {
  reconciledCount: number;
  callIds: string[];
  skippedCount: number;
}

export class VoiceSessionReconciliationWorker {
  // Lease duration for cross-process atomic DB claim: 30 seconds
  static readonly LEASE_DURATION_MS = 30 * 1000;
  // Default grace period after maxDurationSeconds before a session is considered abandoned: 10s
  static readonly DEFAULT_GRACE_PERIOD_SECONDS = 10;

  private static timer: NodeJS.Timeout | null = null;
  private static isRunning = false;

  /**
   * Start periodic background reconciliation worker (e.g. on server startup).
   */
  static start(intervalMs: number = 30000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.reconcileStaleSessions().catch((err) => {
        console.error('[VoiceSessionReconciliationWorker] Error during periodic pass:', err);
      });
    }, intervalMs);
    // Allow process to exit cleanly if worker is the only active timer
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  /**
   * Stop periodic background reconciliation worker.
   */
  static stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Durable cross-process reconciliation pass.
   * Discovers unfinished/abandoned voice sessions directly from PostgreSQL `voice_sessions`.
   * Completely independent of in-memory VoiceService.activeCalls, surviving backend restarts.
   */
  static async reconcileStaleSessions(params?: {
    forceCallId?: string;
    organizationId?: string;
    maxAgeSeconds?: number;
    workerId?: string;
  }): Promise<ReconciledSessionSummary> {
    const workerId = params?.workerId || `worker_${process.pid}_${uuidv4().substring(0, 8)}`;
    const nowMs = Date.now();
    const reconciledCallIds: string[] = [];
    let skippedCount = 0;

    // 1. Discover unfinished sessions from persistent database storage
    // Finds sessions in ACTIVE or FINALIZING (with expired lock)
    let candidateSessions: Array<{
      id: string;
      call_id: string;
      organization_id: string;
      max_duration_seconds: number;
      started_at: string;
      status: string;
      metadata: any;
    }> = [];

    try {
      let queryRes: { rows: any[] };
      if (params?.forceCallId) {
        queryRes = await db.query(
          `SELECT id, call_id, organization_id, max_duration_seconds, started_at, status, metadata
           FROM voice_sessions
           WHERE call_id = $1
             AND status IN ('ACTIVE', 'FINALIZING')`,
          [params.forceCallId]
        );
      } else if (params?.organizationId) {
        queryRes = await db.query(
          `SELECT id, call_id, organization_id, max_duration_seconds, started_at, status, metadata
           FROM voice_sessions
           WHERE organization_id = $1
             AND status IN ('ACTIVE', 'FINALIZING')`,
          [params.organizationId]
        );
      } else {
        queryRes = await db.query(
          `SELECT id, call_id, organization_id, max_duration_seconds, started_at, status, metadata
           FROM voice_sessions
           WHERE status IN ('ACTIVE', 'FINALIZING')`
        );
      }
      candidateSessions = queryRes?.rows || [];
    } catch (dbErr: any) {
      console.warn('[VoiceSessionReconciliationWorker] Failed to query voice_sessions table:', dbErr?.message || dbErr);
      return { reconciledCount: 0, callIds: [], skippedCount: 0 };
    }

    for (const session of candidateSessions) {
      const parsedStartedAt = new Date(session.started_at).getTime();
      const maxDurationSec = session.max_duration_seconds || 180;
      const startedAtMs = Number.isFinite(parsedStartedAt) ? parsedStartedAt : (nowMs - ((maxDurationSec + 10) * 1000));
      const elapsedSec = Math.max(1, Math.floor((nowMs - startedAtMs) / 1000));
      const expiryThresholdSec = params?.maxAgeSeconds ?? (maxDurationSec + this.DEFAULT_GRACE_PERIOD_SECONDS);

      const isExpired = elapsedSec >= expiryThresholdSec;
      const isForced = params?.forceCallId === session.call_id;

      if (!isExpired && !isForced) {
        skippedCount++;
        continue;
      }

      // 2. ATOMIC DATABASE CLAIM (Cross-process safe lock)
      // Exactly ONE worker can succeed in claiming the session
      const leaseExpiresAt = new Date(nowMs + this.LEASE_DURATION_MS).toISOString();
      let claimed: any = null;

      try {
        const claimResult = await db.query<{ id: string; call_id: string }>(
          `UPDATE voice_sessions
           SET status = 'FINALIZING',
               reconciliation_worker_id = $1,
               reconciliation_lock_until = $2,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3
             AND (
               status = 'ACTIVE'
               OR (status = 'FINALIZING' AND (reconciliation_lock_until IS NULL OR reconciliation_lock_until <= CURRENT_TIMESTAMP))
             )`,
          [workerId, leaseExpiresAt, session.id]
        );

        if (claimResult.rowCount === 0) {
          // Another worker concurrently claimed this session — skip safely
          skippedCount++;
          continue;
        }
        claimed = session;
      } catch (claimErr: any) {
        console.warn(`[VoiceSessionReconciliationWorker] Claim failed for session ${session.call_id}:`, claimErr?.message || claimErr);
        skippedCount++;
        continue;
      }

      // 3. Enforce DB-level idempotency: verify voice_call_records
      try {
        const existingRecord = await db.getOne<{ id: string }>(
          'SELECT id FROM voice_call_records WHERE provider_call_id = $1',
          [session.call_id]
        );

        if (existingRecord) {
          // Already finalized in voice_call_records — mark session RECONCILED and remove from active tracker
          await db.execute(
            `UPDATE voice_sessions
             SET status = 'RECONCILED',
                 ended_at = CURRENT_TIMESTAMP,
                 finalization_reason = 'ALREADY_RECORDED',
                 reconciliation_lock_until = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [session.id]
          );
          VoiceService.activeCalls.delete(session.call_id);
          skippedCount++;
          continue;
        }

        // 4. Calculate honest duration ceiling
        const durationSeconds = Math.min(maxDurationSec, elapsedSec);
        const durationMinutes = Math.round((durationSeconds / 60) * 10) / 10;
        let callerPhone = '+15550001111';
        try {
          const meta = typeof session.metadata === 'string' ? JSON.parse(session.metadata) : session.metadata;
          if (meta?.callerPhone) callerPhone = meta.callerPhone;
        } catch {}

        // 5. Finalize call via VoiceService.handleCallEnded
        await VoiceService.handleCallEnded({
          callId: session.call_id,
          fromNumber: callerPhone,
          toNumber: '',
          startedAt: new Date(startedAtMs).toISOString(),
          endedAt: new Date().toISOString(),
          durationSeconds,
          durationMinutes,
          transcript: '',
          metadata: {
            organizationId: session.organization_id,
            assistantId: `deepgram_${session.organization_id}`,
            channel: 'WEB',
            isReconciled: true,
            durationType: 'ESTIMATED_CEILING',
            reason: 'RECONCILED_ABANDONED_SESSION',
          },
        });

        // 6. Mark session durably RECONCILED in PostgreSQL
        await db.execute(
          `UPDATE voice_sessions
           SET status = 'RECONCILED',
               ended_at = CURRENT_TIMESTAMP,
               finalization_reason = 'RECONCILED_ABANDONED_SESSION',
               reconciliation_lock_until = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [session.id]
        );

        // Remove from in-memory tracker if present
        VoiceService.activeCalls.delete(session.call_id);
        reconciledCallIds.push(session.call_id);
      } catch (procErr: any) {
        console.error(`[VoiceSessionReconciliationWorker] Error finalizing session ${session.call_id}:`, procErr);
        // Release lease on error so next run can retry
        await db.execute(
          `UPDATE voice_sessions
           SET reconciliation_lock_until = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND reconciliation_worker_id = $2`,
          [session.id, workerId]
        ).catch(() => {});
        skippedCount++;
      }
    }

    return {
      reconciledCount: reconciledCallIds.length,
      callIds: reconciledCallIds,
      skippedCount,
    };
  }
}
