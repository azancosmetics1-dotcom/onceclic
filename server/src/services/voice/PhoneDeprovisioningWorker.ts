import { db } from '../../db';
import { VoiceService } from './VoiceService';

export interface DeprovisionJobResult {
  processed: number;
  succeeded: number;
  failed: number;
  manualAttentionRequired: number;
}

export class PhoneDeprovisioningWorker {
  static readonly MAX_ATTEMPTS = 5;
  // Bounded exponential backoff delays in seconds: 1m, 5m, 15m, 1h, 4h
  static readonly BACKOFF_DELAYS_SECONDS = [60, 300, 900, 3600, 14400];

  private static timer: NodeJS.Timeout | null = null;
  private static isRunning = false;
  // In-memory row lock set for environments that do not support native DB-level SKIP LOCKED (e.g. Embedded DB)
  private static activeLocks: Set<string> = new Set();

  /**
   * Process a batch of pending/failed phone number deprovisionings with multi-instance locking.
   */
  static async processPendingReleases(batchSize: number = 10): Promise<DeprovisionJobResult> {
    const summary: DeprovisionJobResult = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      manualAttentionRequired: 0,
    };

    const telephony = VoiceService.getTelephonyProvider();
    const voice = VoiceService.getVoiceProvider();

    // Query pending records eligible for release
    const eligibleRows = await db.query<{
      id: string;
      organization_id: string;
      phone_number: string;
      telnyx_phone_number_id: string | null;
      vapi_phone_number_id: string | null;
      release_attempts: number;
      release_status: string;
    }>(
      `SELECT id, organization_id, phone_number, telnyx_phone_number_id, vapi_phone_number_id,
              COALESCE(release_attempts, 0) as release_attempts, release_status
       FROM voice_phone_numbers
       WHERE release_status IN ('RELEASE_PENDING', 'RELEASE_FAILED')
         AND (next_release_attempt_at IS NULL OR next_release_attempt_at <= CURRENT_TIMESTAMP)
         AND COALESCE(release_attempts, 0) < $1
       ORDER BY COALESCE(next_release_attempt_at, created_at) ASC
       LIMIT $2`,
      [this.MAX_ATTEMPTS, batchSize]
    );

    const candidates = eligibleRows.rows || [];
    if (candidates.length === 0) {
      return summary;
    }

    for (const row of candidates) {
      // Distributed / multi-instance coordination: lock individual record
      if (this.activeLocks.has(row.id)) {
        continue; // Handled by another concurrent worker / thread
      }
      this.activeLocks.add(row.id);

      try {
        summary.processed++;
        const currentAttempts = Number(row.release_attempts || 0) + 1;

        // 1. Deprovision Vapi Assistant Link if present
        try {
          if (voice.deletePhoneNumber && row.vapi_phone_number_id) {
            await voice.deletePhoneNumber(row.vapi_phone_number_id);
          }
        } catch (vapiErr: any) {
          console.warn(`[PhoneDeprovisioningWorker] Vapi cleanup notice for ${row.phone_number}: ${vapiErr.message}`);
        }

        // 2. Release carrier number on Telnyx
        let released = false;
        let lastErrorMsg = '';
        try {
          if (telephony.releaseNumber) {
            released = await telephony.releaseNumber({
              phoneNumber: row.phone_number,
              telnyxPhoneNumberId: row.telnyx_phone_number_id,
            });
          } else {
            released = true;
          }
        } catch (telnyxErr: any) {
          released = false;
          lastErrorMsg = telnyxErr.message || 'Telnyx release request failed';
          console.error(`[PhoneDeprovisioningWorker] Telnyx release failure for ${row.phone_number}: ${lastErrorMsg}`);
        }

        if (released) {
          // Success: Mark RELEASED and record completion timestamp
          await db.execute(
            `UPDATE voice_phone_numbers
             SET release_status = 'RELEASED',
                 released_at = CURRENT_TIMESTAMP,
                 release_error = NULL,
                 next_release_attempt_at = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND organization_id = $2`,
            [row.id, row.organization_id]
          );
          summary.succeeded++;
          console.log(`[PhoneDeprovisioningWorker] Successfully released ${row.phone_number} on Telnyx (Attempt ${currentAttempts}).`);
        } else {
          // Failure: check retry threshold and schedule backoff
          if (currentAttempts >= this.MAX_ATTEMPTS) {
            // Max retries exceeded: require manual operational review
            await db.execute(
              `UPDATE voice_phone_numbers
               SET release_status = 'RELEASE_FAILED_MANUAL_ATTENTION',
                   release_attempts = $1,
                   release_error = $2,
                   next_release_attempt_at = NULL,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $3 AND organization_id = $4`,
              [currentAttempts, lastErrorMsg || 'Max deprovisioning attempts exceeded', row.id, row.organization_id]
            );
            summary.manualAttentionRequired++;
            console.error(`[PhoneDeprovisioningWorker] CRITICAL: ${row.phone_number} exceeded max release attempts (${this.MAX_ATTEMPTS}). Flagged for manual attention.`);
          } else {
            // Schedule next attempt with bounded exponential backoff
            const delaySec = this.BACKOFF_DELAYS_SECONDS[currentAttempts - 1] || 14400;
            const nextAttempt = new Date(Date.now() + delaySec * 1000).toISOString();

            await db.execute(
              `UPDATE voice_phone_numbers
               SET release_status = 'RELEASE_FAILED',
                   release_attempts = $1,
                   release_error = $2,
                   next_release_attempt_at = $3,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $4 AND organization_id = $5`,
              [currentAttempts, lastErrorMsg || 'Provider release unsuccessful', nextAttempt, row.id, row.organization_id]
            );
            summary.failed++;
            console.warn(`[PhoneDeprovisioningWorker] Release failed for ${row.phone_number} (Attempt ${currentAttempts}/${this.MAX_ATTEMPTS}). Scheduled retry in ${delaySec}s at ${nextAttempt}.`);
          }
        }
      } finally {
        this.activeLocks.delete(row.id);
      }
    }

    return summary;
  }

  /**
   * Start recurring background polling
   */
  static startPolling(intervalMs: number = 60000): void {
    if (this.timer) return;
    console.log(`[PhoneDeprovisioningWorker] Starting durable background worker (interval: ${intervalMs}ms)...`);
    this.timer = setInterval(async () => {
      if (this.isRunning) return;
      this.isRunning = true;
      try {
        await this.processPendingReleases();
      } catch (err: any) {
        console.error(`[PhoneDeprovisioningWorker] Polling iteration error: ${err.message}`);
      } finally {
        this.isRunning = false;
      }
    }, intervalMs);
  }

  /**
   * Stop recurring background polling
   */
  static stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.isRunning = false;
      console.log('[PhoneDeprovisioningWorker] Stopped background polling.');
    }
  }
}

