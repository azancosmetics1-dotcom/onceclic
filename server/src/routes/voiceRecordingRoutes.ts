/**
 * voiceRecordingRoutes.ts
 *
 * Secure recording access endpoints.
 * - Authenticates the user via authMiddleware
 * - Verifies organization ownership of the call record
 * - Generates short-lived signed URLs from Supabase Storage
 * - Never exposes permanent public URLs or storage credentials
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { tenantIsolationMiddleware } from '../middleware/tenantIsolationMiddleware';
import { requirePermission } from '../middleware/rbacMiddleware';
import { db } from '../db';
import { generateSignedRecordingUrl } from '../services/voice/VoiceRecordingSyncWorker';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationMiddleware);

/**
 * GET /api/voice/recordings/:callRecordId/url
 *
 * Returns a short-lived signed URL to stream the private recording.
 * Verifies:
 *   1. User is authenticated (authMiddleware)
 *   2. Organization context (tenantIsolationMiddleware)
 *   3. The call record belongs to the authenticated organization
 *   4. The recording has been synced to private storage
 */
router.get(
  '/:callRecordId/url',
  requirePermission('voice:read'),
  async (req: Request, res: Response, next) => {
    try {
      const { callRecordId } = req.params;
      const organizationId = req.organizationId!;

      // Verify call record belongs to this organization
      const record = await db.getOne<{
        id: string;
        recording_sync_status: string;
        recording_storage_path: string | null;
      }>(
        `SELECT id, recording_sync_status, recording_storage_path
         FROM voice_call_records
         WHERE id = $1 AND organization_id = $2`,
        [callRecordId, organizationId]
      );

      if (!record) {
        return res.status(404).json({
          success: false,
          error: 'Call record not found.',
        });
      }

      if (record.recording_sync_status !== 'SYNCED' || !record.recording_storage_path) {
        return res.status(404).json({
          success: false,
          error: 'Recording is not yet available. It may still be syncing.',
          syncStatus: record.recording_sync_status || 'NOT_STARTED',
        });
      }

      // Generate short-lived signed URL (1 hour expiry)
      let signedUrl: string;
      try {
        signedUrl = await generateSignedRecordingUrl(record.recording_storage_path, 3600);
      } catch (err: any) {
        if (err.message?.includes('not configured')) {
          return res.status(503).json({
            success: false,
            error: 'Recording storage is not configured on this server.',
          });
        }
        throw err;
      }

      // Never log the signed URL — only log that one was generated
      console.log(`[VoiceRecordingRoutes] Signed URL generated for record ${callRecordId} (org: ${organizationId})`);

      res.json({
        success: true,
        data: {
          signedUrl,
          expiresInSeconds: 3600,
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;

