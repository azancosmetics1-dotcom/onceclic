import { db } from '../db';
import { IntegrationService } from './IntegrationService';
import { ComposioService } from './ComposioService';
import { EmailService } from './EmailService';

export class EmailSyncService {
  private static pollTimer: NodeJS.Timeout | null = null;
  private static isSyncing = false;

  /**
   * Start server-side background worker for polling connected Gmail mailboxes.
   */
  static startPolling(intervalMs: number = 30000) {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    console.log(`[EmailSyncService] Started background Gmail sync worker (interval: ${intervalMs}ms)`);
    // Run immediately once
    this.syncAllConnectedMailboxes().catch((err) =>
      console.warn('[EmailSyncService] Initial mailbox sync notice:', err.message || err)
    );

    this.pollTimer = setInterval(() => {
      this.syncAllConnectedMailboxes().catch((err) =>
        console.warn('[EmailSyncService] Background sync cycle notice:', err.message || err)
      );
    }, intervalMs);
  }

  /**
   * Stop background polling worker.
   */
  static stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      console.log('[EmailSyncService] Stopped background Gmail sync worker.');
    }
  }

  /**
   * Synchronize all connected organizations' Gmail inboxes.
   */
  static async syncAllConnectedMailboxes() {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      const activeConnections = await db.query<{
        organization_id: string;
        connected_email: string;
      }>(
        "SELECT organization_id, connected_email FROM email_connections WHERE provider_type = 'OAUTH' AND status = 'CONNECTED' AND is_active = TRUE"
      );

      for (const conn of activeConnections.rows) {
        try {
          await this.syncOrganization(conn.organization_id);
        } catch (orgErr: any) {
          console.warn(`[EmailSyncService] Error syncing org ${conn.organization_id}:`, orgErr.message || orgErr);
        }
      }
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Synchronize inbound emails for a single organization.
   */
  static async syncOrganization(organizationId: string): Promise<{ syncedCount: number; errors: number }> {
    let syncedCount = 0;
    let errors = 0;

    // 1. Primary: Composio Managed OAuth Polling
    if (ComposioService.isAvailable()) {
      try {
        const composioMessages = await ComposioService.fetchUnreadEmails(organizationId);
        if (composioMessages && composioMessages.length > 0) {
          for (const msg of composioMessages) {
            try {
              // Deduplication check
              const clientMsgId = `email_${Buffer.from(msg.rfcMessageId || msg.id).toString('base64').substring(0, 32)}`;
              const existing = await db.getOne(
                "SELECT id FROM conversation_messages WHERE client_message_id = $1 OR client_message_id LIKE $2",
                [clientMsgId, `%_${msg.id}%`]
              );
              if (existing) {
                continue;
              }

              await EmailService.processInboundEmail({
                fromEmail: msg.fromEmail,
                fromName: msg.fromName,
                toEmail: msg.toEmail,
                subject: msg.subject,
                textBody: msg.textBody,
                messageId: msg.rfcMessageId || msg.id,
              });
              syncedCount++;
            } catch (msgErr: any) {
              console.warn(`[EmailSyncService] Error processing Composio email ${msg.id}:`, msgErr.message || msgErr);
              errors++;
            }
          }

          await db.execute(
            'UPDATE email_connections SET last_synced_at = CURRENT_TIMESTAMP WHERE organization_id = $1',
            [organizationId]
          );

          return { syncedCount, errors };
        }
      } catch (compErr: any) {
        console.warn(`[EmailSyncService] Composio sync notice for org ${organizationId}:`, compErr.message || compErr);
      }
    }

    // 2. Secondary: Direct Google OAuth token polling
    const accessToken = await IntegrationService.getValidGoogleEmailAccessToken(organizationId);
    if (!accessToken) {
      return { syncedCount: 0, errors: 0 };
    }

    try {
      // 1. Query for recent unread or inbox messages
      const listRes = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=15',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (!listRes.ok) {
        if (listRes.status === 401 || listRes.status === 403) {
          await db.execute(
            "UPDATE email_connections SET status = 'ERROR', error_message = 'Google Gmail access expired or revoked. Please reconnect.' WHERE organization_id = $1",
            [organizationId]
          );
        }
        return { syncedCount: 0, errors: 1 };
      }

      const listData = (await listRes.json()) as any;
      const messages = listData.messages || [];

      for (const msgMeta of messages) {
        try {
          // Check if message was already processed in conversation_messages or audit_logs
          const existing = await db.getOne(
            "SELECT id FROM conversation_messages WHERE client_message_id = $1 OR client_message_id LIKE $2",
            [`email_${msgMeta.id}`, `%_${msgMeta.id}%`]
          );
          if (existing) {
            continue;
          }

          // 2. Fetch full message payload
          const msgRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgMeta.id}?format=full`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );

          if (!msgRes.ok) continue;

          const msgData = (await msgRes.json()) as any;
          const headers = msgData.payload?.headers || [];

          const getHeader = (name: string) => {
            const h = headers.find((x: any) => x.name.toLowerCase() === name.toLowerCase());
            return h ? h.value : '';
          };

          const fromRaw = getHeader('From');
          const toRaw = getHeader('To');
          const subject = getHeader('Subject') || 'Inquiry';
          const rfcMessageId = getHeader('Message-ID') || msgMeta.id;

          // Parse name and email from "John Doe <john@example.com>"
          let fromEmail = fromRaw;
          let fromName = '';
          const match = fromRaw.match(/(.*)<(.+@.+?)>/);
          if (match) {
            fromName = match[1].replace(/["']/g, '').trim();
            fromEmail = match[2].trim();
          }

          // Extract text body
          let textBody = '';
          if (msgData.snippet) {
            textBody = msgData.snippet;
          }

          const extractBody = (part: any): string => {
            if (!part) return '';
            if (part.body?.data) {
              const decoded = Buffer.from(part.body.data, 'base64').toString('utf8');
              if (part.mimeType === 'text/plain') return decoded;
              if (part.mimeType === 'text/html' && !textBody) {
                // Strip basic html tags
                return decoded.replace(/<[^>]*>?/gm, ' ').trim();
              }
            }
            if (part.parts && Array.isArray(part.parts)) {
              for (const subPart of part.parts) {
                const subText = extractBody(subPart);
                if (subText) return subText;
              }
            }
            return '';
          };

          const parsedBody = extractBody(msgData.payload);
          if (parsedBody) {
            textBody = parsedBody;
          }

          if (fromEmail && textBody) {
            await EmailService.processInboundEmail({
              fromEmail,
              fromName,
              toEmail: toRaw,
              subject,
              textBody,
              messageId: rfcMessageId,
            });
            syncedCount++;
          }
        } catch (msgErr: any) {
          console.warn(`[EmailSyncService] Error processing message ${msgMeta.id}:`, msgErr.message || msgErr);
          errors++;
        }
      }

      // Update last_synced_at
      await db.execute(
        'UPDATE email_connections SET last_synced_at = CURRENT_TIMESTAMP WHERE organization_id = $1',
        [organizationId]
      );
    } catch (err: any) {
      console.warn(`[EmailSyncService] Sync exception for org ${organizationId}:`, err.message || err);
      errors++;
    }

    return { syncedCount, errors };
  }
}
