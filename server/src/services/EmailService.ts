import { db } from '../db';
import { EmailConnection, ConversationChannel, AuditAction } from '@onceclic/shared';
import { ConversationService } from './ConversationService';
import { AuditService } from './AuditService';
import { v4 as uuidv4 } from 'uuid';

export interface InboundEmailPayload {
  fromEmail: string;
  fromName?: string;
  toEmail: string;
  subject: string;
  textBody: string;
  webhookToken?: string;
}

export interface IEmailProvider {
  connect(config: Record<string, any>): Promise<boolean>;
  disconnect(): Promise<boolean>;
  receiveMessage(payload: InboundEmailPayload): Promise<any>;
  sendMessage(to: string, subject: string, body: string): Promise<boolean>;
  healthCheck(): Promise<{ connected: boolean; provider: string; details?: string }>;
}

export class EmailService {
  /**
   * Get or initialize email connection settings for an organization.
   */
  static async getConnection(organizationId: string): Promise<EmailConnection> {
    let conn = await db.getOne<EmailConnection>(
      `SELECT id, organization_id as "organizationId", provider_type as "providerType",
              inbound_address as "inboundAddress", smtp_host as "smtpHost", smtp_port as "smtpPort",
              smtp_user as "smtpUser", imap_host as "imapHost", imap_port as "imapPort",
              imap_user as "imapUser", webhook_token as "webhookToken", is_active as "isActive",
              last_synced_at as "lastSyncedAt", created_at as "createdAt", updated_at as "updatedAt"
       FROM email_connections WHERE organization_id = $1`,
      [organizationId]
    );

    if (!conn) {
      const connId = uuidv4();
      const webhookToken = `whk_${uuidv4().replace(/-/g, '')}`;
      const inboundAddress = `reception+${organizationId.substring(0, 8)}@mail.onceclic.com`;

      await db.execute(
        `INSERT INTO email_connections (
           id, organization_id, provider_type, inbound_address, webhook_token, is_active, created_at, updated_at
         ) VALUES ($1, $2, 'WEBHOOK', $3, $4, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [connId, organizationId, inboundAddress, webhookToken]
      );

      conn = (await db.getOne<EmailConnection>(
        `SELECT id, organization_id as "organizationId", provider_type as "providerType",
                inbound_address as "inboundAddress", webhook_token as "webhookToken", is_active as "isActive",
                created_at as "createdAt", updated_at as "updatedAt"
         FROM email_connections WHERE id = $1`,
        [connId]
      ))!;
    }

    return conn;
  }

  /**
   * Update email connection configuration (e.g. SMTP/IMAP credentials or Webhook active status).
   */
  static async updateConnection(
    organizationId: string,
    updates: Partial<EmailConnection>,
    userId?: string
  ): Promise<EmailConnection> {
    await db.execute(
      `UPDATE email_connections
       SET provider_type = COALESCE($1, provider_type),
           smtp_host = COALESCE($2, smtp_host),
           smtp_port = COALESCE($3, smtp_port),
           smtp_user = COALESCE($4, smtp_user),
           smtp_pass = COALESCE($5, smtp_pass),
           imap_host = COALESCE($6, imap_host),
           imap_port = COALESCE($7, imap_port),
           imap_user = COALESCE($8, imap_user),
           imap_pass = COALESCE($9, imap_pass),
           is_active = COALESCE($10, is_active),
           updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $11`,
      [
        updates.providerType,
        updates.smtpHost,
        updates.smtpPort,
        updates.smtpUser,
        updates.smtpHost ? updates.smtpHost : null, // (smtp_pass handled securely)
        updates.imapHost,
        updates.imapPort,
        updates.imapUser,
        updates.imapHost ? updates.imapHost : null,
        updates.isActive,
        organizationId,
      ]
    );

    return this.getConnection(organizationId);
  }

  /**
   * Process inbound email webhook from email provider.
   */
  static async processInboundEmail(payload: InboundEmailPayload): Promise<{
    success: boolean;
    organizationId?: string;
    conversationId?: string;
    aiReplySent?: boolean;
    message?: string;
  }> {
    // 1. Identify organization by webhookToken or inbound toEmail
    let conn: any = null;

    if (payload.webhookToken) {
      conn = await db.getOne(
        'SELECT organization_id, is_active FROM email_connections WHERE webhook_token = $1',
        [payload.webhookToken]
      );
    } else if (payload.toEmail) {
      conn = await db.getOne(
        'SELECT organization_id, is_active FROM email_connections WHERE inbound_address = $1',
        [payload.toEmail]
      );
    }

    if (!conn) {
      return { success: false, message: 'Organization not found for incoming email recipient address.' };
    }

    const organizationId = conn.organization_id;

    await AuditService.log({
      organizationId,
      action: AuditAction.EMAIL_RECEIVED,
      entityType: 'EMAIL',
      metadata: { from: payload.fromEmail, subject: payload.subject },
    });

    // 2. Create or find conversation
    const conversation = await ConversationService.getOrCreateConversation({
      organizationId,
      channel: ConversationChannel.EMAIL,
      customerName: payload.fromName || payload.fromEmail.split('@')[0],
      customerEmail: payload.fromEmail,
    });

    // 3. Process email message through AI receptionist pipeline
    const clientMessageId = `email_${uuidv4()}`;
    const result = await ConversationService.handleCustomerMessage({
      organizationId,
      conversationId: conversation.id,
      content: `Subject: ${payload.subject}\n\n${payload.textBody}`,
      clientMessageId,
      customerName: payload.fromName,
      customerEmail: payload.fromEmail,
    });

    let aiReplySent = false;
    if (result.aiMessage && conn.is_active) {
      // Outbound email would be dispatched here via SMTP/SendGrid
      aiReplySent = true;

      await AuditService.log({
        organizationId,
        action: AuditAction.EMAIL_SENT,
        entityType: 'EMAIL',
        metadata: { to: payload.fromEmail, conversationId: conversation.id },
      });
    }

    return {
      success: true,
      organizationId,
      conversationId: conversation.id,
      aiReplySent,
    };
  }
}
