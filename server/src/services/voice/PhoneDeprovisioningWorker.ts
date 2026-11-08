import { v4 as uuidv4 } from 'uuid';
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
  // Durable database release lease duration: 5 minutes
  static readonly LEASE_DURATION_MS = 5 * 60 * 1000;

  private static timer: NodeJS.Timeout | null = null;
  private static isRunning = false;
  // In-process lock set for local thread safety alongside durable DB coordination
  private static activeLocks: Set<string> = new Set();

  /**
   * Durably claim a phone number release lease in PostgreSQL across multiple Railway instances.
   * Atomically transitions release_status to RELEASE_IN_PROGRESS.
   * Returns true if lease was claimed atomically, false if already leased or renewed.
   */
  static async claimReleaseLease(phoneId: string, workerId: string): Promise<boolean> {
    const leaseExpiresAt = new Date(Date.now() + this.LEASE_DURATION_MS).toISOString();
    const count = await db.execute(
      `UPDATE voice_phone_numbers
       SET release_worker_id = $1,
           release_locked_until = $2,
           release_status = 'RELEASE_IN_PROGRESS',
           status = 'RELEASE_IN_PROGRESS',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
         AND (
           release_status IN ('RELEASE_PENDING', 'RELEASE_FAILED')
           OR (release_status = 'RELEASE_IN_PROGRESS' AND release_locked_until <= CURRENT_TIMESTAMP)
         )
         AND (release_locked_until IS NULL OR release_locked_until <= CURRENT_TIMESTAMP)
         AND (creem_subscription_id IS NULL OR billing_status != 'ACTIVE')
         AND status != 'ACTIVE'`,
      [workerId, leaseExpiresAt, phoneId]
    );
    return count > 0;
  }

  /**
   * Release durable database claim lease on unexpected worker error.
   */
  static async releaseLease(phoneId: string, workerId: string): Promise<void> {
    await db.execute(
      `UPDATE voice_phone_numbers
       SET release_worker_id = NULL,
           release_locked_until = NULL,
           release_status = 'RELEASE_FAILED',
           status = 'SUSPENDED',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND release_worker_id = $2 AND release_status = 'RELEASE_IN_PROGRESS'`,
      [phoneId, workerId]
    );
  }

  /**
   * Process temporary phone numbers whose 14-day rental duration has ended.
   * Suspends telephony service while retaining the carrier number in Telnyx
   * for the 30-day retention grace period.
   */
  static async processExpiredRentals(batchSize: number = 20): Promise<number> {
    const expiredRentals = await db.query<{
      id: string;
      organization_id: string;
      phone_number: string;
    }>(
      `SELECT id, organization_id, phone_number
       FROM voice_phone_numbers
       WHERE is_trial_number = TRUE
         AND status IN ('ACTIVE', 'TEST_REQUIRED')
         AND rental_ends_at IS NOT NULL
         AND rental_ends_at <= CURRENT_TIMESTAMP
         AND (creem_subscription_id IS NULL OR billing_status != 'ACTIVE')
       LIMIT $1`,
      [batchSize]
    );

    const candidates = expiredRentals.rows || [];
    let count = 0;

    for (const row of candidates) {
      if (this.activeLocks.has(row.id)) continue;
      this.activeLocks.add(row.id);
      try {
        const updated = await db.execute(
          `UPDATE voice_phone_numbers
           SET status = 'SUSPENDED',
               billing_status = 'SUSPENDED_GRACE_PERIOD',
               is_retained = TRUE,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND organization_id = $2
             AND is_trial_number = TRUE
             AND status IN ('ACTIVE', 'TEST_REQUIRED')
             AND rental_ends_at IS NOT NULL
             AND rental_ends_at <= CURRENT_TIMESTAMP
             AND (creem_subscription_id IS NULL OR billing_status != 'ACTIVE')`,
          [row.id, row.organization_id]
        );
        if (updated > 0) {
          count++;
          console.log(`[PhoneDeprovisioningWorker] Suspended expired 14-day rental ${row.phone_number}. Number is retained for 30-day grace period.`);
        }
      } catch (err: any) {
        console.error(`[PhoneDeprovisioningWorker] Failed to suspend expired rental ${row.phone_number}:`, err.message);
      } finally {
        this.activeLocks.delete(row.id);
      }
    }

    return count;
  }

  /**
   * Process retained phone numbers whose 30-day retention grace period has ended without renewal.
   * Transitions them to RELEASE_PENDING so they are safely returned via Telnyx.
   */
  static async processExpiredRetentions(batchSize: number = 20): Promise<number> {
    const expiredRetentions = await db.query<{
      id: string;
      organization_id: string;
      phone_number: string;
    }>(
      `SELECT id, organization_id, phone_number
       FROM voice_phone_numbers
       WHERE is_retained = TRUE
         AND retention_ends_at IS NOT NULL
         AND retention_ends_at <= CURRENT_TIMESTAMP
         AND (creem_subscription_id IS NULL OR billing_status != 'ACTIVE')
         AND release_status NOT IN ('RELEASE_PENDING', 'RELEASE_IN_PROGRESS', 'RELEASED', 'RELEASE_FAILED_MANUAL_ATTENTION')
       LIMIT $1`,
      [batchSize]
    );

    const candidates = expiredRetentions.rows || [];
    let count = 0;

    for (const row of candidates) {
      if (this.activeLocks.has(row.id)) continue;
      this.activeLocks.add(row.id);
      try {
        const updated = await db.execute(
          `UPDATE voice_phone_numbers
           SET release_status = 'RELEASE_PENDING',
               status = 'RELEASE_PENDING',
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND organization_id = $2
             AND is_retained = TRUE
             AND retention_ends_at IS NOT NULL
             AND retention_ends_at <= CURRENT_TIMESTAMP
             AND (creem_subscription_id IS NULL OR billing_status != 'ACTIVE')
             AND release_status NOT IN ('RELEASE_PENDING', 'RELEASE_IN_PROGRESS', 'RELEASED', 'RELEASE_FAILED_MANUAL_ATTENTION')`,
          [row.id, row.organization_id]
        );
        if (updated > 0) {
          count++;
          console.log(`[PhoneDeprovisioningWorker] Retention grace period expired for ${row.phone_number}. Queued for Telnyx release.`);
        }
      } catch (err: any) {
        console.error(`[PhoneDeprovisioningWorker] Failed to queue expired retention ${row.phone_number} for release:`, err.message);
      } finally {
        this.activeLocks.delete(row.id);
      }
    }

    return count;
  }

  /**
   * Process a batch of pending/failed phone number deprovisionings with durable database coordination.
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
    const workerId = `worker_${uuidv4().replace(/-/g, '')}`;

    // Query pending records eligible for release
    const eligibleRows = await db.query<{
      id: string;
      organization_id: string;
      phone_number: string;
      telnyx_phone_number_id: string | null;
      vapi_phone_number_id: string | null;
      release_attempts: number;
      release_status: string;
      billing_status?: string;
      creem_subscription_id?: string | null;
      release_locked_until?: string | null;
    }>(
      `SELECT id, organization_id, phone_number, telnyx_phone_number_id, vapi_phone_number_id,
              COALESCE(release_attempts, 0) as release_attempts, release_status,
              billing_status, creem_subscription_id, release_locked_until
       FROM voice_phone_numbers
       WHERE release_status IN ('RELEASE_PENDING', 'RELEASE_FAILED')
         AND (next_release_attempt_at IS NULL OR next_release_attempt_at <= CURRENT_TIMESTAMP)
         AND (release_locked_until IS NULL OR release_locked_until <= CURRENT_TIMESTAMP)
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
      // In-process lock (defense in depth for concurrent threads within same node process)
      if (this.activeLocks.has(row.id)) {
        continue;
      }
      this.activeLocks.add(row.id);

      // Active Renewal Guard: NEVER release an active, renewed phone number
      if (row.billing_status === 'ACTIVE' && row.creem_subscription_id) {
        console.log(`[PhoneDeprovisioningWorker] Phone number ${row.phone_number} is renewed and ACTIVE. Skipping release and clearing release status.`);
        await db.execute(
          `UPDATE voice_phone_numbers
           SET release_status = 'NOT_RELEASED',
               is_retained = FALSE,
               next_release_attempt_at = NULL,
               release_error = NULL,
               release_worker_id = NULL,
               release_locked_until = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND organization_id = $2`,
          [row.id, row.organization_id]
        );
        this.activeLocks.delete(row.id);
        continue;
      }

      // Acquire durable distributed lease in the database across all Railway containers
      const claimed = await this.claimReleaseLease(row.id, workerId);
      if (!claimed) {
        this.activeLocks.delete(row.id);
        continue;
      }

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

        // Verify release boundary claim is still ours and no valid renewal occurred before calling carrier
        const preCarrierCheck = await db.getOne<{
          billing_status: string;
          creem_subscription_id: string | null;
          release_status: string;
          release_worker_id: string | null;
        }>(
          'SELECT billing_status, creem_subscription_id, release_status, release_worker_id FROM voice_phone_numbers WHERE id = $1',
          [row.id]
        );
        if (
          !preCarrierCheck ||
          preCarrierCheck.release_worker_id !== workerId ||
          preCarrierCheck.release_status !== 'RELEASE_IN_PROGRESS' ||
          (preCarrierCheck.billing_status === 'ACTIVE' && preCarrierCheck.creem_subscription_id)
        ) {
          console.warn(`[PhoneDeprovisioningWorker] Aborting release of ${row.phone_number}: state changed or renewed before carrier call.`);
          this.activeLocks.delete(row.id);
          continue;
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
          // Success: Mark RELEASED, record completion timestamp, and clear lease
          await db.execute(
            `UPDATE voice_phone_numbers
             SET release_status = 'RELEASED',
                 status = 'RELEASED',
                 provisioning_status = 'INACTIVE',
                 released_at = CURRENT_TIMESTAMP,
                 release_error = NULL,
                 next_release_attempt_at = NULL,
                 release_worker_id = NULL,
                 release_locked_until = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND organization_id = $2 AND release_worker_id = $3 AND release_status = 'RELEASE_IN_PROGRESS'`,
            [row.id, row.organization_id, workerId]
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
                   status = 'SUSPENDED',
                   release_attempts = $1,
                   release_error = $2,
                   next_release_attempt_at = NULL,
                   release_worker_id = NULL,
                   release_locked_until = NULL,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $3 AND organization_id = $4 AND release_worker_id = $5 AND release_status = 'RELEASE_IN_PROGRESS'`,
              [currentAttempts, lastErrorMsg || 'Max deprovisioning attempts exceeded', row.id, row.organization_id, workerId]
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
                   status = 'SUSPENDED',
                   release_attempts = $1,
                   release_error = $2,
                   next_release_attempt_at = $3,
                   release_worker_id = NULL,
                   release_locked_until = NULL,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $4 AND organization_id = $5 AND release_worker_id = $6 AND release_status = 'RELEASE_IN_PROGRESS'`,
              [currentAttempts, lastErrorMsg || 'Provider release unsuccessful', nextAttempt, row.id, row.organization_id, workerId]
            );
            summary.failed++;
            console.warn(`[PhoneDeprovisioningWorker] Release failed for ${row.phone_number} (Attempt ${currentAttempts}/${this.MAX_ATTEMPTS}). Scheduled retry in ${delaySec}s at ${nextAttempt}.`);
          }
        }
      } catch (err: any) {
        console.error(`[PhoneDeprovisioningWorker] Unexpected error releasing ${row.phone_number}:`, err.message);
        await this.releaseLease(row.id, workerId);
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
        await this.processExpiredRentals();
        await this.processExpiredRetentions();
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
