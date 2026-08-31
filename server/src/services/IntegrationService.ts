import { db } from '../db';
import { config } from '../config';
import {
  WebsiteConnectionConfig,
  EmailIntegrationConfig,
  IntegrationStatus,
  AuditAction,
} from '@onceclic/shared';
import { AuditService } from './AuditService';
import { v4 as uuidv4 } from 'uuid';

export class IntegrationService {
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
}
