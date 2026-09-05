import { config } from '../config';

export interface ComposioConnectedAccount {
  id: string;
  app: string;
  status: 'ACTIVE' | 'CONNECTED' | 'INITIATED' | 'FAILED' | 'EXPIRED' | 'DISABLED';
  userEmail?: string;
  accountSummary?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ComposioEmailMessage {
  id: string;
  fromEmail: string;
  fromName: string;
  toEmail?: string;
  subject: string;
  textBody: string;
  rfcMessageId: string;
  threadId?: string;
  date?: string;
}

export class ComposioService {
  private static get baseUrl(): string {
    return (config.composio.baseUrl || 'https://backend.composio.dev/api').replace(/\/+$/, '');
  }

  private static get apiKey(): string {
    return config.composio.apiKey;
  }

  /**
   * Check if Composio is properly configured on the server.
   */
  static isAvailable(): boolean {
    return !!this.apiKey && !this.apiKey.includes('placeholder');
  }

  /**
   * Generate stable entity/user ID for multi-tenant isolation.
   */
  static getEntityId(organizationId: string): string {
    return `org_${organizationId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  }

  /**
   * Internal helper for Composio HTTP requests with authentication headers.
   */
  private static async request<T = any>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<{ ok: boolean; status: number; data: T; error?: string }> {
    if (!this.isAvailable()) {
      return {
        ok: false,
        status: 400,
        data: null as any,
        error: 'COMPOSIO_API_KEY is not configured on the server.',
      };
    }

    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = `${this.baseUrl}${cleanEndpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      ...(options.headers as Record<string, string>),
    };

    try {
      const res = await fetch(url, {
        ...options,
        headers,
      });

      let responseData: any = null;
      const text = await res.text();
      try {
        responseData = text ? JSON.parse(text) : {};
      } catch {
        responseData = { text };
      }

      if (!res.ok) {
        const errorMsg =
          responseData?.message ||
          responseData?.error ||
          responseData?.detail ||
          `Composio API error HTTP ${res.status}`;
        return { ok: false, status: res.status, data: responseData, error: errorMsg };
      }

      return { ok: true, status: res.status, data: responseData };
    } catch (err: any) {
      console.error(`[ComposioService] Request exception to ${endpoint}:`, err);
      return { ok: false, status: 500, data: null as any, error: err.message || 'Network error connecting to Composio' };
    }
  }

  // =========================================================================
  // 1. CONNECTION MANAGEMENT (MANAGED OAUTH CONNECT LINKS)
  // =========================================================================

  /**
   * Initiate Composio Managed OAuth Connect Link for Gmail or Google Calendar.
   */
  static async initiateConnection(params: {
    organizationId: string;
    app: 'gmail' | 'googlecalendar';
    callbackUrl: string;
  }): Promise<{ success: boolean; redirectUrl?: string; error?: string }> {
    const entityId = this.getEntityId(params.organizationId);
    const appSlug = params.app === 'googlecalendar' ? 'googlecalendar' : 'gmail';

    // Primary: Attempt v3.1 Auth Link Session
    const v3Res = await this.request('/v3.1/connected_accounts/link', {
      method: 'POST',
      body: JSON.stringify({
        auth_config_id: appSlug,
        user_id: entityId,
        callback_url: params.callbackUrl,
      }),
    });

    if (v3Res.ok && (v3Res.data?.redirect_url || v3Res.data?.redirectUrl || v3Res.data?.url || v3Res.data?.link)) {
      const redirectUrl =
        v3Res.data.redirect_url || v3Res.data.redirectUrl || v3Res.data.url || v3Res.data.link;
      return { success: true, redirectUrl };
    }

    // Secondary: Attempt v1/connectedAccounts initiate
    const v1Res = await this.request('/v1/connectedAccounts', {
      method: 'POST',
      body: JSON.stringify({
        appName: appSlug,
        user_uuid: entityId,
        entityId: entityId,
        redirectUrl: params.callbackUrl,
        callbackUrl: params.callbackUrl,
      }),
    });

    if (v1Res.ok && (v1Res.data?.redirectUrl || v1Res.data?.redirect_url || v1Res.data?.url)) {
      const redirectUrl = v1Res.data.redirectUrl || v1Res.data.redirect_url || v1Res.data.url;
      return { success: true, redirectUrl };
    }

    const errMsg =
      v3Res.error ||
      v1Res.error ||
      'Failed to generate Composio Managed OAuth Connect Link. Please verify COMPOSIO_API_KEY.';
    console.error(`[ComposioService] Initiate connection error for ${params.app}:`, errMsg);
    return { success: false, error: errMsg };
  }

  /**
   * Get connected account details for an organization and application.
   */
  static async getConnectedAccount(
    organizationId: string,
    app: 'gmail' | 'googlecalendar'
  ): Promise<{
    isConnected: boolean;
    accountId?: string;
    email?: string;
    summary?: string;
    status?: string;
    error?: string;
  }> {
    const entityId = this.getEntityId(organizationId);
    const appSlug = app === 'googlecalendar' ? 'googlecalendar' : 'gmail';

    // Try v3.1 connected_accounts endpoint
    const v3Res = await this.request(`/v3.1/connected_accounts?user_id=${encodeURIComponent(entityId)}`, {
      method: 'GET',
    });

    let accounts: any[] = [];
    if (v3Res.ok && v3Res.data) {
      if (Array.isArray(v3Res.data)) {
        accounts = v3Res.data;
      } else if (Array.isArray(v3Res.data.items)) {
        accounts = v3Res.data.items;
      } else if (Array.isArray(v3Res.data.connected_accounts)) {
        accounts = v3Res.data.connected_accounts;
      }
    } else {
      // Fallback to v1 endpoint
      const v1Res = await this.request(`/v1/connectedAccounts?user_uuid=${encodeURIComponent(entityId)}`, {
        method: 'GET',
      });
      if (v1Res.ok && v1Res.data) {
        if (Array.isArray(v1Res.data)) {
          accounts = v1Res.data;
        } else if (Array.isArray(v1Res.data.items)) {
          accounts = v1Res.data.items;
        }
      }
    }

    // Find account matching the requested app
    const match = accounts.find((acc) => {
      const accApp = (
        acc.app ||
        acc.appName ||
        acc.toolkit ||
        acc.auth_config_id ||
        acc.appUniqueId ||
        ''
      )
        .toLowerCase()
        .replace(/[^a-z]/g, '');
      const targetApp = appSlug.toLowerCase().replace(/[^a-z]/g, '');
      return (
        accApp === targetApp ||
        accApp.includes(targetApp) ||
        (targetApp === 'googlecalendar' && (accApp.includes('calendar') || accApp.includes('googlescalendar'))) ||
        (targetApp === 'gmail' && accApp.includes('gmail'))
      );
    });

    if (!match) {
      return { isConnected: false };
    }

    const status = (match.status || match.state || '').toUpperCase();
    const isConnected = status === 'ACTIVE' || status === 'CONNECTED' || status === 'SUCCESS';

    const email =
      match.userEmail ||
      match.params?.email ||
      match.params?.user_email ||
      match.connectionParams?.email ||
      match.data?.email ||
      match.metadata?.email ||
      undefined;

    const summary =
      match.accountSummary ||
      match.params?.calendar_summary ||
      match.name ||
      email ||
      (app === 'gmail' ? 'Connected Gmail Account' : 'Primary Google Calendar');

    return {
      isConnected,
      accountId: match.id || match.nanoid || match.connected_account_id,
      email,
      summary,
      status,
    };
  }

  /**
   * Disconnect an account in Composio.
   */
  static async disconnectAccount(
    organizationId: string,
    app: 'gmail' | 'googlecalendar'
  ): Promise<{ success: boolean; error?: string }> {
    const existing = await this.getConnectedAccount(organizationId, app);
    if (!existing.accountId) {
      return { success: true };
    }

    // Try deleting / disabling account
    const res = await this.request(`/v3.1/connected_accounts/${existing.accountId}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      // Try v1 delete
      await this.request(`/v1/connectedAccounts/${existing.accountId}`, {
        method: 'DELETE',
      });
    }

    return { success: true };
  }

  // =========================================================================
  // 2. TOOL EXECUTION HELPER
  // =========================================================================

  /**
   * Execute a Composio Tool / Action on behalf of an organization's entity.
   */
  static async executeTool<T = any>(params: {
    organizationId: string;
    toolSlug: string;
    args: Record<string, any>;
  }): Promise<{ success: boolean; data?: T; error?: string }> {
    const entityId = this.getEntityId(params.organizationId);

    // Primary: v3.1 tools execute endpoint
    const v3Res = await this.request(`/v3.1/tools/execute/${encodeURIComponent(params.toolSlug)}`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: entityId,
        arguments: params.args,
      }),
    });

    if (v3Res.ok && v3Res.data) {
      const responseData = v3Res.data.data || v3Res.data.result || v3Res.data.response_data || v3Res.data;
      return { success: true, data: responseData };
    }

    // Fallback: v1 actions execute endpoint
    const v1Res = await this.request(`/v1/actions/${encodeURIComponent(params.toolSlug)}/execute`, {
      method: 'POST',
      body: JSON.stringify({
        user_uuid: entityId,
        entityId: entityId,
        input: params.args,
        arguments: params.args,
      }),
    });

    if (v1Res.ok && v1Res.data) {
      const responseData = v1Res.data.data || v1Res.data.response_data || v1Res.data.result || v1Res.data;
      return { success: true, data: responseData };
    }

    const errMsg = v3Res.error || v1Res.error || `Failed to execute Composio tool ${params.toolSlug}`;
    return { success: false, error: errMsg };
  }

  // =========================================================================
  // 3. GMAIL INTEGRATION ACTIONS (FETCH & SEND)
  // =========================================================================

  /**
   * Fetch recent unread emails from the customer's connected Gmail mailbox.
   */
  static async fetchUnreadEmails(organizationId: string): Promise<ComposioEmailMessage[]> {
    if (!this.isAvailable()) return [];

    // Try fetching emails using GMAIL_FETCH_EMAILS or GMAIL_LIST_MESSAGES
    const execRes = await this.executeTool({
      organizationId,
      toolSlug: 'GMAIL_FETCH_EMAILS',
      args: {
        query: 'is:unread',
        max_results: 15,
      },
    });

    let rawList: any[] = [];
    if (execRes.success && execRes.data) {
      if (Array.isArray(execRes.data)) {
        rawList = execRes.data;
      } else if (Array.isArray(execRes.data.messages)) {
        rawList = execRes.data.messages;
      } else if (Array.isArray(execRes.data.emails)) {
        rawList = execRes.data.emails;
      } else if (Array.isArray(execRes.data.data)) {
        rawList = execRes.data.data;
      }
    } else {
      // Fallback to GMAIL_LIST_MESSAGES
      const listRes = await this.executeTool({
        organizationId,
        toolSlug: 'GMAIL_LIST_MESSAGES',
        args: {
          q: 'is:unread',
          maxResults: 15,
        },
      });

      if (listRes.success && listRes.data) {
        if (Array.isArray(listRes.data.messages)) {
          rawList = listRes.data.messages;
        } else if (Array.isArray(listRes.data)) {
          rawList = listRes.data;
        }
      }
    }

    const parsedMessages: ComposioEmailMessage[] = [];

    for (const item of rawList) {
      try {
        const id = item.id || item.message_id || item.thread_id || String(Date.now());
        const fromRaw = item.from || item.sender || item.from_address || item.fromEmail || '';
        const subject = item.subject || 'Inquiry';
        const textBody = item.body || item.text || item.snippet || item.message || item.content || '';
        const toEmail = item.to || item.recipient || item.toEmail || '';
        const rfcMessageId = item.message_id || item.messageId || item.rfcMessageId || id;
        const threadId = item.threadId || item.thread_id || undefined;

        let fromEmail = fromRaw;
        let fromName = '';
        const match = fromRaw.match(/(.*)<(.+@.+?)>/);
        if (match) {
          fromName = match[1].replace(/["']/g, '').trim();
          fromEmail = match[2].trim();
        }

        if (fromEmail && textBody) {
          parsedMessages.push({
            id,
            fromEmail,
            fromName: fromName || fromEmail.split('@')[0],
            toEmail,
            subject,
            textBody,
            rfcMessageId,
            threadId,
            date: item.date || item.timestamp,
          });
        }
      } catch (parseErr) {
        console.warn('[ComposioService] Error parsing email item:', parseErr);
      }
    }

    return parsedMessages;
  }

  /**
   * Send an email reply from the customer's connected Gmail account.
   */
  static async sendGmailReply(params: {
    organizationId: string;
    toEmail: string;
    subject: string;
    body: string;
    threadId?: string;
    inReplyToMessageId?: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.isAvailable()) {
      return { success: false, error: 'Composio is not configured.' };
    }

    const cleanSubject = params.subject.startsWith('Re:') ? params.subject : `Re: ${params.subject}`;

    const args: Record<string, any> = {
      recipient_email: params.toEmail,
      to: params.toEmail,
      subject: cleanSubject,
      body: params.body,
    };

    if (params.threadId) {
      args.thread_id = params.threadId;
    }
    if (params.inReplyToMessageId) {
      args.in_reply_to = params.inReplyToMessageId;
    }

    const execRes = await this.executeTool({
      organizationId: params.organizationId,
      toolSlug: 'GMAIL_SEND_EMAIL',
      args,
    });

    if (execRes.success) {
      const messageId = execRes.data?.id || execRes.data?.message_id || execRes.data?.messageId || 'sent_via_composio';
      return { success: true, messageId };
    }

    return { success: false, error: execRes.error };
  }

  // =========================================================================
  // 4. GOOGLE CALENDAR INTEGRATION ACTIONS (FREE-BUSY & EVENT CRUD)
  // =========================================================================

  /**
   * Query Google Calendar for busy periods during a specified ISO time window.
   */
  static async getCalendarBusyPeriods(
    organizationId: string,
    timeMin: string,
    timeMax: string
  ): Promise<Array<{ start: number; end: number }>> {
    if (!this.isAvailable()) return [];

    // Attempt GOOGLECALENDAR_FIND_FREE_SLOTS or GOOGLECALENDAR_LIST_EVENTS
    const execRes = await this.executeTool({
      organizationId,
      toolSlug: 'GOOGLECALENDAR_LIST_EVENTS',
      args: {
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
      },
    });

    const busyPeriods: Array<{ start: number; end: number }> = [];

    if (execRes.success && execRes.data) {
      const events: any[] = Array.isArray(execRes.data)
        ? execRes.data
        : Array.isArray(execRes.data.items)
        ? execRes.data.items
        : Array.isArray(execRes.data.events)
        ? execRes.data.events
        : [];

      for (const ev of events) {
        const startStr = ev.start?.dateTime || ev.start?.date || ev.startTime || ev.start;
        const endStr = ev.end?.dateTime || ev.end?.date || ev.endTime || ev.end;

        if (startStr && endStr) {
          const startMs = new Date(startStr).getTime();
          const endMs = new Date(endStr).getTime();
          if (!isNaN(startMs) && !isNaN(endMs) && endMs > startMs) {
            busyPeriods.push({ start: startMs, end: endMs });
          }
        }
      }
    }

    return busyPeriods;
  }

  /**
   * Create an appointment event in the customer's Google Calendar.
   */
  static async createCalendarEvent(
    organizationId: string,
    eventData: {
      appointmentId?: string;
      serviceName: string;
      customerName: string;
      customerEmail: string;
      customerPhone?: string;
      startTime: string;
      endTime: string;
      notes?: string;
      timezone?: string;
    }
  ): Promise<{ success: boolean; eventId?: string; error?: string }> {
    if (!this.isAvailable()) {
      return { success: false, error: 'Composio is not configured.' };
    }

    const summary = `${eventData.serviceName} - ${eventData.customerName}`;
    const description = `Appointment booked via ONCEClic AI Receptionist.\n\nService: ${eventData.serviceName}\nCustomer: ${eventData.customerName}\nEmail: ${eventData.customerEmail}\nPhone: ${
      eventData.customerPhone || 'N/A'
    }\nNotes: ${eventData.notes || 'None'}\nAppointment ID: ${eventData.appointmentId || 'N/A'}`;

    const args: Record<string, any> = {
      summary,
      description,
      start: {
        dateTime: eventData.startTime,
        timeZone: eventData.timezone || 'UTC',
      },
      end: {
        dateTime: eventData.endTime,
        timeZone: eventData.timezone || 'UTC',
      },
      attendees: [
        {
          email: eventData.customerEmail,
          displayName: eventData.customerName,
        },
      ],
    };

    const execRes = await this.executeTool({
      organizationId,
      toolSlug: 'GOOGLECALENDAR_CREATE_EVENT',
      args,
    });

    if (execRes.success && execRes.data) {
      const eventId = execRes.data.id || execRes.data.event_id || execRes.data.eventId;
      return { success: true, eventId };
    }

    return { success: false, error: execRes.error || 'Failed to create Google Calendar event via Composio.' };
  }

  /**
   * Update an existing appointment event in Google Calendar.
   */
  static async updateCalendarEvent(
    organizationId: string,
    eventId: string,
    eventData: {
      serviceName?: string;
      customerName?: string;
      startTime: string;
      endTime: string;
      timezone?: string;
    }
  ): Promise<{ success: boolean; eventId?: string; error?: string }> {
    if (!this.isAvailable() || !eventId) {
      return { success: false, error: 'Composio is not configured or missing event ID.' };
    }

    const args: Record<string, any> = {
      event_id: eventId,
      eventId: eventId,
      start: {
        dateTime: eventData.startTime,
        timeZone: eventData.timezone || 'UTC',
      },
      end: {
        dateTime: eventData.endTime,
        timeZone: eventData.timezone || 'UTC',
      },
    };

    if (eventData.serviceName && eventData.customerName) {
      args.summary = `${eventData.serviceName} - ${eventData.customerName}`;
    }

    const execRes = await this.executeTool({
      organizationId,
      toolSlug: 'GOOGLECALENDAR_PATCH_EVENT',
      args,
    });

    if (execRes.success) {
      return { success: true, eventId };
    }

    return { success: false, error: execRes.error || 'Failed to update Google Calendar event.' };
  }

  /**
   * Delete an event from Google Calendar.
   */
  static async deleteCalendarEvent(
    organizationId: string,
    eventId: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.isAvailable() || !eventId) {
      return { success: false, error: 'Composio is not configured or missing event ID.' };
    }

    const execRes = await this.executeTool({
      organizationId,
      toolSlug: 'GOOGLECALENDAR_DELETE_EVENT',
      args: {
        event_id: eventId,
        eventId: eventId,
      },
    });

    return { success: execRes.success, error: execRes.error };
  }
}
