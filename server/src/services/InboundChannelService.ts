import { db } from '../db';
import { ConversationChannel, AuditAction } from '@onceclic/shared';
import { ConversationService } from './ConversationService';
import { AuditService } from './AuditService';
import { ComposioService } from './ComposioService';
import { EmailService } from './EmailService';

export interface InboundCustomerMessageParams {
  organizationId: string;
  channel: ConversationChannel;
  externalMessageId?: string;
  externalConversationId?: string;
  senderId: string;
  senderName?: string;
  senderAddress?: string;
  subject?: string;
  text: string;
  inReplyToMessageId?: string;
  metadata?: Record<string, any>;
}

export interface InboundCustomerMessageResult {
  success: boolean;
  ignoredDuplicate?: boolean;
  organizationId?: string;
  conversationId?: string;
  aiReplySent: boolean;
  replyText?: string;
  outboundError?: string;
  error?: string;
}

/**
 * Channel-Agnostic Inbound Customer Message Pipeline.
 *
 * Provides a single canonical pathway for all inbound communication channels
 * (Website, Gmail, Instagram, Facebook):
 * 1. Organization Resolution & Validation
 * 2. Stable Idempotency Check
 * 3. Conversation Lookup / Auto-Creation
 * 4. Grounded AI Response Generation (ConversationService & Gemini / MockAIProvider)
 * 5. Same-Channel Outbound Dispatch
 * 6. Conditional Event Processing Acknowledgement (ONLY on successful dispatch)
 */
export class InboundChannelService {
  /**
   * Authoritative canonical processor for all customer inbound messages.
   */
  static async processInboundCustomerMessage(
    params: InboundCustomerMessageParams
  ): Promise<InboundCustomerMessageResult> {
    const {
      organizationId,
      channel,
      externalMessageId,
      externalConversationId,
      senderId,
      senderName,
      senderAddress,
      subject,
      text,
      inReplyToMessageId,
      metadata,
    } = params;

    // 1. Validate required fields
    if (!organizationId || !senderId || !text || !text.trim()) {
      return {
        success: false,
        aiReplySent: false,
        error: 'Missing required parameters: organizationId, senderId, and text are required.',
      };
    }

    // 2. Validate Organization existence
    const org = await db.getOne<{ id: string; name: string }>(
      'SELECT id, name FROM organizations WHERE id = $1',
      [organizationId]
    );

    if (!org) {
      console.warn(`[InboundChannelService] Organization not found: ${organizationId}`);
      return {
        success: false,
        aiReplySent: false,
        error: `Organization not found for ID: ${organizationId}`,
      };
    }

    const channelName = channel === ConversationChannel.EMAIL ? 'Gmail' : channel;
    console.log(`[ChannelSync] ${channelName} inbound message detected`);
    console.log('[ChannelSync] Organization resolved');

    // 3. Stable Idempotency Check (Never blocks different messages from same user)
    const effectiveEventId = externalMessageId;
    if (effectiveEventId) {
      const existingEvent = await db.getOne<{ event_id: string }>(
        'SELECT event_id FROM processed_webhook_events WHERE event_id = $1',
        [effectiveEventId]
      );

      if (existingEvent) {
        console.log(`[InboundChannelService] Duplicate event ${effectiveEventId} already processed. Skipping.`);
        return {
          success: true,
          organizationId,
          aiReplySent: false,
          ignoredDuplicate: true,
        };
      }
    }

    // 4. Audit Log Inbound Message
    let auditAction: AuditAction = AuditAction.EMAIL_RECEIVED;
    if (channel === ConversationChannel.INSTAGRAM) {
      auditAction = AuditAction.INSTAGRAM_MESSAGE_RECEIVED;
    } else if (channel === ConversationChannel.FACEBOOK) {
      auditAction = AuditAction.FACEBOOK_MESSAGE_RECEIVED;
    }

    await AuditService.log({
      organizationId,
      action: auditAction,
      entityType: 'CONVERSATION',
      entityId: effectiveEventId || senderId,
      metadata: {
        channel,
        senderId,
        senderName,
        senderAddress,
        textLength: text.length,
        ...metadata,
      },
    });

    // 5. Lookup or create conversation for this customer
    const customerDisplayName =
      senderName ||
      (channel === ConversationChannel.EMAIL
        ? (senderAddress || senderId).split('@')[0]
        : channel === ConversationChannel.INSTAGRAM
        ? `Instagram User ${senderId.slice(-4)}`
        : channel === ConversationChannel.FACEBOOK
        ? `Facebook User ${senderId.slice(-4)}`
        : `Customer ${senderId.slice(-4)}`);

    const customerEmail = channel === ConversationChannel.EMAIL ? senderAddress || senderId : undefined;
    const customerPhone = channel !== ConversationChannel.EMAIL ? senderId : undefined;

    const conversation = await ConversationService.getOrCreateConversation({
      organizationId,
      channel,
      customerName: customerDisplayName,
      customerEmail,
      customerPhone,
    });
    console.log('[ChannelSync] Conversation created');

    // 6. Format content for AI ingestion
    const formattedContent =
      channel === ConversationChannel.EMAIL && subject
        ? `Subject: ${subject}\n\n${text.trim()}`
        : text.trim();

    // 7. Generate Grounded AI Response
    const handleResult = await ConversationService.handleCustomerMessage({
      organizationId,
      conversationId: conversation.id,
      content: formattedContent,
      clientMessageId: effectiveEventId,
      customerName: customerDisplayName,
      customerEmail,
      customerPhone,
    });

    const aiMsg = handleResult.aiMessage;

    // 8. Outbound Dispatch via Channel Adapter
    if (aiMsg && aiMsg.content) {
      console.log('[ChannelSync] AI response generated');
      let dispatchSuccess = false;
      let dispatchError: string | undefined;
      let dispatchMessageId: string | undefined;
      let outboundProvider = 'LOCAL_CHANNEL';

      if (channel === ConversationChannel.EMAIL) {
        const emailRes = await EmailService.sendEmailReply({
          organizationId,
          toEmail: senderAddress || senderId,
          subject: subject || 'Inquiry',
          body: aiMsg.content,
          inReplyToMessageId: inReplyToMessageId || effectiveEventId,
        });

        dispatchSuccess = emailRes.success;
        dispatchMessageId = emailRes.messageId;
        outboundProvider = emailRes.provider;
        if (!dispatchSuccess) {
          dispatchError = 'Failed to dispatch email reply through connected mailbox.';
        }
      } else if (channel === ConversationChannel.INSTAGRAM) {
        const igRes = await ComposioService.sendInstagramReply({
          organizationId,
          recipientId: senderId,
          text: aiMsg.content,
        });

        dispatchSuccess = igRes.success;
        dispatchMessageId = igRes.messageId;
        outboundProvider = 'COMPOSIO_INSTAGRAM';
        if (!dispatchSuccess) {
          dispatchError = igRes.error || 'Failed to dispatch Instagram reply through Composio.';
        }
      } else if (channel === ConversationChannel.FACEBOOK) {
        const fbRes = await ComposioService.sendFacebookReply({
          organizationId,
          recipientId: senderId,
          text: aiMsg.content,
        });

        dispatchSuccess = fbRes.success;
        dispatchMessageId = fbRes.messageId;
        outboundProvider = 'COMPOSIO_FACEBOOK';
        if (!dispatchSuccess) {
          dispatchError = fbRes.error || 'Failed to dispatch Facebook reply through Composio.';
        }
      } else {
        // Website widget / direct HTTP response
        dispatchSuccess = true;
        outboundProvider = 'WEBSITE_WIDGET';
      }

      // 9. Conditional Acknowledgement & Audit
      if (dispatchSuccess) {
        const logChannel = channel === ConversationChannel.EMAIL ? 'Gmail' : channel;
        console.log(`[ChannelSync] ${logChannel} reply sent`);

        // Mark event as processed ONLY after successful delivery
        if (effectiveEventId) {
          await db.execute(
            `INSERT INTO processed_webhook_events (event_id, event_type, occurred_at, processed_at)
             VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT (event_id) DO NOTHING`,
            [effectiveEventId, `${channel.toLowerCase()}_message`]
          );
        }

        let sentAction: AuditAction = AuditAction.EMAIL_SENT;
        if (channel === ConversationChannel.INSTAGRAM) {
          sentAction = AuditAction.INSTAGRAM_MESSAGE_SENT;
        } else if (channel === ConversationChannel.FACEBOOK) {
          sentAction = AuditAction.FACEBOOK_MESSAGE_SENT;
        }

        await AuditService.log({
          organizationId,
          action: sentAction,
          entityType: 'CONVERSATION',
          entityId: conversation.id,
          metadata: {
            recipient: senderAddress || senderId,
            provider: outboundProvider,
            messageId: dispatchMessageId,
          },
        });

        return {
          success: true,
          organizationId,
          conversationId: conversation.id,
          aiReplySent: true,
          replyText: aiMsg.content,
        };
      } else {
        console.warn(`[InboundChannelService] Outbound dispatch failed for ${channel} (org ${organizationId}):`, dispatchError);
        // Do NOT mark event as processed so retry is possible
        return {
          success: false,
          organizationId,
          conversationId: conversation.id,
          aiReplySent: false,
          replyText: aiMsg.content,
          outboundError: dispatchError,
        };
      }
    }

    return {
      success: true,
      organizationId,
      conversationId: conversation.id,
      aiReplySent: false,
    };
  }
}
