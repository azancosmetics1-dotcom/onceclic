import { ComposioService, ComposioEmailMessage, ComposioInstagramMessage, ComposioFacebookMessage } from './ComposioService';

/**
 * Centralized Composio Channel Adapter.
 * Encapsulates action discovery, tool slug resolution, payload normalization,
 * and execution across Gmail, Instagram, and Facebook.
 */
export class ComposioChannelAdapter {
  // =========================================================================
  // GMAIL CHANNEL ADAPTER
  // =========================================================================
  static readonly gmail = {
    fetchUnreadEmails: async (organizationId: string): Promise<ComposioEmailMessage[]> => {
      return ComposioService.fetchUnreadEmails(organizationId);
    },

    sendReply: async (params: {
      organizationId: string;
      toEmail: string;
      subject: string;
      body: string;
      threadId?: string;
      inReplyToMessageId?: string;
    }): Promise<{ success: boolean; messageId?: string; error?: string }> => {
      return ComposioService.sendGmailReply(params);
    },
  };

  // =========================================================================
  // INSTAGRAM CHANNEL ADAPTER
  // =========================================================================
  static readonly instagram = {
    fetchMessages: async (organizationId: string): Promise<ComposioInstagramMessage[]> => {
      return ComposioService.fetchInstagramMessages(organizationId);
    },

    sendReply: async (params: {
      organizationId: string;
      recipientId: string;
      text: string;
    }): Promise<{ success: boolean; messageId?: string; error?: string }> => {
      return ComposioService.sendInstagramReply(params);
    },
  };

  // =========================================================================
  // FACEBOOK CHANNEL ADAPTER
  // =========================================================================
  static readonly facebook = {
    fetchMessages: async (organizationId: string): Promise<ComposioFacebookMessage[]> => {
      return ComposioService.fetchFacebookMessages(organizationId);
    },

    sendReply: async (params: {
      organizationId: string;
      recipientId: string;
      text: string;
    }): Promise<{ success: boolean; messageId?: string; error?: string }> => {
      return ComposioService.sendFacebookReply(params);
    },
  };
}
