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
import { ComposioService } from './ComposioService';
import { encrypt, decrypt } from '../utils/crypto';
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
  // 2. EMAIL CHANNEL INTEGRATION (GOOGLE GMAIL OAUTH, SMTP/IMAP & FORWARDING)
  // =========================================================================

  /**
   * Get Email Integration configuration and connection status.
   */
  static async getEmailConfig(organizationId: string): Promise<EmailIntegrationConfig> {
    const org = await db.getOne('SELECT slug FROM organizations WHERE id = $1', [organizationId]);
    const slug = org?.slug || 'business';

    let conn = await db.getOne(
      'SELECT id, provider_type, inbound_address, webhook_token, is_active, connected_email, status, last_synced_at, error_message FROM email_connections WHERE organization_id = $1',
      [organizationId]
    );

    if (!conn) {
      const webhookToken = uuidv4().replace(/-/g, '');
      const inboundAddress = `inbox+${slug}@onceclic.com`;
      await db.execute(
        `INSERT INTO email_connections (
           id, organization_id, provider_type, inbound_address, webhook_token, is_active, status, created_at, updated_at
         ) VALUES ($1, $2, 'OAUTH', $3, $4, FALSE, 'NOT_CONNECTED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [uuidv4(), organizationId, inboundAddress, webhookToken]
      );
      conn = await db.getOne(
        'SELECT id, provider_type, inbound_address, webhook_token, is_active, connected_email, status, last_synced_at, error_message FROM email_connections WHERE organization_id = $1',
        [organizationId]
      );
    }

    // Check Composio status dynamically if configured
    if (ComposioService.isAvailable()) {
      try {
        const composioAccount = await ComposioService.getConnectedAccount(organizationId, 'gmail');
        if (composioAccount.isConnected) {
          const emailAddr = composioAccount.email || conn?.connected_email || 'Connected Gmail Account';
          if (!conn?.is_active || conn?.status !== 'CONNECTED' || !conn?.connected_email) {
            await db.execute(
              `UPDATE email_connections
               SET is_active = TRUE,
                   status = 'CONNECTED',
                   connected_email = $1,
                   provider_type = 'OAUTH',
                   error_message = NULL,
                   updated_at = CURRENT_TIMESTAMP
               WHERE organization_id = $2`,
              [emailAddr, organizationId]
            );
            conn = await db.getOne(
              'SELECT id, provider_type, inbound_address, webhook_token, is_active, connected_email, status, last_synced_at, error_message FROM email_connections WHERE organization_id = $1',
              [organizationId]
            );
          }
        }
      } catch (composioErr) {
        console.warn(`[IntegrationService] Error checking Composio email status for ${organizationId}:`, composioErr);
      }
    }

    const isOAuthConfigured = config.composio.isConfigured || config.google.isConfigured;
    let status = (conn?.status as IntegrationStatus) || IntegrationStatus.NOT_CONNECTED;
    if (conn?.is_active && conn?.connected_email && conn?.status === 'CONNECTED') {
      status = IntegrationStatus.CONNECTED;
    } else if (conn?.status === 'CONNECTING') {
      status = 'CONNECTING' as any;
    } else if (conn?.error_message) {
      status = IntegrationStatus.ERROR;
    } else if (!conn?.is_active && conn?.status === 'DISCONNECTED') {
      status = IntegrationStatus.DISCONNECTED;
    }

    return {
      status,
      connectedEmail: conn?.connected_email || undefined,
      inboundWebhookAddress: conn?.inbound_address || `inbox+${slug}@onceclic.com`,
      providerType: conn?.provider_type === 'OAUTH' ? 'OAUTH' : (isOAuthConfigured ? 'OAUTH' : 'WEBHOOK'),
      isOAuthConfigured,
      lastSyncedAt: conn?.last_synced_at || undefined,
      errorMessage: conn?.error_message || undefined,
    };
  }

  /**
   * Generate Google Email / Gmail OAuth authorization URL.
   * Prioritizes Composio Managed OAuth (no Google Cloud verification/billing required),
   * with fallback to direct Google OAuth if configured.
   */
  static async getGoogleEmailAuthUrl(
    organizationId: string,
    userId?: string,
    returnUrl?: string
  ): Promise<{ url: string; state: string }> {
    const effectiveReturnUrl = returnUrl || '/app/integrations';

    // 1. Primary: Composio Managed OAuth
    if (ComposioService.isAvailable()) {
      const callbackUrl = `${config.app.apiUrl}/api/integrations/composio/callback?app=gmail&returnUrl=${encodeURIComponent(
        effectiveReturnUrl
      )}&orgId=${encodeURIComponent(organizationId)}`;

      const composioRes = await ComposioService.initiateConnection({
        organizationId,
        app: 'gmail',
        callbackUrl,
      });

      if (composioRes.success && composioRes.redirectUrl) {
        // Set connection status to CONNECTING
        await db.execute(
          `UPDATE email_connections
           SET status = 'CONNECTING', error_message = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = $1`,
          [organizationId]
        );

        return {
          url: composioRes.redirectUrl,
          state: 'composio_managed',
        };
      }

      console.warn('[IntegrationService] Composio initiate failed, attempting Google OAuth fallback if available:', composioRes.error);
    }

    // 2. Secondary: Direct Google OAuth (if configured)
    if (!config.google.clientId) {
      throw new Error('Neither Composio nor Google OAuth is configured. Please provide COMPOSIO_API_KEY or GOOGLE_CLIENT_ID.');
    }

    // Generate cryptographically random secret and compute SHA-256 hash for database storage
    const randomSecret = crypto.randomBytes(32).toString('hex');
    const stateHash = crypto.createHash('sha256').update(randomSecret).digest('hex');
    const stateId = uuidv4();
    const effectiveUserId = userId || 'system';
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes validity

    // Store state record for one-time-use validation and replay protection
    await db.execute(
      `INSERT INTO oauth_states (
         id, state_hash, organization_id, user_id, provider, return_url, expires_at, created_at
       ) VALUES ($1, $2, $3, $4, 'GOOGLE_EMAIL', $5, $6, CURRENT_TIMESTAMP)`,
      [stateId, stateHash, organizationId, effectiveUserId, effectiveReturnUrl, expiresAt]
    );

    // Update connection status to CONNECTING
    await db.execute(
      `UPDATE email_connections
       SET status = 'CONNECTING', error_message = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $1`,
      [organizationId]
    );

    const stateToken = jwt.sign(
      {
        stateId,
        stateHash,
        secret: randomSecret,
        organizationId,
        userId: effectiveUserId,
        returnUrl: effectiveReturnUrl,
        type: 'google_email_oauth_state',
      },
      config.jwtSecret,
      { expiresIn: '15m' }
    );

    const redirectUri = config.google.emailCallbackUrl;
    const scope = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
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
   * Handle Google Email / Gmail OAuth authorization callback with strict state verification,
   * atomic consumption (replay defense), token encryption, and Gmail API capability testing.
   */
  static async handleGoogleEmailCallback(
    code: string,
    state: string,
    initiatingUserId?: string,
    ipAddress?: string
  ): Promise<{ organizationId: string; returnUrl: string; connectedEmail: string }> {
    if (!code) {
      throw new Error('Authorization code is required.');
    }
    if (!state) {
      throw new Error('Missing OAuth state parameter.');
    }

    // 1. Verify signed JWT state structure
    let decoded: any;
    try {
      decoded = jwt.verify(state, config.jwtSecret);
      if (decoded.type !== 'google_email_oauth_state' || !decoded.organizationId || !decoded.stateHash) {
        throw new Error('Invalid OAuth state payload format.');
      }
    } catch (jwtErr: any) {
      throw new Error(`Invalid or expired Google Email OAuth state signature: ${jwtErr.message}`);
    }

    const organizationId = decoded.organizationId;
    const returnUrl = decoded.returnUrl || '/app/integrations';

    // 2. Validate one-time-use state record in database
    const stateRecord = await db.getOne<{
      id: string;
      state_hash: string;
      organization_id: string;
      user_id: string;
      provider: string;
      expires_at: string;
      consumed_at: string | null;
    }>('SELECT * FROM oauth_states WHERE state_hash = $1', [decoded.stateHash]);

    if (!stateRecord) {
      throw new Error('OAuth state was not found. Possible CSRF or unauthorized callback attempt.');
    }

    if (stateRecord.consumed_at) {
      throw new Error('OAuth state has already been consumed. Replay attack blocked.');
    }

    if (new Date(stateRecord.expires_at).getTime() < Date.now()) {
      throw new Error('OAuth state has expired. Please initiate connection again.');
    }

    if (stateRecord.organization_id !== organizationId) {
      throw new Error('Tenant mismatch on OAuth state verification.');
    }

    if (
      initiatingUserId &&
      stateRecord.user_id !== 'system' &&
      stateRecord.user_id !== initiatingUserId
    ) {
      throw new Error('Initiating user mismatch on OAuth state verification.');
    }

    // 3. Atomically consume the state record to prevent race conditions / duplicate callback execution
    const consumedCount = await db.execute(
      'UPDATE oauth_states SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1 AND consumed_at IS NULL',
      [stateRecord.id]
    );

    if (consumedCount === 0) {
      throw new Error('OAuth state was already consumed in a concurrent transaction.');
    }

    if (!config.google.clientId || !config.google.clientSecret) {
      throw new Error('Google OAuth credentials not configured on server.');
    }

    await AuditService.log({
      organizationId,
      userId: stateRecord.user_id,
      action: AuditAction.EMAIL_CONNECTION_STARTED,
      entityType: 'ORGANIZATION',
      entityId: organizationId,
      ipAddress,
    });

    // 4. Exchange authorization code for access and refresh tokens
    const tokenParams = new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.google.emailCallbackUrl,
      grant_type: 'authorization_code',
    });

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });

    const tokenData = (await tokenRes.json()) as any;
    if (!tokenRes.ok || !tokenData.access_token) {
      const errMsg = tokenData.error_description || tokenData.error || 'Failed to exchange token with Google.';
      await db.execute(
        `UPDATE email_connections SET status = 'ERROR', error_message = $1, updated_at = CURRENT_TIMESTAMP WHERE organization_id = $2`,
        [errMsg, organizationId]
      );
      throw new Error(errMsg);
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const expiresIn = tokenData.expires_in || 3600;
    const tokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();

    // 5. Capability Test: Verify Mailbox Identity & Gmail API capability
    let connectedEmail = '';
    try {
      const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!profileRes.ok) {
        throw new Error(`Gmail API profile request failed with HTTP ${profileRes.status}`);
      }
      const profileData = (await profileRes.json()) as any;
      connectedEmail = (profileData.emailAddress || '').toLowerCase().trim();
      if (!connectedEmail) {
        throw new Error('No email address returned by Gmail profile.');
      }
    } catch (testErr: any) {
      const errMsg = `Gmail capability verification failed: ${testErr.message}`;
      await db.execute(
        `UPDATE email_connections SET status = 'ERROR', error_message = $1, updated_at = CURRENT_TIMESTAMP WHERE organization_id = $2`,
        [errMsg, organizationId]
      );
      throw new Error(errMsg);
    }

    // 6. Encrypt tokens at rest using AES-256-GCM before database insertion
    const encryptedAccessToken = encrypt(accessToken);
    const existing = await db.getOne<{ refresh_token: string }>(
      'SELECT refresh_token FROM email_connections WHERE organization_id = $1',
      [organizationId]
    );
    const encryptedRefreshToken = refreshToken ? encrypt(refreshToken) : existing?.refresh_token;

    // 7. Upsert verified email connection
    if (existing) {
      await db.execute(
        `UPDATE email_connections
         SET provider_type = 'OAUTH',
             connected_email = $1,
             access_token = $2,
             refresh_token = COALESCE($3, refresh_token),
             token_expiry = $4,
             is_active = TRUE,
             status = 'CONNECTED',
             error_message = NULL,
             last_synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $5`,
        [connectedEmail, encryptedAccessToken, encryptedRefreshToken || null, tokenExpiry, organizationId]
      );
    } else {
      const slugRes = await db.getOne('SELECT slug FROM organizations WHERE id = $1', [organizationId]);
      const inboundAddress = `inbox+${slugRes?.slug || 'business'}@onceclic.com`;
      const webhookToken = uuidv4().replace(/-/g, '');
      await db.execute(
        `INSERT INTO email_connections (
           id, organization_id, provider_type, inbound_address, webhook_token, connected_email,
           access_token, refresh_token, token_expiry, is_active, status, last_synced_at, created_at, updated_at
         ) VALUES ($1, $2, 'OAUTH', $3, $4, $5, $6, $7, $8, TRUE, 'CONNECTED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [uuidv4(), organizationId, inboundAddress, webhookToken, connectedEmail, encryptedAccessToken, encryptedRefreshToken || null, tokenExpiry]
      );
    }

    await AuditService.log({
      organizationId,
      userId: stateRecord.user_id,
      action: AuditAction.EMAIL_CONNECTED,
      entityType: 'ORGANIZATION',
      entityId: organizationId,
      metadata: { connectedEmail, provider: 'GOOGLE_GMAIL' },
      ipAddress,
    });

    return { organizationId, returnUrl, connectedEmail };
  }

  /**
   * Disconnect business email.
   */
  static async disconnectEmail(
    organizationId: string,
    userId?: string,
    ipAddress?: string
  ): Promise<EmailIntegrationConfig> {
    if (ComposioService.isAvailable()) {
      try {
        await ComposioService.disconnectAccount(organizationId, 'gmail');
      } catch (err) {
        console.warn(`[IntegrationService] Error disconnecting Composio email for ${organizationId}:`, err);
      }
    }

    await db.execute(
      `UPDATE email_connections
       SET is_active = FALSE,
           status = 'DISCONNECTED',
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
      action: AuditAction.EMAIL_DISCONNECTED,
      entityType: 'ORGANIZATION',
      entityId: organizationId,
      ipAddress,
    });

    return this.getEmailConfig(organizationId);
  }

  /**
   * Safely obtain a fresh Google Email / Gmail OAuth access token using stored encrypted refresh token.
   */
  static async getValidGoogleEmailAccessToken(organizationId: string): Promise<string | null> {
    const conn = await db.getOne<{
      access_token: string;
      refresh_token: string;
      token_expiry: string;
    }>(
      'SELECT access_token, refresh_token, token_expiry FROM email_connections WHERE organization_id = $1 AND is_active = TRUE',
      [organizationId]
    );

    if (!conn) return null;

    const now = Date.now();
    const expiry = conn.token_expiry ? new Date(conn.token_expiry).getTime() : 0;

    // Decrypt tokens before usage
    const decryptedAccessToken = conn.access_token ? decrypt(conn.access_token) : null;
    const decryptedRefreshToken = conn.refresh_token ? decrypt(conn.refresh_token) : null;

    // Return decrypted access token if still valid (> 2 minutes remaining)
    if (decryptedAccessToken && expiry > now + 2 * 60 * 1000) {
      return decryptedAccessToken;
    }

    // Refresh token required
    if (!decryptedRefreshToken || !config.google.clientId || !config.google.clientSecret) {
      return decryptedAccessToken;
    }

    try {
      const refreshParams = new URLSearchParams({
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        refresh_token: decryptedRefreshToken,
        grant_type: 'refresh_token',
      });

      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: refreshParams.toString(),
      });

      if (!res.ok) {
        console.warn(`[Gmail Token Refresh] Failed to refresh token for org ${organizationId}`);
        await db.execute(
          `UPDATE email_connections SET status = 'ERROR', error_message = 'OAuth token expired. Please reconnect your email.' WHERE organization_id = $1`,
          [organizationId]
        );
        return null;
      }

      const data = (await res.json()) as any;
      const newAccessToken = encrypt(data.access_token);
      const expiresIn = data.expires_in || 3600;
      const newTokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();

      await db.execute(
        `UPDATE email_connections
         SET access_token = $1, token_expiry = $2, error_message = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $3`,
        [newAccessToken, newTokenExpiry, organizationId]
      );

      return data.access_token;
    } catch (err: any) {
      console.error(`[Gmail Token Refresh] Exception refreshing token:`, err);
      return null;
    }
  }

  // =========================================================================
  // 3. GOOGLE CALENDAR INTEGRATION
  // =========================================================================

  /**
   * Generate Google Calendar OAuth authorization URL.
   * Prioritizes Composio Managed OAuth (no Google Cloud billing/verification required),
   * with fallback to direct Google OAuth.
   */
  static async getGoogleCalendarAuthUrl(
    organizationId: string,
    userId?: string,
    returnUrl?: string
  ): Promise<{ url: string; state: string }> {
    const effectiveReturnUrl = returnUrl || '/app/integrations';

    // 1. Primary: Composio Managed OAuth
    if (ComposioService.isAvailable()) {
      const callbackUrl = `${config.app.apiUrl}/api/integrations/composio/callback?app=googlecalendar&returnUrl=${encodeURIComponent(
        effectiveReturnUrl
      )}&orgId=${encodeURIComponent(organizationId)}`;

      const composioRes = await ComposioService.initiateConnection({
        organizationId,
        app: 'googlecalendar',
        callbackUrl,
      });

      if (composioRes.success && composioRes.redirectUrl) {
        return {
          url: composioRes.redirectUrl,
          state: 'composio_managed',
        };
      }

      console.warn('[IntegrationService] Composio initiate failed for calendar, attempting Google OAuth fallback:', composioRes.error);
    }

    // 2. Secondary: Direct Google OAuth (if configured)
    if (!config.google.clientId) {
      throw new Error('Neither Composio nor Google OAuth is configured. Please provide COMPOSIO_API_KEY or GOOGLE_CLIENT_ID.');
    }

    const randomSecret = crypto.randomBytes(32).toString('hex');
    const stateHash = crypto.createHash('sha256').update(randomSecret).digest('hex');
    const stateId = uuidv4();
    const effectiveUserId = userId || 'system';
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await db.execute(
      `INSERT INTO oauth_states (
         id, state_hash, organization_id, user_id, provider, return_url, expires_at, created_at
       ) VALUES ($1, $2, $3, $4, 'GOOGLE_CALENDAR', $5, $6, CURRENT_TIMESTAMP)`,
      [stateId, stateHash, organizationId, effectiveUserId, effectiveReturnUrl, expiresAt]
    );

    const stateToken = jwt.sign(
      {
        stateId,
        stateHash,
        secret: randomSecret,
        organizationId,
        userId: effectiveUserId,
        returnUrl: effectiveReturnUrl,
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
   * Handle Google Calendar OAuth authorization callback with one-time state consumption & encrypted token storage.
   */
  static async handleGoogleCalendarCallback(
    code: string,
    state: string,
    initiatingUserId?: string,
    ipAddress?: string
  ): Promise<{ organizationId: string; returnUrl: string; summary: string }> {
    if (!code) {
      throw new Error('Authorization code is required.');
    }
    if (!state) {
      throw new Error('Missing OAuth state parameter.');
    }

    let decoded: any;
    try {
      decoded = jwt.verify(state, config.jwtSecret);
      if (decoded.type !== 'google_calendar_oauth_state' || !decoded.organizationId || !decoded.stateHash) {
        throw new Error('Invalid OAuth state payload format.');
      }
    } catch (jwtErr: any) {
      throw new Error(`Invalid or expired Google Calendar OAuth state signature: ${jwtErr.message}`);
    }

    const organizationId = decoded.organizationId;
    const returnUrl = decoded.returnUrl || '/app/integrations';

    const stateRecord = await db.getOne<{
      id: string;
      state_hash: string;
      organization_id: string;
      user_id: string;
      expires_at: string;
      consumed_at: string | null;
    }>('SELECT * FROM oauth_states WHERE state_hash = $1', [decoded.stateHash]);

    if (!stateRecord) {
      throw new Error('OAuth state was not found. Possible CSRF attempt.');
    }
    if (stateRecord.consumed_at) {
      throw new Error('OAuth state has already been consumed.');
    }
    if (new Date(stateRecord.expires_at).getTime() < Date.now()) {
      throw new Error('OAuth state has expired.');
    }

    const consumedCount = await db.execute(
      'UPDATE oauth_states SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1 AND consumed_at IS NULL',
      [stateRecord.id]
    );

    if (consumedCount === 0) {
      throw new Error('OAuth state was already consumed in a concurrent transaction.');
    }

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

    // 2. Fetch primary calendar metadata
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
      // Non-fatal, fallback to default
    }

    // 3. Upsert encrypted calendar connection
    const encryptedAccessToken = encrypt(accessToken);
    const existing = await db.getOne('SELECT id, refresh_token FROM calendar_connections WHERE organization_id = $1', [
      organizationId,
    ]);

    const finalRefreshToken = refreshToken ? encrypt(refreshToken) : existing?.refresh_token;

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
        [calendarSummary, encryptedAccessToken, finalRefreshToken || null, tokenExpiry, organizationId]
      );
    } else {
      await db.execute(
        `INSERT INTO calendar_connections (
           id, organization_id, provider, calendar_id, calendar_summary,
           access_token, refresh_token, token_expiry, is_active, last_synced_at, created_at, updated_at
         ) VALUES ($1, $2, 'GOOGLE_CALENDAR', 'primary', $3, $4, $5, $6, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [uuidv4(), organizationId, calendarSummary, encryptedAccessToken, finalRefreshToken || null, tokenExpiry]
      );
    }

    await AuditService.log({
      organizationId,
      userId: stateRecord.user_id,
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
    let conn = await db.getOne(
      `SELECT id, provider, calendar_id as "calendarId", calendar_summary as "calendarSummary",
              is_active as "isActive", last_synced_at as "lastSyncedAt", error_message as "errorMessage"
       FROM calendar_connections WHERE organization_id = $1`,
      [organizationId]
    );

    // Check Composio calendar connection dynamically
    if (ComposioService.isAvailable()) {
      try {
        const composioAccount = await ComposioService.getConnectedAccount(organizationId, 'googlecalendar');
        if (composioAccount.isConnected) {
          const summary = composioAccount.summary || conn?.calendarSummary || 'Primary Google Calendar';
          if (!conn?.isActive) {
            if (conn) {
              await db.execute(
                `UPDATE calendar_connections
                 SET is_active = TRUE,
                     provider = 'GOOGLE_CALENDAR',
                     calendar_summary = $1,
                     error_message = NULL,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE organization_id = $2`,
                [summary, organizationId]
              );
            } else {
              await db.execute(
                `INSERT INTO calendar_connections (
                   id, organization_id, provider, calendar_id, calendar_summary,
                   is_active, last_synced_at, created_at, updated_at
                 ) VALUES ($1, $2, 'GOOGLE_CALENDAR', 'primary', $3, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [uuidv4(), organizationId, summary]
              );
            }
            conn = await db.getOne(
              `SELECT id, provider, calendar_id as "calendarId", calendar_summary as "calendarSummary",
                      is_active as "isActive", last_synced_at as "lastSyncedAt", error_message as "errorMessage"
               FROM calendar_connections WHERE organization_id = $1`,
              [organizationId]
            );
          }
        }
      } catch (composioErr) {
        console.warn(`[IntegrationService] Error checking Composio calendar status for ${organizationId}:`, composioErr);
      }
    }

    const isConfigured = config.composio.isConfigured || config.google.isConfigured;

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
    if (ComposioService.isAvailable()) {
      try {
        await ComposioService.disconnectAccount(organizationId, 'googlecalendar');
      } catch (err) {
        console.warn(`[IntegrationService] Error disconnecting Composio calendar for ${organizationId}:`, err);
      }
    }

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

    const decryptedAccessToken = conn.access_token ? decrypt(conn.access_token) : null;
    const decryptedRefreshToken = conn.refresh_token ? decrypt(conn.refresh_token) : null;

    // If access token is still valid for more than 3 minutes, return decrypted
    if (decryptedAccessToken && expiryMs > nowMs + 3 * 60 * 1000) {
      return decryptedAccessToken;
    }

    // Refresh token required
    if (!decryptedRefreshToken) {
      console.warn(`[Google Calendar] No refresh token available for org: ${organizationId}`);
      return decryptedAccessToken || null;
    }

    try {
      const refreshParams = new URLSearchParams({
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        refresh_token: decryptedRefreshToken,
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

      const newEncryptedAccessToken = encrypt(data.access_token);
      const expiresIn = data.expires_in || 3600;
      const newExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();

      await db.execute(
        'UPDATE calendar_connections SET access_token = $1, token_expiry = $2, error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        [newEncryptedAccessToken, newExpiry, conn.id]
      );

      return data.access_token;
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
    // 1. Primary: Composio Managed OAuth
    if (ComposioService.isAvailable()) {
      try {
        const busyPeriods = await ComposioService.getCalendarBusyPeriods(organizationId, timeMin, timeMax);
        if (busyPeriods && busyPeriods.length > 0) {
          return busyPeriods;
        }
      } catch (composioErr) {
        console.warn('[IntegrationService] Composio free-busy check notice:', composioErr);
      }
    }

    // 2. Secondary: Direct Google OAuth token fallback
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
      console.error('[Google Calendar FreeBusy Exception]', err.message || err);
      return [];
    }
  }

  /**
   * Insert a newly confirmed appointment as an Event in Google Calendar.
   */
  static async createGoogleCalendarEvent(
    param1:
      | string
      | {
          organizationId: string;
          appointmentId?: string;
          id?: string;
          serviceName: string;
          customerName: string;
          customerEmail: string;
          customerPhone?: string;
          startTime: string;
          endTime: string;
          notes?: string;
          timezone?: string;
        },
    param2?: {
      id?: string;
      appointmentId?: string;
      customerName: string;
      customerEmail: string;
      customerPhone?: string;
      serviceName: string;
      startTime: string;
      endTime: string;
      notes?: string;
      timezone?: string;
    }
  ): Promise<{ success: boolean; eventId?: string; error?: string }> {
    let organizationId = '';
    let appointmentId = '';
    let serviceName = '';
    let customerName = '';
    let customerEmail = '';
    let customerPhone = '';
    let startTime = '';
    let endTime = '';
    let notes = '';
    let timezone = 'UTC';

    if (typeof param1 === 'string') {
      organizationId = param1;
      appointmentId = param2?.appointmentId || param2?.id || '';
      serviceName = param2?.serviceName || '';
      customerName = param2?.customerName || '';
      customerEmail = param2?.customerEmail || '';
      customerPhone = param2?.customerPhone || '';
      startTime = param2?.startTime || '';
      endTime = param2?.endTime || '';
      notes = param2?.notes || '';
      timezone = param2?.timezone || 'UTC';
    } else {
      organizationId = param1.organizationId;
      appointmentId = param1.appointmentId || param1.id || '';
      serviceName = param1.serviceName;
      customerName = param1.customerName;
      customerEmail = param1.customerEmail;
      customerPhone = param1.customerPhone || '';
      startTime = param1.startTime;
      endTime = param1.endTime;
      notes = param1.notes || '';
      timezone = param1.timezone || 'UTC';
    }

    // 1. Primary: Composio Managed OAuth
    if (ComposioService.isAvailable()) {
      try {
        const composioRes = await ComposioService.createCalendarEvent(organizationId, {
          appointmentId,
          serviceName,
          customerName,
          customerEmail,
          customerPhone,
          startTime,
          endTime,
          notes,
          timezone,
        });

        if (composioRes.success && composioRes.eventId) {
          if (appointmentId) {
            await db.execute(
              'UPDATE appointments SET google_calendar_event_id = $1, calendar_sync_status = $2, calendar_sync_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
              [composioRes.eventId, 'SYNCED', appointmentId]
            );
          }

          await AuditService.log({
            organizationId,
            action: AuditAction.GOOGLE_CALENDAR_EVENT_CREATED,
            entityType: 'APPOINTMENT',
            entityId: appointmentId,
            metadata: { googleCalendarEventId: composioRes.eventId, serviceName, startTime, provider: 'COMPOSIO' },
          });

          return { success: true, eventId: composioRes.eventId };
        }
      } catch (composioErr) {
        console.warn('[IntegrationService] Composio create event error, trying direct OAuth fallback:', composioErr);
      }
    }

    // 2. Secondary: Direct Google OAuth token fallback
    const accessToken = await this.getValidAccessToken(organizationId);
    if (!accessToken) {
      return { success: false, error: 'Google Calendar not connected or token expired.' };
    }

    try {
      const eventPayload = {
        summary: `${serviceName} - ${customerName}`,
        description: `Appointment booked via ONCEClic AI Receptionist.\n\nService: ${serviceName}\nCustomer: ${customerName}\nEmail: ${customerEmail}\nPhone: ${
          customerPhone || 'N/A'
        }\nNotes: ${notes || 'None'}\nAppointment ID: ${appointmentId}`,
        start: {
          dateTime: startTime,
        },
        end: {
          dateTime: endTime,
        },
        attendees: [{ email: customerEmail, displayName: customerName }],
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

      if (!res.ok) {
        const errorMsg = data?.error?.message || 'Failed to create event in Google Calendar.';
        console.error('[Google Calendar Create Event Error]', data);
        if (appointmentId) {
          await db.execute(
            'UPDATE appointments SET calendar_sync_status = $1, calendar_sync_error = $2 WHERE id = $3',
            ['FAILED', errorMsg, appointmentId]
          );
        }
        return { success: false, error: errorMsg };
      }

      const eventId = data.id;

      if (appointmentId) {
        await db.execute(
          'UPDATE appointments SET google_calendar_event_id = $1, calendar_sync_status = $2, calendar_sync_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
          [eventId, 'SYNCED', appointmentId]
        );
      }

      await AuditService.log({
        organizationId,
        action: AuditAction.GOOGLE_CALENDAR_EVENT_CREATED,
        entityType: 'APPOINTMENT',
        entityId: appointmentId,
        metadata: { googleCalendarEventId: eventId, serviceName, startTime },
      });

      return { success: true, eventId };
    } catch (err: any) {
      console.error('[Google Calendar Create Event Exception]', err.message || err);
      return { success: false, error: err.message || 'Unknown calendar sync error' };
    }
  }

  /**
   * Update an existing appointment event in Google Calendar.
   */
  static async updateGoogleCalendarEvent(
    param1:
      | string
      | {
          organizationId: string;
          googleCalendarEventId: string;
          serviceName: string;
          customerName: string;
          customerEmail: string;
          startTime: string;
          endTime: string;
          notes?: string;
        },
    param2?: {
      id?: string;
      googleCalendarEventId: string;
      customerName: string;
      customerEmail: string;
      serviceName: string;
      startTime: string;
      endTime: string;
      notes?: string;
      timezone?: string;
    }
  ): Promise<{ success: boolean; eventId?: string; error?: string }> {
    let organizationId = '';
    let googleCalendarEventId = '';
    let serviceName = '';
    let customerName = '';
    let customerEmail = '';
    let startTime = '';
    let endTime = '';

    if (typeof param1 === 'string') {
      organizationId = param1;
      googleCalendarEventId = param2?.googleCalendarEventId || '';
      serviceName = param2?.serviceName || '';
      customerName = param2?.customerName || '';
      customerEmail = param2?.customerEmail || '';
      startTime = param2?.startTime || '';
      endTime = param2?.endTime || '';
    } else {
      organizationId = param1.organizationId;
      googleCalendarEventId = param1.googleCalendarEventId;
      serviceName = param1.serviceName;
      customerName = param1.customerName;
      customerEmail = param1.customerEmail;
      startTime = param1.startTime;
      endTime = param1.endTime;
    }

    // 1. Primary: Composio Managed OAuth
    if (ComposioService.isAvailable() && googleCalendarEventId) {
      try {
        const compRes = await ComposioService.updateCalendarEvent(organizationId, googleCalendarEventId, {
          serviceName,
          customerName,
          startTime,
          endTime,
        });
        if (compRes.success) {
          return { success: true, eventId: googleCalendarEventId };
        }
      } catch (compErr) {
        console.warn('[IntegrationService] Composio update event error:', compErr);
      }
    }

    // 2. Secondary: Direct Google OAuth token fallback
    const accessToken = await this.getValidAccessToken(organizationId);
    if (!accessToken || !googleCalendarEventId) {
      return { success: false, error: 'Google Calendar not connected or missing event ID.' };
    }

    try {
      const eventPayload = {
        summary: `${serviceName} - ${customerName}`,
        start: { dateTime: startTime },
        end: { dateTime: endTime },
      };

      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(googleCalendarEventId)}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(eventPayload),
        }
      );

      const data = (await res.json()) as any;
      if (!res.ok) {
        return { success: false, error: data?.error?.message || 'Failed to update Google Calendar event' };
      }

      return { success: true, eventId: data.id };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Delete or cancel an event in Google Calendar if an appointment is canceled.
   */
  static async deleteGoogleCalendarEvent(
    organizationId: string,
    appointmentId: string,
    googleCalendarEventId: string
  ): Promise<{ success: boolean; error?: string }> {
    // 1. Primary: Composio Managed OAuth
    if (ComposioService.isAvailable() && googleCalendarEventId) {
      try {
        const compRes = await ComposioService.deleteCalendarEvent(organizationId, googleCalendarEventId);
        if (compRes.success) {
          await AuditService.log({
            organizationId,
            action: AuditAction.GOOGLE_CALENDAR_EVENT_DELETED,
            entityType: 'APPOINTMENT',
            entityId: appointmentId,
            metadata: { googleCalendarEventId, provider: 'COMPOSIO' },
          });
          return { success: true };
        }
      } catch (compErr) {
        console.warn('[IntegrationService] Composio delete event error:', compErr);
      }
    }

    // 2. Secondary: Direct Google OAuth token fallback
    const accessToken = await this.getValidAccessToken(organizationId);
    if (!accessToken || !googleCalendarEventId) {
      return { success: false, error: 'Cannot delete event: no access token or event ID.' };
    }

    try {
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(
          googleCalendarEventId
        )}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!res.ok && res.status !== 404 && res.status !== 410) {
        const data = await res.json().catch(() => ({}));
        console.warn('[Google Calendar Delete Event Error]', data);
        return { success: false, error: 'Failed to delete event from Google Calendar.' };
      }

      await AuditService.log({
        organizationId,
        action: AuditAction.GOOGLE_CALENDAR_EVENT_DELETED,
        entityType: 'APPOINTMENT',
        entityId: appointmentId,
        metadata: { googleCalendarEventId },
      });

      return { success: true };
    } catch (err: any) {
      console.error('[Google Calendar Delete Event Exception]', err.message || err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Handle Composio OAuth callback return, verify account status, update DB, and log audit action.
   */
  static async handleComposioCallback(params: {
    app: 'gmail' | 'googlecalendar';
    orgId: string;
    returnUrl?: string;
    ipAddress?: string;
  }): Promise<{ returnUrl: string; connectedItem?: string }> {
    const { app, orgId, returnUrl, ipAddress } = params;
    const effectiveReturnUrl = returnUrl || '/app/integrations';

    if (!orgId) {
      return { returnUrl: effectiveReturnUrl };
    }

    try {
      const account = await ComposioService.getConnectedAccount(orgId, app);

      if (app === 'gmail') {
        const emailAddr = account.email || 'Connected Gmail Account';
        await db.execute(
          `UPDATE email_connections
           SET is_active = TRUE,
               status = 'CONNECTED',
               connected_email = $1,
               provider_type = 'OAUTH',
               error_message = NULL,
               last_synced_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = $2`,
          [emailAddr, orgId]
        );

        await AuditService.log({
          organizationId: orgId,
          action: AuditAction.EMAIL_CONNECTED,
          entityType: 'ORGANIZATION',
          entityId: orgId,
          metadata: { connectedEmail: emailAddr, provider: 'COMPOSIO_MANAGED' },
          ipAddress,
        });

        return { returnUrl: effectiveReturnUrl, connectedItem: emailAddr };
      } else {
        const summary = account.summary || 'Primary Google Calendar';
        const existing = await db.getOne('SELECT id FROM calendar_connections WHERE organization_id = $1', [orgId]);

        if (existing) {
          await db.execute(
            `UPDATE calendar_connections
             SET is_active = TRUE,
                 provider = 'GOOGLE_CALENDAR',
                 calendar_summary = $1,
                 error_message = NULL,
                 last_synced_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = $2`,
            [summary, orgId]
          );
        } else {
          await db.execute(
            `INSERT INTO calendar_connections (
               id, organization_id, provider, calendar_id, calendar_summary,
               is_active, last_synced_at, created_at, updated_at
             ) VALUES ($1, $2, 'GOOGLE_CALENDAR', 'primary', $3, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [uuidv4(), orgId, summary]
          );
        }

        await AuditService.log({
          organizationId: orgId,
          action: AuditAction.GOOGLE_CALENDAR_CONNECTED,
          entityType: 'INTEGRATION',
          entityId: orgId,
          metadata: { calendarSummary: summary, provider: 'COMPOSIO_MANAGED' },
          ipAddress,
        });

        return { returnUrl: effectiveReturnUrl, connectedItem: summary };
      }
    } catch (err: any) {
      console.error('[IntegrationService] Error handling Composio callback:', err);
      return { returnUrl: effectiveReturnUrl };
    }
  }
}
