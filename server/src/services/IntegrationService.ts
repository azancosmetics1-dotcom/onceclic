import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../db';
import { config } from '../config';
import {
  WebsiteConnectionConfig,
  EmailIntegrationConfig,
  GoogleCalendarConfig,
  IntegrationStatus,
  AuditAction,
} from '@onceclic/shared';
import { AuditService } from './AuditService';
import { v4 as uuidv4 } from 'uuid';

export class IntegrationService {
  // =========================================================================
  // 1. WEBSITE WIDGET INTEGRATION
  // =========================================================================

  /**
   * Get Website Connection configuration and public widget snippet.
   */
  static async getWebsiteConfig(organizationId: string): Promise<WebsiteConnectionConfig> {
    const org = await db.getOne(
      'SELECT id, name, slug FROM organizations WHERE id = $1',
      [organizationId]
    );

    if (!org) {
      throw new Error('Organization not found.');
    }

    const settings = await db.getOne(
      'SELECT website_chat_enabled, website_last_active_at, website_verified_at FROM business_settings WHERE organization_id = $1',
      [organizationId]
    );

    const isEnabled = settings ? !!settings.website_chat_enabled : true;
    const isVerified = settings ? !!settings.website_verified_at : false;
    const lastActivity = settings?.website_last_active_at || undefined;

    let status = IntegrationStatus.NOT_CONNECTED;
    if (!isEnabled) {
      status = IntegrationStatus.DISCONNECTED;
    } else if (isVerified || lastActivity) {
      status = IntegrationStatus.CONNECTED;
    }

    const publicUrl = config.app.url;
    const embedScriptSnippet = `<script\n  src="${publicUrl}/widget.js"\n  data-org="${org.slug}">\n</script>`;
    const publicChatUrl = `${publicUrl}/chat/${org.slug}`;

    return {
      orgSlug: org.slug,
      orgName: org.name,
      status,
      embedScriptSnippet,
      publicChatUrl,
      lastActivityAt: lastActivity,
      isVerified,
    };
  }

  /**
   * Safely verify website integration status.
   */
  static async verifyWebsite(
    organizationId: string,
    userId?: string,
    ipAddress?: string
  ): Promise<WebsiteConnectionConfig> {
    await AuditService.log({
      organizationId,
      userId,
      action: AuditAction.WEBSITE_VERIFICATION_STARTED,
      entityType: 'ORGANIZATION',
      entityId: organizationId,
      ipAddress,
    });

    await db.execute(
      `UPDATE business_settings
       SET website_verified_at = CURRENT_TIMESTAMP,
           website_last_active_at = CURRENT_TIMESTAMP,
           website_chat_enabled = TRUE,
           updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $1`,
      [organizationId]
    );

    await AuditService.log({
      organizationId,
      userId,
      action: AuditAction.WEBSITE_VERIFICATION_COMPLETED,
      entityType: 'ORGANIZATION',
      entityId: organizationId,
      ipAddress,
    });

    await AuditService.log({
      organizationId,
      userId,
      action: AuditAction.WEBSITE_CONNECTED,
      entityType: 'ORGANIZATION',
      entityId: organizationId,
      ipAddress,
    });

    return this.getWebsiteConfig(organizationId);
  }

  /**
   * Disconnect website widget.
   */
  static async disconnectWebsite(
    organizationId: string,
    userId?: string,
    ipAddress?: string
  ): Promise<WebsiteConnectionConfig> {
    await db.execute(
      `UPDATE business_settings
       SET website_chat_enabled = FALSE,
           updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $1`,
      [organizationId]
    );

    await AuditService.log({
      organizationId,
      userId,
      action: AuditAction.WEBSITE_DISCONNECTED,
      entityType: 'ORGANIZATION',
      entityId: organizationId,
      ipAddress,
    });

    return this.getWebsiteConfig(organizationId);
  }

  // =========================================================================
  // 2. EMAIL CHANNEL INTEGRATION
  // =========================================================================

  /**
   * Get Email Integration configuration and connection status.
   */
  static async getEmailConfig(organizationId: string): Promise<EmailIntegrationConfig> {
    const org = await db.getOne('SELECT slug FROM organizations WHERE id = $1', [organizationId]);
    const slug = org?.slug || 'business';

    let conn = await db.getOne(
      'SELECT id, provider_type, inbound_address, webhook_token, is_active, connected_email, status, last_synced_at FROM email_connections WHERE organization_id = $1',
      [organizationId]
    );

    if (!conn) {
      const webhookToken = uuidv4().replace(/-/g, '');
      const inboundAddress = `inbox+${slug}@onceclic.com`;
      await db.execute(
        `INSERT INTO email_connections (
           id, organization_id, provider_type, inbound_address, webhook_token, is_active, status, created_at, updated_at
         ) VALUES ($1, $2, 'WEBHOOK', $3, $4, FALSE, 'NOT_CONNECTED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [uuidv4(), organizationId, inboundAddress, webhookToken]
      );
      conn = await db.getOne(
        'SELECT id, provider_type, inbound_address, webhook_token, is_active, connected_email, status, last_synced_at FROM email_connections WHERE organization_id = $1',
        [organizationId]
      );
    }

    const isOAuthConfigured = !!process.env.EMAIL_OAUTH_CLIENT_ID;
    let status = (conn?.status as IntegrationStatus) || IntegrationStatus.NOT_CONNECTED;
    if (conn?.is_active && conn?.connected_email) {
      status = IntegrationStatus.CONNECTED;
    }

    return {
      status,
      connectedEmail: conn?.connected_email || undefined,
      inboundWebhookAddress: conn?.inbound_address || `inbox+${slug}@onceclic.com`,
      providerType: isOAuthConfigured ? 'OAUTH' : 'WEBHOOK',
      isOAuthConfigured,
      lastSyncedAt: conn?.last_synced_at || undefined,
    };
  }

  /**
   * Connect business email.
   */
  static async connectEmail(
    organizationId: string,
    emailAddress: string,
    userId?: string,
    ipAddress?: string
  ): Promise<EmailIntegrationConfig> {
    const cleanEmail = (emailAddress || '').toLowerCase().trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Please enter a valid business email address.');
    }

    await AuditService.log({
      organizationId,
      userId,
      action: AuditAction.EMAIL_CONNECTION_STARTED,
      entityType: 'ORGANIZATION',
      entityId: organizationId,
      metadata: { email: cleanEmail },
      ipAddress,
    });

    await db.execute(
      `UPDATE email_connections
       SET connected_email = $1,
           is_active = TRUE,
           status = 'CONNECTED',
           last_synced_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $2`,
      [cleanEmail, organizationId]
    );

    await AuditService.log({
      organizationId,
      userId,
      action: AuditAction.EMAIL_CONNECTED,
      entityType: 'ORGANIZATION',
      entityId: organizationId,
      metadata: { email: cleanEmail },
      ipAddress,
    });

    return this.getEmailConfig(organizationId);
  }

  /**
   * Disconnect business email.
   */
  static async disconnectEmail(
    organizationId: string,
    userId?: string,
    ipAddress?: string
  ): Promise<EmailIntegrationConfig> {
    await db.execute(
      `UPDATE email_connections
       SET is_active = FALSE,
           status = 'DISCONNECTED',
           updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $1`,
      [organizationId]
    );

    await AuditService.log({
      organizationId,
      userId,
      action: AuditAction.EMAIL_DISCONNECTED,
      entityType: 'ORGANIZATION',
      entityId: organizationId,
      ipAddress,
    });

    return this.getEmailConfig(organizationId);
  }

  // =========================================================================
  // 3. GOOGLE CALENDAR INTEGRATION
  // =========================================================================

  /**
   * Generate Google Calendar OAuth authorization URL with signed state token.
   */
  static getGoogleCalendarAuthUrl(organizationId: string, returnUrl?: string): { url: string; state: string } {
    if (!config.google.clientId) {
      throw new Error('Google OAuth is not configured on the server. Please provide GOOGLE_CLIENT_ID.');
    }

    const stateToken = jwt.sign(
      {
        csrf: crypto.randomBytes(16).toString('hex'),
        organizationId,
        returnUrl: returnUrl || '/app/integrations',
        type: 'google_calendar_oauth_state',
      },
      config.jwtSecret,
      { expiresIn: '15m' }
    );

    const redirectUri = config.google.calendarCallbackUrl;
    const scope = [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly',
      'openid',
      'email',
      'profile',
    ].join(' ');

    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
      config.google.clientId
    )}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(
      scope
    )}&access_type=offline&prompt=consent&state=${encodeURIComponent(stateToken)}`;

    return { url, state: stateToken };
  }

  /**
   * Handle Google Calendar OAuth authorization callback.
   */
  static async handleGoogleCalendarCallback(
    code: string,
    state: string,
    userId?: string,
    ipAddress?: string
  ): Promise<{ organizationId: string; returnUrl: string; summary: string }> {
    if (!code) {
      throw new Error('Authorization code is required.');
    }

    let decoded: any;
    try {
      decoded = jwt.verify(state, config.jwtSecret);
      if (decoded.type !== 'google_calendar_oauth_state' || !decoded.organizationId) {
        throw new Error('Invalid OAuth state type.');
      }
    } catch {
      throw new Error('Invalid or expired Google Calendar OAuth state parameter.');
    }

    const organizationId = decoded.organizationId;
    const returnUrl = decoded.returnUrl || '/app/integrations';

    if (!config.google.clientId || !config.google.clientSecret) {
      throw new Error('Google OAuth credentials not configured on server.');
    }

    // 1. Exchange code for access & refresh tokens
    const tokenParams = new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.google.calendarCallbackUrl,
      grant_type: 'authorization_code',
    });

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });

    const tokenData = (await tokenRes.json()) as any;
    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || 'Failed to exchange token with Google.');
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const expiresIn = tokenData.expires_in || 3600;
    const tokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();

    // 2. Fetch primary calendar metadata or user info
    let calendarSummary = 'Primary Google Calendar';
    try {
      const calRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList/primary', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (calRes.ok) {
        const calData = (await calRes.json()) as any;
        calendarSummary = calData.summary || calData.id || calendarSummary;
      }
    } catch {
      // Non-fatal, use default summary
    }

    // 3. Upsert calendar connection in database
    const existing = await db.getOne('SELECT id, refresh_token FROM calendar_connections WHERE organization_id = $1', [
      organizationId,
    ]);

    const finalRefreshToken = refreshToken || existing?.refresh_token;

    if (existing) {
      await db.execute(
        `UPDATE calendar_connections
         SET provider = 'GOOGLE_CALENDAR',
             calendar_id = 'primary',
             calendar_summary = $1,
             access_token = $2,
             refresh_token = COALESCE($3, refresh_token),
             token_expiry = $4,
             is_active = TRUE,
             last_synced_at = CURRENT_TIMESTAMP,
             error_message = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $5`,
        [calendarSummary, accessToken, finalRefreshToken || null, tokenExpiry, organizationId]
      );
    } else {
      await db.execute(
        `INSERT INTO calendar_connections (
           id, organization_id, provider, calendar_id, calendar_summary,
           access_token, refresh_token, token_expiry, is_active, last_synced_at, created_at, updated_at
         ) VALUES ($1, $2, 'GOOGLE_CALENDAR', 'primary', $3, $4, $5, $6, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [uuidv4(), organizationId, calendarSummary, accessToken, finalRefreshToken || null, tokenExpiry]
      );
    }

    await AuditService.log({
      organizationId,
      userId,
      action: AuditAction.GOOGLE_CALENDAR_CONNECTED,
      entityType: 'INTEGRATION',
      entityId: organizationId,
      metadata: { calendarSummary },
      ipAddress,
    });

    return { organizationId, returnUrl, summary: calendarSummary };
  }

  /**
   * Get Google Calendar integration status for an organization.
   */
  static async getGoogleCalendarConfig(organizationId: string): Promise<GoogleCalendarConfig> {
    const conn = await db.getOne(
      `SELECT id, provider, calendar_id as "calendarId", calendar_summary as "calendarSummary",
              is_active as "isActive", last_synced_at as "lastSyncedAt", error_message as "errorMessage"
       FROM calendar_connections WHERE organization_id = $1`,
      [organizationId]
    );

    const isConfigured = config.google.isConfigured;

    let status = IntegrationStatus.NOT_CONNECTED;
    if (conn) {
      status = conn.isActive ? IntegrationStatus.CONNECTED : IntegrationStatus.DISCONNECTED;
      if (conn.errorMessage) status = IntegrationStatus.ERROR;
    }

    return {
      status,
      connectedEmail: conn?.calendarSummary || undefined,
      calendarId: conn?.calendarId || undefined,
      calendarSummary: conn?.calendarSummary || undefined,
      isConfigured,
      lastSyncedAt: conn?.lastSyncedAt || undefined,
      errorMessage: conn?.errorMessage || undefined,
    };
  }

  /**
   * Disconnect Google Calendar integration.
   */
  static async disconnectGoogleCalendar(
    organizationId: string,
    userId?: string,
    ipAddress?: string
  ): Promise<GoogleCalendarConfig> {
    await db.execute(
      `UPDATE calendar_connections
       SET is_active = FALSE,
           access_token = NULL,
           refresh_token = NULL,
           error_message = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $1`,
      [organizationId]
    );

    await AuditService.log({
      organizationId,
      userId,
      action: AuditAction.GOOGLE_CALENDAR_DISCONNECTED,
      entityType: 'INTEGRATION',
      entityId: organizationId,
      ipAddress,
    });

    return this.getGoogleCalendarConfig(organizationId);
  }

  /**
   * Obtain a valid, refreshed access token for the organization's Google Calendar.
   */
  static async getValidAccessToken(organizationId: string): Promise<string | null> {
    const conn = await db.getOne(
      'SELECT id, access_token, refresh_token, token_expiry, is_active FROM calendar_connections WHERE organization_id = $1',
      [organizationId]
    );

    if (!conn || !conn.is_active) {
      return null;
    }

    const expiryMs = conn.token_expiry ? new Date(conn.token_expiry).getTime() : 0;
    const nowMs = Date.now();

    // If access token is still valid for more than 3 minutes, return it
    if (conn.access_token && expiryMs > nowMs + 3 * 60 * 1000) {
      return conn.access_token;
    }

    // Refresh token required
    if (!conn.refresh_token) {
      console.warn(`[Google Calendar] No refresh token available for org: ${organizationId}`);
      return conn.access_token || null;
    }

    try {
      const refreshParams = new URLSearchParams({
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        refresh_token: conn.refresh_token,
        grant_type: 'refresh_token',
      });

      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: refreshParams.toString(),
      });

      const data = (await res.json()) as any;
      if (!res.ok || !data.access_token) {
        console.error('[Google Calendar Token Refresh Error]', data);
        await db.execute('UPDATE calendar_connections SET error_message = $1 WHERE id = $2', [
          data.error_description || 'Token refresh failed',
          conn.id,
        ]);
        return null;
      }

      const newAccessToken = data.access_token;
      const expiresIn = data.expires_in || 3600;
      const newExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();

      await db.execute(
        'UPDATE calendar_connections SET access_token = $1, token_expiry = $2, error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        [newAccessToken, newExpiry, conn.id]
      );

      return newAccessToken;
    } catch (err: any) {
      console.error('[Google Calendar Refresh Exception]', err.message || err);
      return null;
    }
  }

  /**
   * Query Google Calendar FreeBusy API to fetch busy intervals for slot availability calculation.
   */
  static async getGoogleCalendarBusyPeriods(
    organizationId: string,
    timeMin: string, // ISO 8601
    timeMax: string  // ISO 8601
  ): Promise<Array<{ start: number; end: number }>> {
    const accessToken = await this.getValidAccessToken(organizationId);
    if (!accessToken) {
      return [];
    }

    try {
      const body = {
        timeMin,
        timeMax,
        items: [{ id: 'primary' }],
      };

      const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.warn('[Google Calendar FreeBusy Error]', errorData);
        return [];
      }

      const data = (await res.json()) as any;
      const busyList = data?.calendars?.primary?.busy || [];

      return busyList.map((item: any) => ({
        start: new Date(item.start).getTime(),
        end: new Date(item.end).getTime(),
      }));
    } catch (err: any) {
      console.warn('[Google Calendar FreeBusy Exception]', err.message || err);
      return [];
    }
  }

  /**
   * Create an event in Google Calendar upon confirmed appointment booking.
   */
  static async createGoogleCalendarEvent(
    organizationId: string,
    appointment: {
      id: string;
      customerName: string;
      customerEmail: string;
      customerPhone?: string;
      serviceName: string;
      startTime: string; // ISO
      endTime: string;   // ISO
      notes?: string;
      timezone?: string;
    }
  ): Promise<{ eventId?: string; success: boolean }> {
    const accessToken = await this.getValidAccessToken(organizationId);
    if (!accessToken) {
      return { success: false };
    }

    try {
      const eventPayload = {
        summary: `${appointment.serviceName} - ${appointment.customerName}`,
        description: `ONCEClic Booking Reference: ${appointment.id}\nCustomer: ${appointment.customerName} (${appointment.customerEmail})\nPhone: ${appointment.customerPhone || 'N/A'}\nNotes: ${appointment.notes || 'None'}`,
        start: {
          dateTime: appointment.startTime,
          timeZone: appointment.timezone || 'UTC',
        },
        end: {
          dateTime: appointment.endTime,
          timeZone: appointment.timezone || 'UTC',
        },
        attendees: [{ email: appointment.customerEmail, displayName: appointment.customerName }],
        reminders: {
          useDefault: true,
        },
      };

      const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventPayload),
      });

      const data = (await res.json()) as any;

      if (!res.ok || !data.id) {
        console.error('[Google Calendar Event Create Error]', data);
        await db.execute(
          "UPDATE appointments SET calendar_sync_status = 'FAILED', calendar_sync_error = $1 WHERE id = $2",
          [data?.error?.message || 'Failed to create Google Calendar event', appointment.id]
        );
        return { success: false };
      }

      await db.execute(
        "UPDATE appointments SET google_calendar_event_id = $1, calendar_sync_status = 'SYNCED', calendar_sync_error = NULL WHERE id = $2",
        [data.id, appointment.id]
      );

      await AuditService.log({
        organizationId,
        action: AuditAction.GOOGLE_CALENDAR_EVENT_CREATED,
        entityType: 'APPOINTMENT',
        entityId: appointment.id,
        metadata: { googleEventId: data.id },
      });

      return { eventId: data.id, success: true };
    } catch (err: any) {
      console.error('[Google Calendar Event Create Exception]', err.message || err);
      await db.execute(
        "UPDATE appointments SET calendar_sync_status = 'FAILED', calendar_sync_error = $1 WHERE id = $2",
        [err.message, appointment.id]
      );
      return { success: false };
    }
  }

  /**
   * Update an existing Google Calendar event upon appointment rescheduling.
   */
  static async updateGoogleCalendarEvent(
    organizationId: string,
    appointment: {
      id: string;
      googleCalendarEventId?: string;
      customerName: string;
      customerEmail: string;
      serviceName: string;
      startTime: string;
      endTime: string;
      timezone?: string;
    }
  ): Promise<boolean> {
    if (!appointment.googleCalendarEventId) {
      return false;
    }

    const accessToken = await this.getValidAccessToken(organizationId);
    if (!accessToken) {
      return false;
    }

    try {
      const eventPayload = {
        summary: `${appointment.serviceName} - ${appointment.customerName}`,
        start: {
          dateTime: appointment.startTime,
          timeZone: appointment.timezone || 'UTC',
        },
        end: {
          dateTime: appointment.endTime,
          timeZone: appointment.timezone || 'UTC',
        },
      };

      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(
          appointment.googleCalendarEventId
        )}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(eventPayload),
        }
      );

      if (res.ok) {
        await AuditService.log({
          organizationId,
          action: AuditAction.GOOGLE_CALENDAR_EVENT_UPDATED,
          entityType: 'APPOINTMENT',
          entityId: appointment.id,
          metadata: { googleEventId: appointment.googleCalendarEventId },
        });
        return true;
      }
      return false;
    } catch (err: any) {
      console.error('[Google Calendar Event Update Exception]', err.message || err);
      return false;
    }
  }

  /**
   * Delete an event from Google Calendar upon appointment cancellation.
   */
  static async deleteGoogleCalendarEvent(
    organizationId: string,
    googleCalendarEventId: string,
    appointmentId?: string
  ): Promise<boolean> {
    if (!googleCalendarEventId) {
      return false;
    }

    const accessToken = await this.getValidAccessToken(organizationId);
    if (!accessToken) {
      return false;
    }

    try {
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(
          googleCalendarEventId
        )}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (res.ok || res.status === 404 || res.status === 410) {
        await AuditService.log({
          organizationId,
          action: AuditAction.GOOGLE_CALENDAR_EVENT_DELETED,
          entityType: 'APPOINTMENT',
          entityId: appointmentId || googleCalendarEventId,
          metadata: { googleEventId: googleCalendarEventId },
        });
        return true;
      }
      return false;
    } catch (err: any) {
      console.error('[Google Calendar Event Delete Exception]', err.message || err);
      return false;
    }
  }
}
