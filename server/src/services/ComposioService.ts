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

export interface ComposioInstagramMessage {
  id: string;
  senderId: string;
  senderUsername?: string;
  recipientId?: string;
  text: string;
  timestamp?: string;
  isEcho?: boolean;
}

export interface ComposioFacebookMessage {
  id: string;
  senderId: string;
  senderName?: string;
  recipientId?: string;
  text: string;
  timestamp?: string;
  isEcho?: boolean;
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
   * Safely format and serialize any Composio error into a human-readable string without exposing credentials.
   */
  private static formatError(errorData: any, status?: number): string {
    if (!errorData) {
      return status ? `Composio API error HTTP ${status}` : 'Unknown Composio error';
    }
    if (typeof errorData === 'string') {
      return errorData;
    }
    if (typeof errorData === 'object') {
      if (typeof errorData.message === 'string' && errorData.message) {
        return errorData.message;
      }
      if (typeof errorData.error === 'string' && errorData.error) {
        return errorData.error;
      }
      if (errorData.error && typeof errorData.error === 'object') {
        if (typeof errorData.error.message === 'string' && errorData.error.message) {
          return errorData.error.message;
        }
        if (typeof errorData.error.detail === 'string' && errorData.error.detail) {
          return errorData.error.detail;
        }
      }
      if (typeof errorData.detail === 'string' && errorData.detail) {
        return errorData.detail;
      }
      if (Array.isArray(errorData.detail)) {
        return errorData.detail
          .map((d: any) => (typeof d === 'string' ? d : d.msg || d.message || JSON.stringify(d)))
          .join('; ');
      }
      if (Array.isArray(errorData.errors)) {
        return errorData.errors
          .map((d: any) => (typeof d === 'string' ? d : d.msg || d.message || JSON.stringify(d)))
          .join('; ');
      }
      try {
        return JSON.stringify(errorData);
      } catch {
        return String(errorData);
      }
    }
    return String(errorData);
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
        const errorMsg = this.formatError(responseData, res.status);
        console.error(`[ComposioService] API Error on ${options.method || 'GET'} ${cleanEndpoint}:`, {
          status: res.status,
          statusText: res.statusText,
          error: errorMsg,
          responseData: typeof responseData === 'object' ? JSON.stringify(responseData) : responseData,
        });
        return { ok: false, status: res.status, data: responseData, error: errorMsg };
      }

      return { ok: true, status: res.status, data: responseData };
    } catch (err: any) {
      console.error(`[ComposioService] Request exception to ${endpoint}:`, {
        name: err.name,
        message: err.message,
        code: err.code,
        stack: err.stack,
      });
      return { ok: false, status: 500, data: null as any, error: err.message || 'Network error connecting to Composio' };
    }
  }

  private static authConfigCache: Map<string, string> = new Map();

  /**
   * Resolve or provision the Composio Auth Config ID for a given toolkit/app.
   */
  static async getAuthConfigId(app: 'gmail' | 'googlecalendar' | 'instagram' | 'facebook'): Promise<string | null> {
    const targetSlug =
      app === 'googlecalendar'
        ? 'googlecalendar'
        : app === 'instagram'
        ? 'instagram'
        : app === 'facebook'
        ? 'facebook'
        : 'gmail';
    if (this.authConfigCache.has(targetSlug)) {
      return this.authConfigCache.get(targetSlug)!;
    }

    try {
      // 1. Try querying with toolkit_slug filter
      const res = await this.request<any>(`/v3.1/auth_configs?toolkit_slug=${targetSlug}`);
      let items: any[] = [];
      if (res.ok && res.data) {
        if (Array.isArray(res.data)) items = res.data;
        else if (Array.isArray(res.data.items)) items = res.data.items;
        else if (Array.isArray(res.data.data)) items = res.data.data;
      }

      // 2. If empty, query list of all auth configs
      if (items.length === 0) {
        const allRes = await this.request<any>('/v3.1/auth_configs?limit=100');
        if (allRes.ok && allRes.data) {
          if (Array.isArray(allRes.data)) items = allRes.data;
          else if (Array.isArray(allRes.data.items)) items = allRes.data.items;
          else if (Array.isArray(allRes.data.data)) items = allRes.data.data;
        }
      }

      if (items.length > 0) {
        const cleanTarget = targetSlug.replace(/[^a-z]/g, '');
        const match = items.find((cfg) => {
          const slug = (
            cfg.toolkit?.slug ||
            cfg.toolkit ||
            cfg.toolkit_slug ||
            cfg.appName ||
            cfg.name ||
            ''
          )
            .toLowerCase()
            .replace(/[^a-z]/g, '');
          return (
            slug === cleanTarget ||
            slug.includes(cleanTarget) ||
            (cleanTarget === 'googlecalendar' && slug.includes('calendar')) ||
            (cleanTarget === 'instagram' && (slug.includes('instagram') || slug.includes('meta_instagram'))) ||
            (cleanTarget === 'facebook' && (slug.includes('facebook') || slug.includes('meta_facebook')))
          );
        });

        // IMPORTANT: Only use a match if its slug actually matches the requested app.
        const configId = match?.id || match?.nanoid || match?.uuid || null;
        if (configId) {
          this.authConfigCache.set(targetSlug, configId);
          return configId;
        }
      }

      // 3. If no existing config found, provision a managed auth config for this toolkit
      const createRes = await this.request<any>('/v3.1/auth_configs', {
        method: 'POST',
        body: JSON.stringify({
          toolkit: {
            slug: targetSlug,
          },
          auth_config: {
            type: 'use_composio_managed_auth',
          },
        }),
      });

      if (createRes.ok && createRes.data) {
        const newId = createRes.data.id || createRes.data.nanoid || createRes.data.uuid || createRes.data.auth_config_id;
        if (newId) {
          this.authConfigCache.set(targetSlug, newId);
          return newId;
        }
      }
    } catch (err) {
      console.warn(`[ComposioService] Failed to resolve auth_configs for ${app}:`, err);
    }

    return null;
  }

  // =========================================================================
  // 1. CONNECTION MANAGEMENT (MANAGED OAUTH CONNECT LINKS)
  // =========================================================================

  /**
   * Initiate Composio Managed OAuth Connect Link for Gmail, Google Calendar, Instagram, or Facebook.
   */
  static async initiateConnection(params: {
    organizationId: string;
    app: 'gmail' | 'googlecalendar' | 'instagram' | 'facebook';
    callbackUrl: string;
  }): Promise<{ success: boolean; redirectUrl?: string; error?: string }> {
    const entityId = this.getEntityId(params.organizationId);
    const appSlug =
      params.app === 'googlecalendar'
        ? 'googlecalendar'
        : params.app === 'instagram'
        ? 'instagram'
        : params.app === 'facebook'
        ? 'facebook'
        : 'gmail';

    // 1. Resolve Auth Config ID if available
    const authConfigId = await this.getAuthConfigId(params.app);
    let lastError = '';

    // 2. Primary: Attempt v3.1 Auth Link Session with resolved auth_config_id
    if (authConfigId) {
      const v3Res = await this.request('/v3.1/connected_accounts/link', {
        method: 'POST',
        body: JSON.stringify({
          auth_config_id: authConfigId,
          user_id: entityId,
          callback_url: params.callbackUrl,
        }),
      });

      if (v3Res.ok && (v3Res.data?.redirect_url || v3Res.data?.redirectUrl || v3Res.data?.url || v3Res.data?.link)) {
        const redirectUrl =
          v3Res.data.redirect_url || v3Res.data.redirectUrl || v3Res.data.url || v3Res.data.link;
        return { success: true, redirectUrl };
      }
      if (v3Res.error) {
        lastError = v3Res.error;
      }
    }

    // 3. Secondary: Attempt v3.1 with app slug if auth config resolution didn't yield an ID
    if (!authConfigId) {
      const v3SlugRes = await this.request('/v3.1/connected_accounts/link', {
        method: 'POST',
        body: JSON.stringify({
          auth_config_id: appSlug,
          user_id: entityId,
          callback_url: params.callbackUrl,
        }),
      });

      if (v3SlugRes.ok && (v3SlugRes.data?.redirect_url || v3SlugRes.data?.redirectUrl || v3SlugRes.data?.url || v3SlugRes.data?.link)) {
        const redirectUrl =
          v3SlugRes.data.redirect_url || v3SlugRes.data.redirectUrl || v3SlugRes.data.url || v3SlugRes.data.link;
        return { success: true, redirectUrl };
      }
      if (v3SlugRes.error) {
        lastError = v3SlugRes.error;
      }
    }

    // 4. Tertiary: Fallback to legacy v1/connectedAccounts initiate
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
      lastError ||
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
    app: 'gmail' | 'googlecalendar' | 'instagram' | 'facebook'
  ): Promise<{
    isConnected: boolean;
    accountId?: string;
    email?: string;
    summary?: string;
    username?: string;
    pageName?: string;
    pageId?: string;
    status?: string;
    error?: string;
  }> {
    const entityId = this.getEntityId(organizationId);
    const appSlug =
      app === 'googlecalendar'
        ? 'googlecalendar'
        : app === 'instagram'
        ? 'instagram'
        : app === 'facebook'
        ? 'facebook'
        : 'gmail';

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
      const rawApp =
        acc.toolkit?.slug ||
        acc.auth_config?.toolkit?.slug ||
        (typeof acc.toolkit === 'string' ? acc.toolkit : '') ||
        acc.appName ||
        acc.app ||
        acc.auth_config_id ||
        acc.appUniqueId ||
        '';
      const accApp = String(rawApp)
        .toLowerCase()
        .replace(/[^a-z]/g, '');
      const targetApp = appSlug.toLowerCase().replace(/[^a-z]/g, '');
      return (
        accApp === targetApp ||
        accApp.includes(targetApp) ||
        (targetApp === 'googlecalendar' && (accApp.includes('calendar') || accApp.includes('googlescalendar'))) ||
        (targetApp === 'gmail' && accApp.includes('gmail')) ||
        (targetApp === 'instagram' && (accApp.includes('instagram') || accApp.includes('meta_instagram'))) ||
        (targetApp === 'facebook' && (accApp.includes('facebook') || accApp.includes('meta_facebook') || accApp.includes('fb')))
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

    const username =
      match.params?.username ||
      match.params?.instagram_username ||
      match.params?.screen_name ||
      match.data?.username ||
      match.metadata?.username ||
      match.username ||
      (email ? email.split('@')[0] : undefined);

    const pageName =
      match.params?.page_name ||
      match.params?.pageName ||
      match.data?.page_name ||
      match.metadata?.page_name ||
      match.params?.name ||
      match.pageName ||
      match.page_name ||
      username ||
      match.summary ||
      'Connected Facebook Page';

    const pageId =
      match.params?.page_id ||
      match.params?.pageId ||
      match.data?.page_id ||
      match.metadata?.page_id ||
      match.id ||
      match.nanoid;

    const summary =
      match.accountSummary ||
      match.params?.calendar_summary ||
      match.params?.page_name ||
      match.params?.username ||
      match.name ||
      pageName ||
      username ||
      email ||
      (app === 'gmail'
        ? 'Connected Gmail Account'
        : app === 'instagram'
        ? 'Connected Instagram Account'
        : app === 'facebook'
        ? 'Connected Facebook Page'
        : 'Primary Google Calendar');

    return {
      isConnected,
      accountId: match.id || match.nanoid || match.connected_account_id,
      email,
      username,
      pageName,
      pageId,
      summary,
      status,
    };
  }

  /**
   * Disconnect an account in Composio.
   */
  static async disconnectAccount(
    organizationId: string,
    app: 'gmail' | 'googlecalendar' | 'instagram' | 'facebook'
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

    const toolSlugs = ['GMAIL_FETCH_EMAILS', 'GMAIL_LIST_MESSAGES', 'GMAIL_USERS_MESSAGES_LIST'];
    let rawList: any[] = [];

    for (const slug of toolSlugs) {
      const execRes = await this.executeTool({
        organizationId,
        toolSlug: slug,
        args: {
          query: 'is:unread',
          q: 'is:unread',
          max_results: 15,
          maxResults: 15,
        },
      });

      if (execRes.success && execRes.data) {
        if (Array.isArray(execRes.data)) {
          rawList = execRes.data;
        } else if (Array.isArray(execRes.data.messages)) {
          rawList = execRes.data.messages;
        } else if (Array.isArray(execRes.data.emails)) {
          rawList = execRes.data.emails;
        } else if (Array.isArray(execRes.data.data)) {
          rawList = execRes.data.data;
        } else if (Array.isArray(execRes.data.items)) {
          rawList = execRes.data.items;
        }
        if (rawList.length > 0) break;
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
      recipient: params.toEmail,
      to: params.toEmail,
      subject: cleanSubject,
      body: params.body,
      message: params.body,
    };

    if (params.threadId) {
      args.thread_id = params.threadId;
      args.threadId = params.threadId;
    }
    if (params.inReplyToMessageId) {
      args.in_reply_to = params.inReplyToMessageId;
      args.inReplyTo = params.inReplyToMessageId;
    }

    const toolSlugs = ['GMAIL_SEND_EMAIL', 'GMAIL_USERS_MESSAGES_SEND', 'GMAIL_REPLY_TO_THREAD'];
    let lastError = '';

    for (const toolSlug of toolSlugs) {
      const execRes = await this.executeTool({
        organizationId: params.organizationId,
        toolSlug,
        args,
      });

      if (execRes.success) {
        const messageId = execRes.data?.id || execRes.data?.message_id || execRes.data?.messageId || 'sent_via_composio';
        return { success: true, messageId };
      }
      lastError = execRes.error || `Tool ${toolSlug} failed`;
    }

    return { success: false, error: lastError };
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

  // =========================================================================
  // 5. INSTAGRAM INTEGRATION ACTIONS (INBOUND DMs & OUTBOUND REPLIES)
  // =========================================================================

  /**
   * Fetch recent inbound Instagram direct messages for an organization.
   */
  static async fetchInstagramMessages(organizationId: string): Promise<ComposioInstagramMessage[]> {
    if (!this.isAvailable()) return [];

    const toolSlugs = [
      'INSTAGRAM_LIST_ALL_CONVERSATIONS',
      'INSTAGRAM_GET_PAGE_CONVERSATIONS',
      'INSTAGRAM_LIST_CONVERSATIONS',
      'INSTAGRAM_GET_CONVERSATIONS',
    ];

    let rawList: any[] = [];
    for (const slug of toolSlugs) {
      const execRes = await this.executeTool({
        organizationId,
        toolSlug: slug,
        args: {},
      });

      if (execRes.success && execRes.data) {
        if (Array.isArray(execRes.data)) {
          rawList = execRes.data;
        } else if (Array.isArray(execRes.data.data)) {
          rawList = execRes.data.data;
        } else if (Array.isArray(execRes.data.conversations)) {
          rawList = execRes.data.conversations;
        } else if (Array.isArray(execRes.data.messages)) {
          rawList = execRes.data.messages;
        } else if (Array.isArray(execRes.data.items)) {
          rawList = execRes.data.items;
        }
        if (rawList.length > 0) break;
      }
    }

    const parsedMessages: ComposioInstagramMessage[] = [];

    for (const item of rawList) {
      try {
        const id = item.id || item.message_id || item.mid || String(Date.now());
        const senderId = item.from?.id || item.sender_id || item.senderId || item.from || '';
        const senderUsername = item.from?.username || item.sender_username || item.username || undefined;
        const text = item.message || item.text || item.snippet || item.content || '';
        const isEcho = item.is_echo || item.from_me || item.role === 'AI' || false;

        if (senderId && text && !isEcho) {
          parsedMessages.push({
            id,
            senderId,
            senderUsername,
            recipientId: item.recipient_id || item.to?.id,
            text,
            timestamp: item.created_time || item.timestamp,
            isEcho: false,
          });
        }
      } catch (parseErr) {
        console.warn('[ComposioService] Error parsing Instagram message item:', parseErr);
      }
    }

    return parsedMessages;
  }

  /**
   * Send an Instagram direct message reply using Composio action INSTAGRAM_SEND_TEXT_MESSAGE.
   */
  static async sendInstagramReply(params: {
    organizationId: string;
    recipientId: string;
    text: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.isAvailable()) {
      return { success: false, error: 'Composio is not configured.' };
    }

    const args: Record<string, any> = {
      recipient_id: params.recipientId,
      recipientId: params.recipientId,
      recipient: { id: params.recipientId },
      message: { text: params.text },
      text: params.text,
    };

    const toolSlugs = [
      'INSTAGRAM_SEND_TEXT_MESSAGE',
      'INSTAGRAM_SEND_MESSAGE',
      'INSTAGRAM_CREATE_MESSAGE',
      'INSTAGRAM_MESSAGES_SEND',
    ];

    let lastError = '';
    for (const toolSlug of toolSlugs) {
      const execRes = await this.executeTool({
        organizationId: params.organizationId,
        toolSlug,
        args,
      });

      if (execRes.success) {
        const messageId =
          execRes.data?.id || execRes.data?.message_id || execRes.data?.mid || 'sent_via_composio_instagram';
        return { success: true, messageId };
      }
      lastError = execRes.error || `Tool ${toolSlug} failed`;
    }

    return { success: false, error: lastError || 'Failed to send Instagram reply.' };
  }

  // =========================================================================
  // 6. FACEBOOK INTEGRATION ACTIONS (PAGE MESSAGES & OUTBOUND REPLIES)
  // =========================================================================

  /**
   * Fetch recent inbound Facebook Page messages for an organization.
   */
  static async fetchFacebookMessages(organizationId: string): Promise<ComposioFacebookMessage[]> {
    if (!this.isAvailable()) return [];

    const toolSlugs = [
      'FACEBOOK_LIST_PAGE_CONVERSATIONS',
      'FACEBOOK_GET_PAGE_CONVERSATIONS',
      'FACEBOOK_LIST_CONVERSATIONS',
    ];

    let rawList: any[] = [];
    for (const slug of toolSlugs) {
      const execRes = await this.executeTool({
        organizationId,
        toolSlug: slug,
        args: {},
      });

      if (execRes.success && execRes.data) {
        if (Array.isArray(execRes.data)) {
          rawList = execRes.data;
        } else if (Array.isArray(execRes.data.data)) {
          rawList = execRes.data.data;
        } else if (Array.isArray(execRes.data.conversations)) {
          rawList = execRes.data.conversations;
        } else if (Array.isArray(execRes.data.messages)) {
          rawList = execRes.data.messages;
        } else if (Array.isArray(execRes.data.items)) {
          rawList = execRes.data.items;
        }
        if (rawList.length > 0) break;
      }
    }

    const parsedMessages: ComposioFacebookMessage[] = [];

    for (const item of rawList) {
      try {
        const id = item.id || item.message_id || item.mid || String(Date.now());
        const senderId = item.from?.id || item.sender_id || item.senderId || item.from || '';
        const senderName = item.from?.name || item.sender_name || item.name || undefined;
        const text = item.message || item.text || item.snippet || item.content || '';
        const isEcho = item.is_echo || item.from_me || item.role === 'AI' || false;

        if (senderId && text && !isEcho) {
          parsedMessages.push({
            id,
            senderId,
            senderName,
            recipientId: item.recipient_id || item.to?.id,
            text,
            timestamp: item.created_time || item.timestamp,
            isEcho: false,
          });
        }
      } catch (parseErr) {
        console.warn('[ComposioService] Error parsing Facebook message item:', parseErr);
      }
    }

    return parsedMessages;
  }

  /**
   * Send a Facebook Page message reply using Composio action FACEBOOK_SEND_PAGE_MESSAGE.
   */
  static async sendFacebookReply(params: {
    organizationId: string;
    recipientId: string;
    text: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.isAvailable()) {
      return { success: false, error: 'Composio is not configured.' };
    }

    const args: Record<string, any> = {
      recipient_id: params.recipientId,
      recipientId: params.recipientId,
      recipient: { id: params.recipientId },
      message: { text: params.text },
      text: params.text,
    };

    const toolSlugs = [
      'FACEBOOK_SEND_PAGE_MESSAGE',
      'FACEBOOK_SEND_MESSAGE',
      'FACEBOOK_POST_PAGE_MESSAGE',
      'FACEBOOK_MESSAGES_SEND',
    ];

    let lastError = '';
    for (const toolSlug of toolSlugs) {
      const execRes = await this.executeTool({
        organizationId: params.organizationId,
        toolSlug,
        args,
      });

      if (execRes.success) {
        const messageId =
          execRes.data?.id || execRes.data?.message_id || execRes.data?.mid || 'sent_via_composio_facebook';
        return { success: true, messageId };
      }
      lastError = execRes.error || `Tool ${toolSlug} failed`;
    }

    return { success: false, error: lastError || 'Failed to send Facebook message via Composio.' };
  }
}

