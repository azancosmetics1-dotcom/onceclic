import crypto from 'crypto';
import { db } from '../db';
import { config } from '../config';
import { ConversationChannel, AuditAction } from '@onceclic/shared';
import { ComposioService } from './ComposioService';
import { InboundChannelService } from './InboundChannelService';
import { AuditService } from './AuditService';
import { v4 as uuidv4 } from 'uuid';

export interface ComposioTriggerType {
  slug: string;
  name?: string;
  description?: string;
  toolkit?: string;
  configSchema?: Record<string, any>;
  payloadSchema?: Record<string, any>;
}

export interface ComposioTriggerInstance {
  id: string;
  triggerId: string;
  triggerSlug: string;
  organizationId: string;
  connectedAccountId?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ERROR';
  createdAt?: string;
}

export interface ProvisionTriggerResult {
  success: boolean;
  triggerId?: string;
  triggerSlug?: string;
  isReused?: boolean;
  error?: string;
}

export interface WebhookVerificationResult {
  isValid: boolean;
  error?: string;
}

export interface ComposioWebhookPayload {
  id?: string;
  type?: string;
  event?: string;
  timestamp?: string;
  metadata?: {
    trigger_slug?: string;
    trigger_id?: string;
    connected_account_id?: string;
    user_id?: string;
    app?: string;
    [key: string]: any;
  };
  data?: Record<string, any>;
}

/**
 * Centralized Composio Inbound Trigger Provisioning, Webhook Registration,
 * Signature Verification & Channel Dispatch Service.
 */
export class ComposioTriggerService {
  private static cachedTriggerSlugs: Map<string, string> = new Map();

  // Canonical fallback slugs verified against Composio catalog
  private static readonly FALLBACK_SLUGS: Record<string, string> = {
    gmail: 'GMAIL_NEW_GMAIL_MESSAGE',
    instagram: 'INSTAGRAM_RECEIVE_DIRECT_MESSAGE',
    facebook: 'FACEBOOK_RECEIVE_MESSAGE',
  };

  /**
   * Safe helper to make authenticated requests to Composio API v3.1 / v3.
   */
  private static async request<T = any>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<{ ok: boolean; status: number; data: T; error?: string }> {
    if (!ComposioService.isAvailable()) {
      return {
        ok: false,
        status: 400,
        data: null as any,
        error: 'COMPOSIO_API_KEY is not configured on the server.',
      };
    }

    const baseUrl = (config.composio.baseUrl || 'https://backend.composio.dev/api').replace(/\/+$/, '');
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = `${baseUrl}${cleanEndpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': config.composio.apiKey,
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
          responseData?.error?.message ||
          responseData?.error ||
          responseData?.detail ||
          `Composio HTTP ${res.status}`;
        console.warn(`[ComposioTriggerService] API Error on ${options.method || 'GET'} ${cleanEndpoint}:`, errorMsg);
        return { ok: false, status: res.status, data: responseData, error: String(errorMsg) };
      }

      return { ok: true, status: res.status, data: responseData };
    } catch (err: any) {
      console.warn(`[ComposioTriggerService] Network error connecting to ${cleanEndpoint}:`, err.message || err);
      return { ok: false, status: 500, data: null as any, error: err.message || 'Network error connecting to Composio' };
    }
  }

  // =========================================================================
  // 1. TRIGGER TYPE DISCOVERY
  // =========================================================================

  /**
   * Discover available trigger types from Composio API catalog.
   */
  static async discoverTriggerTypes(toolkitSlug?: string): Promise<ComposioTriggerType[]> {
    if (!ComposioService.isAvailable()) {
      return [];
    }

    const discovered: ComposioTriggerType[] = [];

    // Attempt various Composio v3.1 / v3 trigger discovery endpoints
    const endpoints = toolkitSlug
      ? [
          `/v3.1/trigger_types?toolkit_slug=${encodeURIComponent(toolkitSlug)}`,
          `/v3.1/triggers/types?toolkit_slug=${encodeURIComponent(toolkitSlug)}`,
          `/v3.1/triggers?toolkit_slug=${encodeURIComponent(toolkitSlug)}`,
          `/v3.1/toolkits/${encodeURIComponent(toolkitSlug)}/triggers`,
        ]
      : ['/v3.1/trigger_types', '/v3.1/triggers/types', '/v3.1/triggers'];

    for (const ep of endpoints) {
      const res = await this.request<any>(ep, { method: 'GET' });
      if (res.ok && res.data) {
        let items: any[] = [];
        if (Array.isArray(res.data)) items = res.data;
        else if (Array.isArray(res.data.items)) items = res.data.items;
        else if (Array.isArray(res.data.data)) items = res.data.data;
        else if (Array.isArray(res.data.triggers)) items = res.data.triggers;

        for (const item of items) {
          const slug = item.slug || item.trigger_slug || item.name || item.id;
          if (slug && typeof slug === 'string') {
            discovered.push({
              slug,
              name: item.name || slug,
              description: item.description,
              toolkit: item.toolkit?.slug || item.toolkit_slug || item.toolkit || toolkitSlug,
              configSchema: item.config_schema || item.configSchema,
              payloadSchema: item.payload_schema || item.payloadSchema,
            });
          }
        }

        if (discovered.length > 0) break;
      }
    }

    return discovered;
  }

  /**
   * Resolve exact trigger slug for an application, checking cache, live catalog, or fallback.
   */
  static async getTriggerSlugForApp(app: 'gmail' | 'instagram' | 'facebook'): Promise<string> {
    const cached = this.cachedTriggerSlugs.get(app);
    if (cached) return cached;

    const catalog = await this.discoverTriggerTypes(app);
    if (catalog.length > 0) {
      if (app === 'gmail') {
        const match = catalog.find(
          (t) =>
            t.slug.includes('GMAIL') &&
            (t.slug.includes('NEW') || t.slug.includes('MESSAGE') || t.slug.includes('EMAIL') || t.slug.includes('INBOUND'))
        );
        if (match) {
          this.cachedTriggerSlugs.set(app, match.slug);
          return match.slug;
        }
      } else if (app === 'instagram') {
        const match = catalog.find(
          (t) =>
            t.slug.includes('INSTAGRAM') &&
            (t.slug.includes('DIRECT') || t.slug.includes('MESSAGE') || t.slug.includes('RECEIVE') || t.slug.includes('DM'))
        );
        if (match) {
          this.cachedTriggerSlugs.set(app, match.slug);
          return match.slug;
        }
      } else if (app === 'facebook') {
        const match = catalog.find(
          (t) =>
            t.slug.includes('FACEBOOK') &&
            (t.slug.includes('MESSAGE') || t.slug.includes('RECEIVE') || t.slug.includes('PAGE'))
        );
        if (match) {
          this.cachedTriggerSlugs.set(app, match.slug);
          return match.slug;
        }
      }
    }

    // Fallback to verified canonical slugs
    const fallback = this.FALLBACK_SLUGS[app];
    this.cachedTriggerSlugs.set(app, fallback);
    return fallback;
  }

  // =========================================================================
  // 2. IDEMPOTENT TRIGGER PROVISIONING
  // =========================================================================

  /**
   * Provision or upsert a trigger instance for a connected account.
   * Fully idempotent: will never create duplicate triggers on repeated callbacks.
   */
  /**
   * Query Composio API for a real active remote trigger instance for this connected account.
   */
  static async getRemoteTriggerInstance(
    connectedAccountId: string,
    triggerSlug: string
  ): Promise<{ exists: boolean; triggerId?: string; status?: string; raw?: any }> {
    if (!ComposioService.isAvailable()) {
      return { exists: false };
    }

    try {
      const listRes = await this.request<any>(
        `/v3.1/trigger_instances?connected_account_id=${encodeURIComponent(connectedAccountId)}`,
        { method: 'GET' }
      );

      let remoteInstances: any[] = [];
      if (listRes.ok && listRes.data) {
        if (Array.isArray(listRes.data)) remoteInstances = listRes.data;
        else if (Array.isArray(listRes.data.items)) remoteInstances = listRes.data.items;
        else if (Array.isArray(listRes.data.data)) remoteInstances = listRes.data.data;
        else if (Array.isArray(listRes.data.trigger_instances)) remoteInstances = listRes.data.trigger_instances;
      }

      const match = remoteInstances.find(
        (inst) =>
          (inst.trigger_slug === triggerSlug || inst.slug === triggerSlug || inst.trigger_name === triggerSlug) &&
          (inst.status === 'ACTIVE' || inst.status === 'ENABLED' || !inst.status)
      );

      if (match) {
        const triggerId = match.id || match.trigger_id || match.trigger_instance_id;
        return {
          exists: true,
          triggerId,
          status: match.status || 'ACTIVE',
          raw: match,
        };
      }
    } catch (err: any) {
      console.warn('[ComposioTriggerService] Remote trigger check notice:', err.message || err);
    }

    return { exists: false };
  }

  /**
   * Provision or upsert a trigger instance for a connected account.
   * Fully idempotent: will never create duplicate triggers on repeated callbacks.
   * Only marks status as ACTIVE after the remote Composio trigger is confirmed active.
   */
  static async provisionTriggerForConnection(params: {
    organizationId: string;
    app: 'gmail' | 'instagram' | 'facebook';
    connectedAccountId: string;
    config?: Record<string, any>;
  }): Promise<ProvisionTriggerResult> {
    const { organizationId, app, connectedAccountId } = params;

    if (!organizationId) {
      return { success: false, error: 'Organization ID is required.' };
    }
    if (!connectedAccountId) {
      return { success: false, error: 'Connected account ID is required to provision trigger.' };
    }

    if (!ComposioService.isAvailable()) {
      return {
        success: false,
        error: 'COMPOSIO_API_KEY is not configured on the server.',
      };
    }

    const triggerSlug = await this.getTriggerSlugForApp(app);
    const entityId = ComposioService.getEntityId(organizationId);

    // 1. First, check Composio API for an active remote trigger instance
    const remoteCheck = await this.getRemoteTriggerInstance(connectedAccountId, triggerSlug);
    if (remoteCheck.exists && remoteCheck.triggerId) {
      console.log(`[ComposioTriggerService] Verified active remote trigger instance ${remoteCheck.triggerId} for ${app} (org ${organizationId})`);
      await this.recordLocalTriggerInstance(organizationId, app, triggerSlug, remoteCheck.triggerId, connectedAccountId);
      await this.updateConnectionAutomationStatus(organizationId, app, connectedAccountId, remoteCheck.triggerId, 'AUTOMATION_READY');
      return {
        success: true,
        triggerId: remoteCheck.triggerId,
        triggerSlug,
        isReused: true,
      };
    }

    // 3. Upsert trigger instance in Composio
    try {
      const upsertBody = {
        connected_account_id: connectedAccountId,
        user_id: entityId,
        config: params.config || {},
      };

      // Try v3.1 upsert endpoint
      let upsertRes = await this.request<any>(
        `/v3.1/trigger_instances/${encodeURIComponent(triggerSlug)}/upsert`,
        {
          method: 'POST',
          body: JSON.stringify(upsertBody),
        }
      );

      // Fallback: try POST /v3.1/trigger_instances if upsert endpoint returned 404
      if (!upsertRes.ok && upsertRes.status === 404) {
        upsertRes = await this.request<any>('/v3.1/trigger_instances', {
          method: 'POST',
          body: JSON.stringify({
            trigger_slug: triggerSlug,
            ...upsertBody,
          }),
        });
      }

      if (upsertRes.ok && upsertRes.data) {
        const triggerId =
          upsertRes.data.id ||
          upsertRes.data.trigger_id ||
          upsertRes.data.trigger_instance_id ||
          upsertRes.data.data?.id ||
          `ti_${Date.now()}`;

        console.log(`[ComposioTriggerService] Successfully provisioned trigger ${triggerSlug} (ID: ${triggerId}) for org ${organizationId}`);

        await this.recordLocalTriggerInstance(organizationId, app, triggerSlug, triggerId, connectedAccountId);
        await this.updateConnectionAutomationStatus(organizationId, app, connectedAccountId, triggerId, 'AUTOMATION_READY');

        await AuditService.log({
          organizationId,
          action: AuditAction.COMPOSIO_TRIGGER_PROVISIONED,
          entityType: 'INTEGRATION',
          entityId: triggerId,
          metadata: { app, triggerSlug, connectedAccountId },
        });

        return {
          success: true,
          triggerId,
          triggerSlug,
          isReused: false,
        };
      }

      const errMsg = upsertRes.error || `Failed to provision trigger ${triggerSlug} in Composio.`;
      console.warn(`[ComposioTriggerService] Trigger provisioning failure for ${app}:`, errMsg);
      await this.updateConnectionAutomationStatus(
        organizationId,
        app,
        connectedAccountId,
        undefined,
        'SETTING_UP_AUTOMATION',
        'Connected, but message automation setup is still completing.'
      );

      return {
        success: false,
        error: 'Connected, but message automation setup is still completing.',
      };
    } catch (err: any) {
      console.error(`[ComposioTriggerService] Exception provisioning trigger for ${app}:`, err);
      await this.updateConnectionAutomationStatus(
        organizationId,
        app,
        connectedAccountId,
        undefined,
        'SETTING_UP_AUTOMATION',
        'Connected, but message automation setup is still completing.'
      );

      return {
        success: false,
        error: 'Connected, but message automation setup is still completing.',
      };
    }
  }

  static async provisionGmailTrigger(organizationId: string, connectedAccountId: string): Promise<ProvisionTriggerResult> {
    return this.provisionTriggerForConnection({ organizationId, app: 'gmail', connectedAccountId });
  }

  static async provisionInstagramTrigger(organizationId: string, connectedAccountId: string): Promise<ProvisionTriggerResult> {
    return this.provisionTriggerForConnection({ organizationId, app: 'instagram', connectedAccountId });
  }

  static async provisionFacebookTrigger(organizationId: string, connectedAccountId: string): Promise<ProvisionTriggerResult> {
    return this.provisionTriggerForConnection({ organizationId, app: 'facebook', connectedAccountId });
  }

  /**
   * Helper to persist local trigger instance record in DB.
   */
  private static async recordLocalTriggerInstance(
    organizationId: string,
    app: string,
    triggerSlug: string,
    triggerId: string,
    connectedAccountId: string
  ): Promise<void> {
    try {
      const existing = await db.getOne<{ id: string }>(
        'SELECT id FROM composio_trigger_instances WHERE connected_account_id = $1 AND trigger_slug = $2',
        [connectedAccountId, triggerSlug]
      );

      if (existing) {
        await db.execute(
          `UPDATE composio_trigger_instances
           SET trigger_id = $1, status = 'ACTIVE', error_message = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [triggerId, existing.id]
        );
      } else {
        await db.execute(
          `INSERT INTO composio_trigger_instances (
             id, organization_id, app, trigger_slug, trigger_id, connected_account_id, status, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [uuidv4(), organizationId, app, triggerSlug, triggerId, connectedAccountId]
        );
      }
    } catch (err) {
      console.warn('[ComposioTriggerService] Error recording local trigger instance:', err);
    }
  }

  /**
   * Helper to update channel connection table automation status safely.
   */
  private static async updateConnectionAutomationStatus(
    organizationId: string,
    app: string,
    connectedAccountId: string,
    triggerId?: string,
    automationStatus: string = 'AUTOMATION_READY',
    errorMessage?: string
  ): Promise<void> {
    try {
      if (app === 'gmail') {
        await db.execute(
          `UPDATE email_connections
           SET composio_connected_account_id = COALESCE($1, composio_connected_account_id),
               trigger_id = COALESCE($2, trigger_id),
               automation_status = $3,
               error_message = COALESCE($4, error_message),
               updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = $5`,
          [connectedAccountId, triggerId || null, automationStatus, errorMessage || null, organizationId]
        );
      } else if (app === 'instagram') {
        await db.execute(
          `UPDATE instagram_connections
           SET composio_connected_account_id = COALESCE($1, composio_connected_account_id),
               trigger_id = COALESCE($2, trigger_id),
               automation_status = $3,
               error_message = COALESCE($4, error_message),
               updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = $5`,
          [connectedAccountId, triggerId || null, automationStatus, errorMessage || null, organizationId]
        );
      } else if (app === 'facebook') {
        await db.execute(
          `UPDATE facebook_connections
           SET composio_connected_account_id = COALESCE($1, composio_connected_account_id),
               trigger_id = COALESCE($2, trigger_id),
               automation_status = $3,
               error_message = COALESCE($4, error_message),
               updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = $5`,
          [connectedAccountId, triggerId || null, automationStatus, errorMessage || null, organizationId]
        );
      }
    } catch (err) {
      console.warn('[ComposioTriggerService] Error updating connection automation status:', err);
    }
  }

  // =========================================================================
  // 3. PROJECT WEBHOOK SUBSCRIPTION MANAGEMENT
  // =========================================================================

  /**
   * Get all registered webhook subscriptions for the Composio project.
   */
  static async getWebhookSubscriptions(): Promise<Array<{ id: string; targetUrl: string; eventTypes: string[]; secret?: string }>> {
    if (!ComposioService.isAvailable()) return [];

    const endpoints = ['/v3/webhook_subscriptions', '/v3.1/webhook_subscriptions', '/v1/webhook_subscriptions'];
    for (const ep of endpoints) {
      const res = await this.request<any>(ep, { method: 'GET' });
      if (res.ok && res.data) {
        let items: any[] = [];
        if (Array.isArray(res.data)) items = res.data;
        else if (Array.isArray(res.data.items)) items = res.data.items;
        else if (Array.isArray(res.data.data)) items = res.data.data;
        else if (Array.isArray(res.data.subscriptions)) items = res.data.subscriptions;

        return items.map((s) => ({
          id: s.id || s.subscription_id || s.nanoid,
          targetUrl: s.target_url || s.targetUrl || s.url || s.webhook_url,
          eventTypes: s.event_types || s.eventTypes || s.events || [],
          secret: s.secret || s.signing_secret || undefined,
        }));
      }
    }

    return [];
  }

  /**
   * Register or update the central Composio project webhook subscription.
   */
  static async registerProjectWebhook(params: {
    targetUrl: string;
    eventTypes?: string[];
  }): Promise<{ success: boolean; subscriptionId?: string; secret?: string; targetUrl?: string; error?: string }> {
    if (!ComposioService.isAvailable()) {
      return { success: false, error: 'COMPOSIO_API_KEY is not configured on the server.' };
    }

    const eventTypes = params.eventTypes || [
      'composio.trigger.message',
      'composio.connected_account.expired',
    ];

    // 1. Inspect existing subscriptions
    const existing = await this.getWebhookSubscriptions();
    const cleanTarget = params.targetUrl.trim().replace(/\/+$/, '');
    const match = existing.find((s) => s.targetUrl && s.targetUrl.trim().replace(/\/+$/, '') === cleanTarget);

    if (match) {
      return {
        success: true,
        subscriptionId: match.id,
        secret: match.secret,
        targetUrl: match.targetUrl,
      };
    }

    // 2. Create new webhook subscription
    const endpoints = ['/v3/webhook_subscriptions', '/v3.1/webhook_subscriptions'];
    for (const ep of endpoints) {
      const res = await this.request<any>(ep, {
        method: 'POST',
        body: JSON.stringify({
          target_url: cleanTarget,
          event_types: eventTypes,
        }),
      });

      if (res.ok && res.data) {
        const subData = res.data.data || res.data;
        const subscriptionId = subData.id || subData.subscription_id || subData.nanoid;
        const secret = subData.secret || subData.signing_secret || subData.webhook_secret;

        return {
          success: true,
          subscriptionId,
          secret,
          targetUrl: cleanTarget,
        };
      }
    }

    return {
      success: false,
      error: 'Failed to create Composio project webhook subscription.',
    };
  }

  // =========================================================================
  // 4. WEBHOOK SIGNATURE VERIFICATION
  // =========================================================================

  /**
   * Cryptographically verify incoming Composio webhook signature using HMAC-SHA256.
   * Supports:
   * 1. Svix-style / Composio v3 standard signatures (`t=timestamp,v1=signature`)
   * 2. Direct HMAC SHA256 hex or base64 (`x-composio-signature`)
   * 3. Timestamp replay defense within 5 minutes (300 seconds).
   */
  static verifyWebhookSignature(
    rawBody: string | Buffer | undefined,
    headers: Record<string, any>,
    secretOverride?: string
  ): WebhookVerificationResult {
    const secret = (secretOverride || config.composio.webhookSecret || '').trim();

    if (!secret || secret.includes('placeholder')) {
      return {
        isValid: false,
        error: 'COMPOSIO_WEBHOOK_SECRET is not configured on the server.',
      };
    }

    if (!rawBody || (typeof rawBody === 'string' && !rawBody.trim())) {
      return {
        isValid: false,
        error: 'Missing raw request body for webhook signature verification.',
      };
    }

    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8');

    // Extract headers (case-insensitive)
    const sigHeader =
      headers['x-composio-signature'] ||
      headers['webhook-signature'] ||
      headers['x-signature'] ||
      headers['composio-signature'] ||
      '';

    const timestampHeader =
      headers['x-composio-timestamp'] ||
      headers['webhook-timestamp'] ||
      headers['x-timestamp'] ||
      '';

    const msgIdHeader =
      headers['webhook-id'] ||
      headers['x-composio-msg-id'] ||
      headers['x-msg-id'] ||
      '';

    if (!sigHeader) {
      return {
        isValid: false,
        error: 'Missing webhook signature header (x-composio-signature or webhook-signature).',
      };
    }

    // Try various key buffer representations (base64 and utf-8)
    const cleanSecret = secret.startsWith('whsec_') ? secret.substring(6) : secret;
    const candidateKeys: Buffer[] = [
      Buffer.from(cleanSecret, 'utf-8'),
      Buffer.from(secret, 'utf-8'),
    ];
    try {
      const b64Buf = Buffer.from(cleanSecret, 'base64');
      if (b64Buf.length > 0) candidateKeys.unshift(b64Buf);
    } catch {
      // Ignore base64 decode errors
    }

    // 1. Check if signature header is Svix formatted: "t=1700000000,v1=sig1,v1=sig2"
    if (typeof sigHeader === 'string' && sigHeader.includes('v1=')) {
      const parts = sigHeader.split(',');
      let timestamp = timestampHeader;
      const signatures: string[] = [];

      for (const part of parts) {
        const eqIdx = part.indexOf('=');
        if (eqIdx === -1) continue;
        const k = part.substring(0, eqIdx).trim();
        const v = part.substring(eqIdx + 1).trim();
        if (k === 't' && !timestamp) {
          timestamp = v;
        } else if (k === 'v1' && v) {
          signatures.push(v);
        }
      }

      // Check timestamp freshness (within 5 minutes = 300 seconds)
      if (timestamp) {
        const tsNum = parseInt(timestamp, 10);
        const tsMs = tsNum > 1e11 ? tsNum : tsNum * 1000;
        if (!isNaN(tsMs)) {
          const delta = Math.abs(Date.now() - tsMs);
          if (delta > 5 * 60 * 1000) {
            return {
              isValid: false,
              error: `Stale webhook timestamp (drift: ${Math.round(delta / 1000)}s > 300s limit).`,
            };
          }
        }
      }

      const payloadsToTry = [
        msgIdHeader && timestamp ? `${msgIdHeader}.${timestamp}.${bodyStr}` : null,
        timestamp ? `${timestamp}.${bodyStr}` : null,
        bodyStr,
      ].filter(Boolean) as string[];

      for (const keyBuf of candidateKeys) {
        for (const p of payloadsToTry) {
          const expB64 = crypto.createHmac('sha256', keyBuf).update(p).digest('base64');
          const expHex = crypto.createHmac('sha256', keyBuf).update(p).digest('hex');
          for (const sig of signatures) {
            if (this.safeCompare(sig, expB64) || this.safeCompare(sig, expHex)) {
              return { isValid: true };
            }
          }
        }
      }

      return {
        isValid: false,
        error: 'Invalid Composio webhook signature signature mismatch.',
      };
    }

    // 2. Direct HMAC-SHA256 signature format (hex or base64 or "sha256=...")
    const rawSig = typeof sigHeader === 'string' && sigHeader.startsWith('sha256=')
      ? sigHeader.substring(7)
      : String(sigHeader);

    // Timestamp check if timestamp header provided
    if (timestampHeader) {
      const tsNum = parseInt(timestampHeader, 10);
      const tsMs = tsNum > 1e11 ? tsNum : tsNum * 1000;
      if (!isNaN(tsMs)) {
        const delta = Math.abs(Date.now() - tsMs);
        if (delta > 5 * 60 * 1000) {
          return {
            isValid: false,
            error: `Stale webhook timestamp (drift: ${Math.round(delta / 1000)}s > 300s limit).`,
          };
        }
      }
    }

    const directPayloads = [
      timestampHeader ? `${timestampHeader}.${bodyStr}` : null,
      bodyStr,
    ].filter(Boolean) as string[];

    for (const keyBuf of candidateKeys) {
      for (const p of directPayloads) {
        const expHex = crypto.createHmac('sha256', keyBuf).update(p).digest('hex');
        const expB64 = crypto.createHmac('sha256', keyBuf).update(p).digest('base64');
        if (this.safeCompare(rawSig, expHex) || this.safeCompare(rawSig, expB64)) {
          return { isValid: true };
        }
      }
    }

    return {
      isValid: false,
      error: 'Invalid Composio webhook signature.',
    };
  }

  /**
   * Constant-time string comparison to prevent timing attacks.
   */
  private static safeCompare(a: string, b: string): boolean {
    if (!a || !b) return false;
    try {
      const bufA = Buffer.from(a);
      const bufB = Buffer.from(b);
      if (bufA.length !== bufB.length) return false;
      return crypto.timingSafeEqual(bufA, bufB);
    } catch {
      return false;
    }
  }

  // =========================================================================
  // 5. WEBHOOK EVENT DISPATCH & CHANNEL NORMALIZATION
  // =========================================================================

  /**
   * Resolve organization ID from Composio metadata (connected_account_id or user_id).
   */
  static async resolveOrganizationFromWebhook(metadata?: Record<string, any>): Promise<string | null> {
    if (!metadata) return null;

    const connectedAccountId = metadata.connected_account_id || metadata.connectedAccountId || metadata.account_id;
    const userId = metadata.user_id || metadata.userId || metadata.entityId;

    // 1. Primary: Lookup by connected_account_id in local connection tables
    if (connectedAccountId) {
      // Check composio_trigger_instances
      const triggerRec = await db.getOne<{ organization_id: string }>(
        'SELECT organization_id FROM composio_trigger_instances WHERE connected_account_id = $1',
        [connectedAccountId]
      );
      if (triggerRec?.organization_id) return triggerRec.organization_id;

      // Check email_connections
      const emailRec = await db.getOne<{ organization_id: string }>(
        'SELECT organization_id FROM email_connections WHERE composio_connected_account_id = $1',
        [connectedAccountId]
      );
      if (emailRec?.organization_id) return emailRec.organization_id;

      // Check instagram_connections
      const igRec = await db.getOne<{ organization_id: string }>(
        'SELECT organization_id FROM instagram_connections WHERE composio_connected_account_id = $1 OR instagram_user_id = $1',
        [connectedAccountId]
      );
      if (igRec?.organization_id) return igRec.organization_id;

      // Check facebook_connections
      const fbRec = await db.getOne<{ organization_id: string }>(
        'SELECT organization_id FROM facebook_connections WHERE composio_connected_account_id = $1 OR page_id = $1',
        [connectedAccountId]
      );
      if (fbRec?.organization_id) return fbRec.organization_id;
    }

    // 2. Secondary: Fallback to entity/user_id ("org_<uuid>")
    if (userId && typeof userId === 'string') {
      const cleanOrgId = userId.startsWith('org_') ? userId.substring(4) : userId;
      const org = await db.getOne<{ id: string }>(
        'SELECT id FROM organizations WHERE id = $1',
        [cleanOrgId]
      );
      if (org?.id) return org.id;
    }

    return null;
  }

  /**
   * Process a verified Composio V3 Webhook Event.
   * Maps trigger slugs to canonical channels and routes to InboundChannelService.
   */
  static async processWebhookEvent(payload: ComposioWebhookPayload): Promise<{
    success: boolean;
    ignoredDuplicate?: boolean;
    channel?: string;
    organizationId?: string;
    aiReplySent?: boolean;
    replyText?: string;
    error?: string;
  }> {
    const eventId = payload.id || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const eventType = payload.type || payload.event || 'composio.trigger.message';
    const metadata = payload.metadata || {};
    const data = payload.data || {};

    // 1. Handle lifecycle events (e.g. connected_account.expired)
    if (eventType === 'composio.connected_account.expired' || eventType.includes('expired')) {
      const connectedAccountId = metadata.connected_account_id || data.connected_account_id || data.id;
      if (connectedAccountId) {
        await db.execute(
          `UPDATE email_connections SET status = 'EXPIRED', error_message = 'Connection expired. Please reconnect.' WHERE composio_connected_account_id = $1`,
          [connectedAccountId]
        );
        await db.execute(
          `UPDATE instagram_connections SET status = 'EXPIRED', error_message = 'Connection expired. Please reconnect.' WHERE composio_connected_account_id = $1 OR instagram_user_id = $1`,
          [connectedAccountId]
        );
        await db.execute(
          `UPDATE facebook_connections SET status = 'EXPIRED', error_message = 'Connection expired. Please reconnect.' WHERE composio_connected_account_id = $1 OR page_id = $1`,
          [connectedAccountId]
        );
      }
      return { success: true, channel: 'LIFECYCLE' };
    }

    // 2. Resolve organization
    const organizationId = await this.resolveOrganizationFromWebhook(metadata);
    if (!organizationId) {
      console.warn('[ComposioTriggerService] Could not resolve organization for webhook event:', {
        eventId,
        metadata,
      });
      return {
        success: false,
        error: 'Unable to resolve ONCEClic organization from Composio event metadata.',
      };
    }

    // 3. Log Audit Action for incoming webhook
    await AuditService.log({
      organizationId,
      action: AuditAction.COMPOSIO_WEBHOOK_RECEIVED,
      entityType: 'INTEGRATION',
      entityId: eventId,
      metadata: {
        eventType,
        triggerSlug: metadata.trigger_slug,
        triggerId: metadata.trigger_id,
        connectedAccountId: metadata.connected_account_id,
      },
    });

    // 4. Route by trigger slug
    const triggerSlug = (metadata.trigger_slug || metadata.app || '').toUpperCase();

    // ==========================================
    // GMAIL TRIGGER ROUTE
    // ==========================================
    if (triggerSlug.includes('GMAIL') || triggerSlug.includes('EMAIL')) {
      const fromRaw = data.from || data.sender || data.fromEmail || data.from_email || data.sender_email || '';
      let fromEmail = fromRaw;
      let fromName = data.fromName || data.from_name || '';

      const match = typeof fromRaw === 'string' ? fromRaw.match(/(.*)<(.+@.+?)>/) : null;
      if (match) {
        fromName = match[1].replace(/["']/g, '').trim();
        fromEmail = match[2].trim();
      }

      const subject = data.subject || 'Inquiry';
      const text = data.body || data.text || data.snippet || data.message || data.content || '';
      const rfcMessageId = data.message_id || data.messageId || data.rfcMessageId || data.id || eventId;
      const threadId = data.thread_id || data.threadId || undefined;

      if (!fromEmail || !text.trim()) {
        return {
          success: true,
          channel: 'GMAIL',
          organizationId,
          aiReplySent: false,
          error: 'Gmail event missing sender email or body text.',
        };
      }

      const res = await InboundChannelService.processInboundCustomerMessage({
        organizationId,
        channel: ConversationChannel.EMAIL,
        externalMessageId: rfcMessageId,
        senderId: fromEmail,
        senderName: fromName || fromEmail.split('@')[0],
        senderAddress: fromEmail,
        subject,
        text,
        inReplyToMessageId: rfcMessageId,
        metadata: {
          threadId,
          connectedAccountId: metadata.connected_account_id,
          triggerSlug,
          composioEventId: eventId,
        },
      });

      return {
        success: res.success,
        ignoredDuplicate: res.ignoredDuplicate,
        channel: 'GMAIL',
        organizationId,
        aiReplySent: res.aiReplySent,
        replyText: res.replyText,
        error: res.error || res.outboundError,
      };
    }

    // ==========================================
    // INSTAGRAM TRIGGER ROUTE
    // ==========================================
    if (triggerSlug.includes('INSTAGRAM') || triggerSlug.includes('IG_')) {
      const isEcho = data.is_echo || data.from_me || data.isEcho || data.role === 'AI' || false;
      if (isEcho) {
        console.log('[ComposioTriggerService] Skipping Instagram echo/outbound message.');
        return { success: true, channel: 'INSTAGRAM', organizationId, aiReplySent: false };
      }

      const senderId = data.sender_id || data.senderId || data.from?.id || data.sender || '';
      const senderUsername = data.username || data.sender_username || data.senderUsername || data.from?.username || undefined;
      const text = data.text || data.message || data.content || data.message?.text || '';
      const messageId = data.id || data.message_id || data.mid || eventId;

      if (!senderId || !text.trim()) {
        return {
          success: true,
          channel: 'INSTAGRAM',
          organizationId,
          aiReplySent: false,
          error: 'Instagram event missing senderId or text.',
        };
      }

      const res = await InboundChannelService.processInboundCustomerMessage({
        organizationId,
        channel: ConversationChannel.INSTAGRAM,
        externalMessageId: messageId,
        senderId,
        senderName: senderUsername,
        text,
        metadata: {
          recipientId: data.recipient_id || data.recipientId || data.to?.id,
          connectedAccountId: metadata.connected_account_id,
          triggerSlug,
          composioEventId: eventId,
        },
      });

      return {
        success: res.success,
        ignoredDuplicate: res.ignoredDuplicate,
        channel: 'INSTAGRAM',
        organizationId,
        aiReplySent: res.aiReplySent,
        replyText: res.replyText,
        error: res.error || res.outboundError,
      };
    }

    // ==========================================
    // FACEBOOK TRIGGER ROUTE
    // ==========================================
    if (triggerSlug.includes('FACEBOOK') || triggerSlug.includes('FB_') || triggerSlug.includes('PAGE_MESSAGE')) {
      const isEcho = data.is_echo || data.from_me || data.isEcho || data.role === 'AI' || false;
      if (isEcho) {
        console.log('[ComposioTriggerService] Skipping Facebook echo/outbound message.');
        return { success: true, channel: 'FACEBOOK', organizationId, aiReplySent: false };
      }

      const senderId = data.sender_id || data.senderId || data.from?.id || data.sender || '';
      const senderName = data.sender_name || data.senderName || data.from?.name || data.name || undefined;
      const text = data.text || data.message || data.content || data.message?.text || '';
      const messageId = data.id || data.message_id || data.mid || eventId;

      if (!senderId || !text.trim()) {
        return {
          success: true,
          channel: 'FACEBOOK',
          organizationId,
          aiReplySent: false,
          error: 'Facebook event missing senderId or text.',
        };
      }

      const res = await InboundChannelService.processInboundCustomerMessage({
        organizationId,
        channel: ConversationChannel.FACEBOOK,
        externalMessageId: messageId,
        senderId,
        senderName,
        text,
        metadata: {
          recipientId: data.recipient_id || data.recipientId || data.to?.id,
          connectedAccountId: metadata.connected_account_id,
          triggerSlug,
          composioEventId: eventId,
        },
      });

      return {
        success: res.success,
        ignoredDuplicate: res.ignoredDuplicate,
        channel: 'FACEBOOK',
        organizationId,
        aiReplySent: res.aiReplySent,
        replyText: res.replyText,
        error: res.error || res.outboundError,
      };
    }

    console.warn(`[ComposioTriggerService] Unrecognized trigger slug: ${triggerSlug}`);
    return {
      success: false,
      error: `Unrecognized Composio trigger slug: ${triggerSlug}`,
    };
  }
}
