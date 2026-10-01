import { db } from '../db';
import { ComposioService } from './ComposioService';
import { IntegrationService } from './IntegrationService';

export class SocialSyncService {
  private static pollTimer: NodeJS.Timeout | null = null;
  private static isSyncing = false;

  /**
   * Start background worker for polling connected Instagram and Facebook accounts.
   */
  static startPolling(intervalMs: number = 30000) {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    console.log(`[SocialSyncService] Started background Instagram/Facebook sync worker (interval: ${intervalMs}ms)`);

    // Run once immediately
    this.syncAllConnectedSocialChannels().catch((err) =>
      console.warn('[SocialSyncService] Initial social sync notice:', err.message || err)
    );

    this.pollTimer = setInterval(() => {
      this.syncAllConnectedSocialChannels().catch((err) =>
        console.warn('[SocialSyncService] Background social sync cycle notice:', err.message || err)
      );
    }, intervalMs);
  }

  /**
   * Stop background social polling worker.
   */
  static stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      console.log('[SocialSyncService] Stopped background social sync worker.');
    }
  }

  /**
   * Synchronize all active Instagram and Facebook channels.
   */
  static async syncAllConnectedSocialChannels() {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      if (!ComposioService.isAvailable()) {
        return;
      }

      // 1. Synchronize Instagram accounts
      const activeIg = await db.query<{ organization_id: string }>(
        "SELECT organization_id FROM instagram_connections WHERE is_active = TRUE AND status = 'CONNECTED'"
      );

      for (const row of activeIg.rows) {
        try {
          await this.syncInstagramOrganization(row.organization_id);
        } catch (igErr: any) {
          console.warn(`[SocialSyncService] Error syncing Instagram for org ${row.organization_id}:`, igErr.message || igErr);
        }
      }

      // 2. Synchronize Facebook accounts
      const activeFb = await db.query<{ organization_id: string }>(
        "SELECT organization_id FROM facebook_connections WHERE is_active = TRUE AND status = 'CONNECTED'"
      );

      for (const row of activeFb.rows) {
        try {
          await this.syncFacebookOrganization(row.organization_id);
        } catch (fbErr: any) {
          console.warn(`[SocialSyncService] Error syncing Facebook for org ${row.organization_id}:`, fbErr.message || fbErr);
        }
      }
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Synchronize unread Instagram direct messages for a single organization.
   */
  static async syncInstagramOrganization(organizationId: string): Promise<{ syncedCount: number; errors: number }> {
    let syncedCount = 0;
    let errors = 0;

    if (!ComposioService.isAvailable()) return { syncedCount: 0, errors: 0 };

    try {
      const messages = await ComposioService.fetchInstagramMessages(organizationId);

      for (const msg of messages) {
        try {
          if (!msg.senderId || !msg.text || msg.isEcho) continue;

          // Deduplication check
          const msgId = msg.id || `ig_${msg.senderId}_${Buffer.from(msg.text).toString('base64').substring(0, 20)}`;
          const existing = await db.getOne(
            'SELECT event_id FROM processed_webhook_events WHERE event_id = $1',
            [msgId]
          );

          if (existing) continue;

          const res = await IntegrationService.handleInstagramInboundMessage({
            organizationId,
            senderId: msg.senderId,
            senderUsername: msg.senderUsername,
            text: msg.text,
            messageId: msgId,
          });

          if (res.success) {
            syncedCount++;
          }
        } catch (msgErr: any) {
          console.error(`[SocialSyncService] Error processing Instagram message for ${organizationId}:`, msgErr);
          errors++;
        }
      }

      await db.execute(
        'UPDATE instagram_connections SET last_synced_at = CURRENT_TIMESTAMP WHERE organization_id = $1',
        [organizationId]
      );
    } catch (err: any) {
      console.warn(`[SocialSyncService] Instagram sync exception for org ${organizationId}:`, err.message || err);
      errors++;
    }

    return { syncedCount, errors };
  }

  /**
   * Synchronize unread Facebook Page messages for a single organization.
   */
  static async syncFacebookOrganization(organizationId: string): Promise<{ syncedCount: number; errors: number }> {
    let syncedCount = 0;
    let errors = 0;

    if (!ComposioService.isAvailable()) return { syncedCount: 0, errors: 0 };

    try {
      const messages = await ComposioService.fetchFacebookMessages(organizationId);

      for (const msg of messages) {
        try {
          if (!msg.senderId || !msg.text || msg.isEcho) continue;

          // Deduplication check
          const msgId = msg.id || `fb_${msg.senderId}_${Buffer.from(msg.text).toString('base64').substring(0, 20)}`;
          const existing = await db.getOne(
            'SELECT event_id FROM processed_webhook_events WHERE event_id = $1',
            [msgId]
          );

          if (existing) continue;

          const res = await IntegrationService.handleFacebookInboundMessage({
            organizationId,
            senderId: msg.senderId,
            senderName: msg.senderName,
            text: msg.text,
            messageId: msgId,
          });

          if (res.success) {
            syncedCount++;
          }
        } catch (msgErr: any) {
          console.error(`[SocialSyncService] Error processing Facebook message for ${organizationId}:`, msgErr);
          errors++;
        }
      }

      await db.execute(
        'UPDATE facebook_connections SET last_synced_at = CURRENT_TIMESTAMP WHERE organization_id = $1',
        [organizationId]
      );
    } catch (err: any) {
      console.warn(`[SocialSyncService] Facebook sync exception for org ${organizationId}:`, err.message || err);
      errors++;
    }

    return { syncedCount, errors };
  }
}
