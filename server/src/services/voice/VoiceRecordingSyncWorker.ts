/**
 * VoiceRecordingSyncWorker.ts
 *
 * Atomic worker that downloads completed call recordings from Vapi's storage
 * and uploads them to private Supabase Storage via its REST API.
 *
 * Key design properties:
 * - Atomic claim with unique token (FOR UPDATE SKIP LOCKED)
 * - Stale-worker fencing via claim_token mismatch check before write
 * - Idempotent: same recording URL will not be downloaded/uploaded twice
 * - Private storage: no permanent public URLs exposed
 * - SSRF protection via SafeNetworkClient (only allowed hosts)
 * - Signed URL generation via Supabase REST API
 * - Graceful handling of missing infrastructure (env vars, bucket)
 */

import { db } from '../../db';
import { v4 as uuidv4 } from 'uuid';
import https from 'node:https';
import { SafeNetworkClient } from './SafeNetworkClient';

// ─── Types ───────────────────────────────────────────────────────────────────

export type RecordingSyncStatus = 'PENDING' | 'PROCESSING' | 'SYNCED' | 'FAILED';

interface RecordingClaimResult {
  id: string;
  claimToken: string;
  providerCallId: string;
  organizationId: string;
  recordingUrl: string;
  recordingStoragePath: string | null;
  recordingAttempts: number;
}

// ─── Configuration ───────────────────────────────────────────────────────────

const MAX_RETRY_ATTEMPTS = 3;
const CLAIM_LEASE_SECONDS = 300; // 5 minutes
const SIGNED_URL_EXPIRY_SECONDS = 3600; // 1 hour

/** Supabase bucket name for voice recordings. Must be created in Supabase dashboard. */
const STORAGE_BUCKET = 'voice-recordings';

// Extra allowed hosts for recording download — Vapi stores recordings on S3
const RECORDING_ALLOWED_HOSTS = [
  ...SafeNetworkClient.DEFAULT_ALLOWED_HOSTS,
  // Additional hosts that may serve Vapi recording files
  's3.amazonaws.com',
  's3.us-east-1.amazonaws.com',
];

// ─── Storage helpers ─────────────────────────────────────────────────────────

function getSupabaseConfig(): { url: string; serviceKey: string } | null {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return null;
  }

  return { url: supabaseUrl.replace(/\/$/, ''), serviceKey };
}

/**
 * Upload a Buffer to Supabase Storage via its REST API using Node.js https.
 * Idempotent: uses x-upsert=true so a re-upload of the same path replaces the object.
 */
async function uploadToSupabaseStorage(
  supabaseUrl: string,
  serviceKey: string,
  storagePath: string,
  audioBuffer: Buffer,
  contentType: string = 'audio/mpeg'
): Promise<void> {
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${storagePath}`;

  const parsedUploadUrl = new URL(uploadUrl);
  if (parsedUploadUrl.protocol !== 'https:') {
    throw new Error('UPLOAD_ERROR: Storage URL must use HTTPS.');
  }

  await new Promise<void>((resolve, reject) => {
    const options: https.RequestOptions = {
      method: 'POST',
      hostname: parsedUploadUrl.hostname,
      path: parsedUploadUrl.pathname + parsedUploadUrl.search,
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
        'Content-Length': audioBuffer.length,
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          resolve();
        } else {
          reject(new Error(`UPLOAD_ERROR: Supabase storage upload failed (${status}): ${body.slice(0, 200)}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`UPLOAD_ERROR: ${err.message}`)));
    req.write(audioBuffer);
    req.end();
  });
}

/**
 * Generate a short-lived signed URL for a private Supabase Storage object.
 */
export async function generateSignedRecordingUrl(
  storagePath: string,
  expiresInSeconds: number = SIGNED_URL_EXPIRY_SECONDS
): Promise<string> {
  const cfg = getSupabaseConfig();
  if (!cfg) {
    throw new Error('Supabase storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  const signUrl = `${cfg.url}/storage/v1/object/sign/${STORAGE_BUCKET}/${storagePath}`;
  const parsedSignUrl = new URL(signUrl);
  const bodyStr = JSON.stringify({ expiresIn: expiresInSeconds });

  const responseData = await new Promise<any>((resolve, reject) => {
    const options: https.RequestOptions = {
      method: 'POST',
      hostname: parsedSignUrl.hostname,
      path: parsedSignUrl.pathname,
      headers: {
        Authorization: `Bearer ${cfg.serviceKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          try { resolve(JSON.parse(data)); } catch { reject(new Error(`SIGN_ERROR: Invalid JSON response`)); }
        } else {
          reject(new Error(`SIGN_ERROR: Failed to generate signed URL (${status}): ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`SIGN_ERROR: ${err.message}`)));
    req.write(bodyStr);
    req.end();
  });

  const signedPath: string = responseData?.signedURL;
  if (!signedPath) {
    throw new Error('SIGN_ERROR: Supabase response did not include signedURL.');
  }

  // Supabase returns a relative path like /storage/v1/object/sign/...
  if (signedPath.startsWith('http')) {
    return signedPath;
  }
  return `${cfg.url}${signedPath}`;
}

// ─── Worker ──────────────────────────────────────────────────────────────────

export class VoiceRecordingSyncWorker {
  private static isRunning = false;

  /**
   * Process a single batch of recordings pending synchronization.
   * Safe to call concurrently — claims are atomic.
   */
  static async processOneBatch(batchSize: number = 5): Promise<{ processed: number; failed: number }> {
    let processed = 0;
    let failed = 0;

    const cfg = getSupabaseConfig();
    if (!cfg) {
      console.warn('[VoiceRecordingSyncWorker] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set. Worker skipping.');
      return { processed, failed };
    }

    // Find and claim pending recordings atomically
    const claimedRecords = await this.claimPendingRecordings(batchSize);

    for (const record of claimedRecords) {
      const result = await this.syncRecording(cfg, record);
      if (result.success) {
        processed++;
      } else {
        failed++;
      }
    }

    // Also recover stale claims from crashed workers
    await this.recoverStaleClaims();

    return { processed, failed };
  }

  /**
   * Claim up to `limit` PENDING recordings with atomic lease.
   * Uses FOR UPDATE SKIP LOCKED to prevent duplicate processing.
   */
  private static async claimPendingRecordings(limit: number): Promise<RecordingClaimResult[]> {
    const now = new Date().toISOString();
    const leaseUntil = new Date(Date.now() + CLAIM_LEASE_SECONDS * 1000).toISOString();

    return db.withTransaction(async (tx) => {
      // Select rows that are PENDING or eligible for retry
      const rows = await tx.query<any>(
        `SELECT id, provider_call_id, organization_id, recording_url,
                recording_storage_path, recording_attempts
         FROM voice_call_records
         WHERE recording_sync_status = 'PENDING'
           AND recording_url IS NOT NULL
           AND (recording_next_retry_at IS NULL OR recording_next_retry_at <= $1)
         ORDER BY created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [now, limit]
      );

      if (rows.rowCount === 0) return [];

      const results: RecordingClaimResult[] = [];

      for (const row of rows.rows) {
        const claimToken = uuidv4();

        await tx.execute(
          `UPDATE voice_call_records
           SET recording_sync_status = 'PROCESSING',
               recording_claim_token = $1,
               recording_lease_until = $2,
               recording_attempts = recording_attempts + 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [claimToken, leaseUntil, row.id]
        );

        results.push({
          id: row.id,
          claimToken,
          providerCallId: row.provider_call_id,
          organizationId: row.organization_id,
          recordingUrl: row.recording_url,
          recordingStoragePath: row.recording_storage_path,
          recordingAttempts: (row.recording_attempts || 0) + 1,
        });
      }

      return results;
    });
  }

  /**
   * Download and upload a single recording.
   * Verifies claim token before writing results (stale-worker fencing).
   */
  private static async syncRecording(
    cfg: { url: string; serviceKey: string },
    record: RecordingClaimResult
  ): Promise<{ success: boolean }> {
    const { id, claimToken, organizationId, recordingUrl, recordingAttempts } = record;

    try {
      // Validate the recording URL for SSRF before downloading
      let validatedUrl: URL;
      try {
        validatedUrl = SafeNetworkClient.validateUrl(recordingUrl, RECORDING_ALLOWED_HOSTS);
      } catch (err: any) {
        throw new Error(`SSRF_BLOCKED: Recording URL rejected: ${err.message}`);
      }

      // Check idempotency: if already has a storage path, skip download
      if (record.recordingStoragePath) {
        await this.writeSuccess(id, claimToken, record.recordingStoragePath);
        return { success: true };
      }

      // Download recording using SafeNetworkClient
      console.log(`[VoiceRecordingSyncWorker] Downloading recording for call record ${id}`);
      const response = await SafeNetworkClient.fetch(recordingUrl, {
        method: 'GET',
        customAllowedHosts: RECORDING_ALLOWED_HOSTS,
        timeoutMs: 60000, // 60s for large audio files
      });

      if (!response.ok) {
        throw new Error(`DOWNLOAD_ERROR: HTTP ${response.status} downloading recording`);
      }

      const audioBuffer = await response.buffer();
      const contentType = response.headers['content-type'] || 'audio/mpeg';

      // Build organization-scoped storage path
      const fileExt = contentType.includes('wav') ? 'wav' : contentType.includes('ogg') ? 'ogg' : 'mp3';
      const storagePath = `${organizationId}/${id}.${fileExt}`;

      // Upload to private Supabase Storage
      console.log(`[VoiceRecordingSyncWorker] Uploading recording to ${storagePath}`);
      await uploadToSupabaseStorage(cfg.url, cfg.serviceKey, storagePath, audioBuffer, contentType);

      // Stale-worker fence + write success
      await this.writeSuccess(id, claimToken, storagePath);

      console.log(`[VoiceRecordingSyncWorker] ✓ Synced recording for call record ${id} → ${storagePath}`);
      return { success: true };
    } catch (err: any) {
      const errorMsg = err?.message || 'Unknown error';
      console.error(`[VoiceRecordingSyncWorker] ✗ Failed to sync recording ${id}:`, errorMsg);

      const isPermanentFailure = recordingAttempts >= MAX_RETRY_ATTEMPTS || errorMsg.startsWith('SSRF_BLOCKED');

      await this.writeFailure(id, claimToken, errorMsg, isPermanentFailure, recordingAttempts);
      return { success: false };
    }
  }

  /**
   * Write a successful sync result.
   * Checks claim token to prevent stale-worker overwrites.
   */
  private static async writeSuccess(id: string, claimToken: string, storagePath: string): Promise<void> {
    const updated = await db.execute(
      `UPDATE voice_call_records
       SET recording_sync_status = 'SYNCED',
           recording_storage_path = $1,
           recording_claim_token = NULL,
           recording_lease_until = NULL,
           recording_last_error = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND recording_claim_token = $3`,
      [storagePath, id, claimToken]
    );

    if (updated === 0) {
      console.warn(`[VoiceRecordingSyncWorker] Stale worker fenced on record ${id} — claim token mismatch. Skipping write.`);
    }
  }

  /**
   * Write a failure result with retry scheduling or permanent failure marking.
   * Checks claim token for stale-worker fencing.
   */
  private static async writeFailure(
    id: string,
    claimToken: string,
    errorMsg: string,
    isPermanent: boolean,
    recordingAttempts: number = 0
  ): Promise<void> {
    // Truncate error for storage
    const truncatedError = errorMsg.slice(0, 500);

    if (isPermanent) {
      await db.execute(
        `UPDATE voice_call_records
         SET recording_sync_status = 'FAILED',
             recording_last_error = $1,
             recording_claim_token = NULL,
             recording_lease_until = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND recording_claim_token = $3`,
        [truncatedError, id, claimToken]
      );
    } else {
      // Schedule retry with exponential backoff based on attempt count
      const backoffSeconds = Math.min(60 * Math.pow(2, recordingAttempts), 3600); // 2 min, 4 min, 8 min … up to 1 hour
      const nextRetryAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();

      await db.execute(
        `UPDATE voice_call_records
         SET recording_sync_status = 'PENDING',
             recording_last_error = $1,
             recording_next_retry_at = $2,
             recording_claim_token = NULL,
             recording_lease_until = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 AND recording_claim_token = $4`,
        [truncatedError, nextRetryAt, id, claimToken]
      );
    }
  }

  /**
   * Reset PROCESSING records with expired leases back to PENDING.
   * Allows recovery from crashed or timed-out workers.
   */
  static async recoverStaleClaims(): Promise<number> {
    const now = new Date().toISOString();
    const recovered = await db.execute(
      `UPDATE voice_call_records
       SET recording_sync_status = 'PENDING',
           recording_claim_token = NULL,
           recording_lease_until = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE recording_sync_status = 'PROCESSING'
         AND recording_lease_until < $1`,
      [now]
    );

    if (recovered > 0) {
      console.log(`[VoiceRecordingSyncWorker] Recovered ${recovered} stale recording claim(s).`);
    }

    return recovered;
  }

  /**
   * Start the polling worker loop.
   * Designed to be called once at application startup.
   * Integrates with the existing background worker pattern used by EmailSyncService
   * and SocialSyncService.
   */
  static startPolling(intervalMs: number = 60000): void {
    if (this.isRunning) {
      console.warn('[VoiceRecordingSyncWorker] Already running. Skipping duplicate start.');
      return;
    }

    this.isRunning = true;
    console.log(`[VoiceRecordingSyncWorker] Starting polling every ${intervalMs / 1000}s`);

    const run = async () => {
      try {
        const { processed, failed } = await this.processOneBatch(5);
        if (processed > 0 || failed > 0) {
          console.log(`[VoiceRecordingSyncWorker] Batch complete: ${processed} synced, ${failed} failed.`);
        }
      } catch (err: any) {
        console.error('[VoiceRecordingSyncWorker] Unexpected error in polling loop:', err?.message || err);
      }
    };

    // Run immediately on start, then on interval
    run();
    setInterval(run, intervalMs);
  }
}
