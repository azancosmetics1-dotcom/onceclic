import { db } from '../db';
import { EmailConnection, ConversationChannel, AuditAction, IntegrationStatus } from '@onceclic/shared';
import { ConversationService } from './ConversationService';
import { AuditService } from './AuditService';
import { IntegrationService } from './IntegrationService';
import { ComposioService } from './ComposioService';
import { ResendEmailService } from './ResendEmailService';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';

export interface InboundEmailPayload {
  organizationId?: string;
  fromEmail: string;
  fromName?: string;
  toEmail?: string;
  subject?: string;
  textBody: string;
  messageId?: string;
  webhookToken?: string;
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
              status, connected_email as "connectedEmail", last_synced_at as "lastSyncedAt",
              error_message as "errorMessage", created_at as "createdAt", updated_at as "updatedAt"
       FROM email_connections WHERE organization_id = $1`,
      [organizationId]
    );

    if (!conn) {
      const connId = uuidv4();
      const webhookToken = `whk_${uuidv4().replace(/-/g, '')}`;
      const org = await db.getOne<{ slug: string }>('SELECT slug FROM organizations WHERE id = $1', [organizationId]);
      const inboundAddress = `inbox+${org?.slug || organizationId.substring(0, 8)}@onceclic.com`;

      await db.execute(
        `INSERT INTO email_connections (
           id, organization_id, provider_type, inbound_address, webhook_token, is_active, status, created_at, updated_at
         ) VALUES ($1, $2, 'OAUTH', $3, $4, FALSE, 'NOT_CONNECTED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [connId, organizationId, inboundAddress, webhookToken]
      );

      conn = (await db.getOne<EmailConnection>(
        `SELECT id, organization_id as "organizationId", provider_type as "providerType",
                inbound_address as "inboundAddress", webhook_token as "webhookToken", is_active as "isActive",
                status, created_at as "createdAt", updated_at as "updatedAt"
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
        updates.smtpHost ? updates.smtpHost : null,
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
   * Send an outgoing email reply via Google Gmail API or fallback transactional dispatcher.
   */
  static async sendEmailReply(params: {
    organizationId: string;
    toEmail: string;
    subject: string;
    body: string;
    inReplyToMessageId?: string;
  }): Promise<{ success: boolean; messageId?: string; provider: string }> {
    const { organizationId, toEmail, subject, body, inReplyToMessageId } = params;

    const conn = await db.getOne<{
      provider_type: string;
      connected_email: string;
      inbound_address: string;
      is_active: boolean;
    }>(
      'SELECT provider_type, connected_email, inbound_address, is_active FROM email_connections WHERE organization_id = $1',
      [organizationId]
    );

    const cleanSubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;

    // 1. Primary: If connected via Composio Managed OAuth, dispatch via Composio Gmail tool
    if (ComposioService.isAvailable() && conn?.provider_type === 'OAUTH' && conn.is_active) {
      try {
        const compRes = await ComposioService.sendGmailReply({
          organizationId,
          toEmail,
          subject: cleanSubject,
          body,
          inReplyToMessageId,
        });

        if (compRes.success) {
          return {
            success: true,
            messageId: compRes.messageId || 'sent_via_composio',
            provider: 'COMPOSIO_GMAIL',
          };
        }
        console.warn('[EmailService] Composio send failed, trying direct OAuth fallback:', compRes.error);
      } catch (compErr: any) {
        console.warn('[EmailService] Composio send exception:', compErr.message || compErr);
      }
    }

    // 2. Secondary: Direct Google Gmail OAuth token dispatch
    if (conn?.provider_type === 'OAUTH' && conn.connected_email) {
      const accessToken = await IntegrationService.getValidGoogleEmailAccessToken(organizationId);
      if (accessToken) {
        try {
          const fromHeader = conn.connected_email;
          const headers = [
            `From: ${fromHeader}`,
            `To: ${toEmail}`,
            `Subject: ${cleanSubject}`,
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
          ];
          if (inReplyToMessageId) {
            headers.push(`In-Reply-To: ${inReplyToMessageId}`);
            headers.push(`References: ${inReplyToMessageId}`);
          }

          const rawEmail = `${headers.join('\r\n')}\r\n\r\n${body}`;
          // Gmail API requires base64url encoding
          const encodedEmail = Buffer.from(rawEmail)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

          const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ raw: encodedEmail }),
          });

          if (res.ok) {
            const data = (await res.json()) as any;
            return { success: true, messageId: data.id, provider: 'GOOGLE_GMAIL' };
          } else {
            const errData = (await res.json()) as any;
            console.warn('[Gmail Send] API error:', errData);
          }
        } catch (gmailErr) {
          console.error('[Gmail Send Exception]:', gmailErr);
        }
      }
    }

    // 3. Fallback / Forwarding: Dispatch via Resend transactional email with Reply-To
    const resendResult = await ResendEmailService.sendEmail({
      to: toEmail,
      subject: cleanSubject,
      text: body,
      replyTo: conn?.connected_email || conn?.inbound_address,
    });

    return {
      success: resendResult.success,
      messageId: resendResult.id || undefined,
      provider: 'RESEND_FALLBACK',
    };
  }

  /**
   * Authoritative inbound email processing pipeline:
   * 1. Multi-tenant organization resolution
   * 2. Anti-looping & anti-self-reply guardrails
   * 3. Deduplication
   * 4. Contextual AI response generation
   * 5. Outbound email dispatch
   */
  static async processInboundEmail(payload: InboundEmailPayload): Promise<{
    success: boolean;
    organizationId?: string;
    conversationId?: string;
    aiReplySent?: boolean;
    message?: string;
  }> {
    const fromEmail = (payload.fromEmail || '').toLowerCase().trim();
    const toEmail = (payload.toEmail || '').toLowerCase().trim();
    const subject = payload.subject || 'Inquiry';
    const textBody = (payload.textBody || '').trim();

    if (!fromEmail || !textBody) {
      return { success: false, message: 'fromEmail and textBody are required.' };
    }

    // 1. Identify organization by payload.organizationId, webhookToken, inbound_address, or connected_email
    let conn: any = null;

    if (payload.organizationId) {
      conn = await db.getOne(
        'SELECT organization_id, is_active, connected_email, inbound_address, provider_type, status FROM email_connections WHERE organization_id = $1',
        [payload.organizationId]
      );
    }

    if (!conn && payload.webhookToken) {
      conn = await db.getOne(
        'SELECT organization_id, is_active, connected_email, inbound_address, provider_type, status FROM email_connections WHERE webhook_token = $1',
        [payload.webhookToken]
      );
    }

    if (!conn && toEmail) {
      conn = await db.getOne(
        'SELECT organization_id, is_active, connected_email, inbound_address, provider_type, status FROM email_connections WHERE LOWER(inbound_address) = $1 OR LOWER(connected_email) = $1',
        [toEmail]
      );
    }

    if (!conn && toEmail.includes('+')) {
      // Check slug-based matching: inbox+slug@onceclic.com
      const slugMatch = toEmail.match(/inbox\+([a-zA-Z0-9_-]+)@/);
      if (slugMatch && slugMatch[1]) {
        const slug = slugMatch[1];
        const org = await db.getOne('SELECT id FROM organizations WHERE slug = $1', [slug]);
        if (org) {
          conn = await db.getOne(
            'SELECT organization_id, is_active, connected_email, inbound_address, provider_type, status FROM email_connections WHERE organization_id = $1',
            [org.id]
          );
        }
      }
    }

    if (!conn) {
      return { success: false, message: 'Organization not found for incoming email recipient address.' };
    }

    const organizationId = conn.organization_id;

    // 2. Anti-Looping & Anti-Self-Reply Protection
    // Do NOT reply if the email is sent from the organization's own connected mailbox
    if (conn.connected_email && fromEmail === conn.connected_email.toLowerCase()) {
      console.log(`[Email Pipeline] Skipping email from self (${fromEmail}) to prevent loops.`);
      return { success: true, message: 'Skipped self-sent message.' };
    }

    if (conn.inbound_address && fromEmail === conn.inbound_address.toLowerCase()) {
      console.log(`[Email Pipeline] Skipping email from inbound address (${fromEmail}) to prevent loops.`);
      return { success: true, message: 'Skipped self-sent message.' };
    }

    // Do NOT reply to known bounce/daemon/no-reply mailboxes
    const isDaemon =
      fromEmail.includes('mailer-daemon') ||
      fromEmail.includes('no-reply') ||
      fromEmail.includes('noreply') ||
      fromEmail.includes('postmaster') ||
      fromEmail.includes('auto-reply') ||
      fromEmail.includes('bounce');

    if (isDaemon) {
      console.log(`[Email Pipeline] Skipping system/daemon email from ${fromEmail}.`);
      return { success: true, message: 'Skipped daemon message.' };
    }

    // 3. Log Inbound Email Audit Event
    await AuditService.log({
      organizationId,
      action: AuditAction.EMAIL_RECEIVED,
      entityType: 'EMAIL',
      metadata: { from: fromEmail, to: toEmail, subject },
    });

    // 4. Create or lookup active conversation for this customer
    const conversation = await ConversationService.getOrCreateConversation({
      organizationId,
      channel: ConversationChannel.EMAIL,
      customerName: payload.fromName || fromEmail.split('@')[0],
      customerEmail: fromEmail,
    });

    // 5. Deduplication & Idempotency: Use deterministic clientMessageId
    const rawMsgId = payload.messageId || `${fromEmail}_${subject}_${textBody.substring(0, 60)}`;
    const clientMessageId = `email_${Buffer.from(rawMsgId).toString('base64').substring(0, 32)}`;

    // 6. Process message through AI Receptionist pipeline (grounded in Org knowledge & guardrails)
    const result = await ConversationService.handleCustomerMessage({
      organizationId,
      conversationId: conversation.id,
      content: `Subject: ${subject}\n\n${textBody}`,
      clientMessageId,
      customerName: payload.fromName,
      customerEmail: fromEmail,
    });

    let aiReplySent = false;

    // 7. Dispatch AI Reply via Connected Mailbox (or fallback)
    if (result.aiMessage && result.aiMessage.content) {
      const dispatchRes = await this.sendEmailReply({
        organizationId,
        toEmail: fromEmail,
        subject,
        body: result.aiMessage.content,
        inReplyToMessageId: payload.messageId,
      });

      aiReplySent = dispatchRes.success;

      await AuditService.log({
        organizationId,
        action: AuditAction.EMAIL_SENT,
        entityType: 'EMAIL',
        metadata: {
          to: fromEmail,
          conversationId: conversation.id,
          provider: dispatchRes.provider,
          messageId: dispatchRes.messageId,
        },
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
