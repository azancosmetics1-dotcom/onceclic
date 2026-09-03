import crypto from 'crypto';
import { Paddle, Environment } from '@paddle/paddle-node-sdk';
import { db } from '../db';
import { config } from '../config';
import { Subscription, SubscriptionStatus, AuditAction } from '@onceclic/shared';
import { AuditService } from './AuditService';
import { v4 as uuidv4 } from 'uuid';

export class PaddleBillingService {
  private static getPaddleSdk(): Paddle | null {
    if (!config.paddle.apiKey || config.paddle.apiKey.includes('placeholder')) {
      return null;
    }
    return new Paddle(config.paddle.apiKey, {
      environment: config.paddle.environment === 'production' ? Environment.production : Environment.sandbox,
    });
  }

  /**
   * Verify Paddle webhook HMAC signature.
   * Paddle sends `paddle-signature: ts=12345678;h1=abcdef...`
   */
  static verifyWebhookSignature(rawBody: string, signatureHeader?: string): boolean {
    const secret = config.paddle.webhookSecret;
    if (!secret || !signatureHeader) return false;

    try {
      const parts = signatureHeader.split(';');
      let ts = '';
      let h1 = '';

      for (const part of parts) {
        const [key, val] = part.split('=');
        if (key === 'ts') ts = val;
        if (key === 'h1') h1 = val;
      }

      if (!ts || !h1) return false;

      // Signed payload format: timestamp + ':' + raw_request_body
      const signedPayload = `${ts}:${rawBody}`;
      const expectedHmac = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

      const expectedBuf = Buffer.from(expectedHmac);
      const h1Buf = Buffer.from(h1);

      if (expectedBuf.length !== h1Buf.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuf, h1Buf);
    } catch (err) {
      return false;
    }
  }

  /**
   * Initialize a default 7-day trial subscription for a new organization.
   */
  static async createTrialSubscription(organizationId: string): Promise<Subscription> {
    const subId = uuidv4();
    const trialStartedAt = new Date();
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + config.billing.trialPeriodDays);

    await db.execute(
      `INSERT INTO subscriptions (
         id, organization_id, status, trial_started_at, trial_ends_at, cancel_at_period_end, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        subId,
        organizationId,
        SubscriptionStatus.TRIALING,
        trialStartedAt.toISOString(),
        trialEndsAt.toISOString(),
      ]
    );

    await AuditService.log({
      organizationId,
      action: AuditAction.SUBSCRIPTION_CREATED,
      entityType: 'SUBSCRIPTION',
      entityId: subId,
      metadata: { status: SubscriptionStatus.TRIALING, trialEndsAt: trialEndsAt.toISOString() },
    });

    const sub = await db.getOne<Subscription>(
      `SELECT id, organization_id as "organizationId", paddle_customer_id as "paddleCustomerId",
              paddle_subscription_id as "paddleSubscriptionId", paddle_transaction_id as "paddleTransactionId",
              price_id as "priceId", status, trial_started_at as "trialStartedAt", trial_ends_at as "trialEndsAt",
              current_period_start as "currentPeriodStart", current_period_end as "currentPeriodEnd",
              cancel_at_period_end as "cancelAtPeriodEnd", created_at as "createdAt", updated_at as "updatedAt"
       FROM subscriptions WHERE id = $1`,
      [subId]
    );

    return sub!;
  }

  /**
   * Process verified Paddle webhook event idempotently and update subscription status.
   */
  static async handleWebhookEvent(event: {
    event_id: string;
    event_type: string;
    occurred_at: string;
    data: any;
  }): Promise<{ success: boolean; message: string }> {
    const { event_id, event_type, occurred_at, data } = event;
    console.log(`[Paddle Webhook] Processing event: ${event_type}`, { event_id, resourceId: data?.id });

    // 1. Strict Idempotency Check: prevent duplicate event processing
    if (event_id) {
      const existing = await db.getOne<{ event_id: string }>(
        `SELECT event_id FROM processed_webhook_events WHERE event_id = $1`,
        [event_id]
      );
      if (existing) {
        console.log(`[Paddle Webhook] Event ${event_id} already processed. Skipping (idempotent).`);
        return { success: true, message: `Event ${event_id} already processed (idempotent)` };
      }

      await db.execute(
        `INSERT INTO processed_webhook_events (event_id, event_type, occurred_at, processed_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        [event_id, event_type, occurred_at || new Date().toISOString()]
      );
    }

    const paddleSubId = data?.id || data?.subscription_id;
    const paddleCustomerId = data?.customer_id || data?.customerId;
    const customData = data?.custom_data || data?.customData || {};
    let organizationId = customData?.organization_id || customData?.organizationId;

    // 2. Organization mapping fallback
    if (!organizationId && paddleSubId) {
      const subRecord = await db.getOne<{ organization_id: string }>(
        `SELECT organization_id FROM subscriptions WHERE paddle_subscription_id = $1`,
        [paddleSubId]
      );
      if (subRecord?.organization_id) {
        organizationId = subRecord.organization_id;
      }
    }

    if (!organizationId && paddleCustomerId) {
      const subRecord = await db.getOne<{ organization_id: string }>(
        `SELECT organization_id FROM subscriptions WHERE paddle_customer_id = $1`,
        [paddleCustomerId]
      );
      if (subRecord?.organization_id) {
        organizationId = subRecord.organization_id;
      }
    }

    if (!organizationId) {
      const customerEmail = data?.customer?.email || data?.email;
      if (customerEmail) {
        const userOrg = await db.getOne<{ organization_id: string }>(
          `SELECT om.organization_id
           FROM users u
           JOIN organization_memberships om ON u.id = om.user_id
           WHERE LOWER(u.email) = LOWER($1)
           ORDER BY om.role = 'OWNER' DESC, om.created_at ASC
           LIMIT 1`,
          [customerEmail]
        );
        if (userOrg?.organization_id) {
          organizationId = userOrg.organization_id;
        }
      }
    }

    // Log webhook receipt audit log if organization is resolved
    if (organizationId) {
      await AuditService.log({
        organizationId,
        action: AuditAction.PADDLE_WEBHOOK_RECEIVED,
        entityType: 'PADDLE_WEBHOOK',
        metadata: { eventType: event_type, eventId: event_id },
      });
    }

    // 3. Defensive Event Dispatching
    switch (event_type) {
      case 'subscription.created':
      case 'subscription.activated': {
        const paddleStatus = (data.status || 'active').toLowerCase();
        let status = SubscriptionStatus.ACTIVE;
        if (paddleStatus === 'trialing') status = SubscriptionStatus.TRIALING;
        if (paddleStatus === 'past_due') status = SubscriptionStatus.PAST_DUE;
        if (paddleStatus === 'paused') status = SubscriptionStatus.PAUSED;
        if (paddleStatus === 'canceled') status = SubscriptionStatus.CANCELED;

        const currentPeriodStart = data.current_billing_period?.starts_at || data.currentBillingPeriod?.startsAt;
        const currentPeriodEnd = data.current_billing_period?.ends_at || data.currentBillingPeriod?.endsAt;
        const priceId = data.items?.[0]?.price?.id || data.items?.[0]?.price_id || data.price_id || config.paddle.priceId;

        if (organizationId) {
          await db.execute(
            `UPDATE subscriptions
             SET paddle_customer_id = COALESCE($1, paddle_customer_id),
                 paddle_subscription_id = COALESCE($2, paddle_subscription_id),
                 price_id = COALESCE($3, price_id),
                 status = $4,
                 current_period_start = $5,
                 current_period_end = $6,
                 cancel_at_period_end = FALSE,
                 updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = $7`,
            [paddleCustomerId, paddleSubId, priceId, status, currentPeriodStart, currentPeriodEnd, organizationId]
          );

          await AuditService.log({
            organizationId,
            action: AuditAction.SUBSCRIPTION_ACTIVATED,
            entityType: 'SUBSCRIPTION',
            metadata: { paddleSubscriptionId: paddleSubId, status },
          });
        }
        break;
      }

      case 'subscription.updated': {
        const paddleStatus = (data.status || 'active').toLowerCase();
        let status = SubscriptionStatus.ACTIVE;
        if (paddleStatus === 'trialing') status = SubscriptionStatus.TRIALING;
        if (paddleStatus === 'past_due') status = SubscriptionStatus.PAST_DUE;
        if (paddleStatus === 'paused') status = SubscriptionStatus.PAUSED;
        if (paddleStatus === 'canceled') status = SubscriptionStatus.CANCELED;

        const scheduledChange = data.scheduled_change || data.scheduledChange;
        const cancelAtPeriodEnd = scheduledChange?.action === 'cancel' || scheduledChange?.action === 'canceled';
        const currentPeriodStart = data.current_billing_period?.starts_at || data.currentBillingPeriod?.startsAt;
        const currentPeriodEnd = data.current_billing_period?.ends_at || data.currentBillingPeriod?.endsAt;
        const priceId = data.items?.[0]?.price?.id || data.items?.[0]?.price_id || data.price_id;

        await db.execute(
          `UPDATE subscriptions
           SET status = $1,
               cancel_at_period_end = $2,
               current_period_start = COALESCE($3, current_period_start),
               current_period_end = COALESCE($4, current_period_end),
               price_id = COALESCE($5, price_id),
               paddle_customer_id = COALESCE($6, paddle_customer_id),
               updated_at = CURRENT_TIMESTAMP
           WHERE paddle_subscription_id = $7 OR organization_id = $8`,
          [status, cancelAtPeriodEnd, currentPeriodStart, currentPeriodEnd, priceId, paddleCustomerId, paddleSubId, organizationId]
        );

        if (organizationId) {
          await AuditService.log({
            organizationId,
            action: AuditAction.SUBSCRIPTION_UPDATED,
            entityType: 'SUBSCRIPTION',
            metadata: { paddleSubscriptionId: paddleSubId, status, cancelAtPeriodEnd },
          });
        }
        break;
      }

      case 'subscription.canceled': {
        await db.execute(
          `UPDATE subscriptions
           SET status = $1,
               cancel_at_period_end = TRUE,
               updated_at = CURRENT_TIMESTAMP
           WHERE paddle_subscription_id = $2 OR organization_id = $3`,
          [SubscriptionStatus.CANCELED, paddleSubId, organizationId]
        );

        if (organizationId) {
          await AuditService.log({
            organizationId,
            action: AuditAction.SUBSCRIPTION_CANCELED,
            entityType: 'SUBSCRIPTION',
            metadata: { paddleSubscriptionId: paddleSubId },
          });
        }
        break;
      }

      case 'customer.created':
      case 'customer.updated': {
        if (organizationId && paddleCustomerId) {
          await db.execute(
            `UPDATE subscriptions
             SET paddle_customer_id = $1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = $2`,
            [paddleCustomerId, organizationId]
          );
        }
        break;
      }

      case 'transaction.completed': {
        const txnId = data?.id;
        if (organizationId && txnId) {
          await db.execute(
            `UPDATE subscriptions
             SET paddle_transaction_id = $1,
                 paddle_customer_id = COALESCE($2, paddle_customer_id),
                 paddle_subscription_id = COALESCE($3, paddle_subscription_id),
                 updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = $4 OR paddle_subscription_id = $3`,
            [txnId, paddleCustomerId, paddleSubId, organizationId]
          );
        }
        break;
      }

      case 'transaction.payment_failed': {
        if (organizationId) {
          await AuditService.log({
            organizationId,
            action: AuditAction.PAYMENT_FAILED,
            entityType: 'TRANSACTION',
            metadata: { transactionId: data?.id, reason: data?.error_code },
          });
        }
        break;
      }
    }

    return { success: true, message: `Successfully handled ${event_type}` };
  }

  /**
   * Get subscription status and calculated access permissions for an organization.
   */
  static async getSubscription(organizationId: string): Promise<{
    subscription: Subscription | null;
    isPro: boolean;
    daysRemainingInTrial: number;
    billingConfigured: boolean;
  }> {
    const sub = await db.getOne<Subscription>(
      `SELECT id, organization_id as "organizationId", paddle_customer_id as "paddleCustomerId",
              paddle_subscription_id as "paddleSubscriptionId", paddle_transaction_id as "paddleTransactionId",
              price_id as "priceId", status, trial_started_at as "trialStartedAt", trial_ends_at as "trialEndsAt",
              current_period_start as "currentPeriodStart", current_period_end as "currentPeriodEnd",
              cancel_at_period_end as "cancelAtPeriodEnd", created_at as "createdAt", updated_at as "updatedAt"
       FROM subscriptions WHERE organization_id = $1`,
      [organizationId]
    );

    if (!sub) {
      return {
        subscription: null,
        isPro: false,
        daysRemainingInTrial: 0,
        billingConfigured: config.paddle.isConfigured,
      };
    }

    const now = Date.now();
    const trialEndMs = new Date(sub.trialEndsAt).getTime();
    const diffDays = Math.max(0, Math.ceil((trialEndMs - now) / (1000 * 60 * 60 * 24)));

    // Access is granted during ACTIVE or TRIALING (or PAST_DUE grace period).
    // If scheduled cancellation is pending (cancel_at_period_end = true), access is RETAINED until period actually ends.
    const isPro =
      sub.status === SubscriptionStatus.ACTIVE ||
      (sub.status === SubscriptionStatus.TRIALING && (!!sub.paddleSubscriptionId || diffDays > 0)) ||
      sub.status === SubscriptionStatus.PAST_DUE;

    return {
      subscription: sub,
      isPro,
      daysRemainingInTrial: diffDays,
      billingConfigured: config.paddle.isConfigured,
    };
  }

  /**
   * Mint a Paddle customer portal session URL from server-side.
   */
  static async createCustomerPortalSession(organizationId: string): Promise<{ url: string }> {
    const sub = await db.getOne<Subscription>(
      `SELECT id, paddle_customer_id as "paddleCustomerId", paddle_subscription_id as "paddleSubscriptionId"
       FROM subscriptions WHERE organization_id = $1`,
      [organizationId]
    );

    if (!sub?.paddleCustomerId) {
      throw new Error('No Paddle customer record found for this organization. Please complete a checkout first.');
    }

    const paddle = this.getPaddleSdk();
    if (!paddle) {
      throw new Error('Paddle API is not configured on the server.');
    }

    const subscriptionIds = sub.paddleSubscriptionId ? [sub.paddleSubscriptionId] : [];
    const session = await paddle.customerPortalSessions.create(sub.paddleCustomerId, subscriptionIds);

    return { url: session.urls.general.overview };
  }

  /**
   * Schedule subscription cancellation at the end of current billing period via Paddle Node SDK.
   */
  static async cancelSubscription(organizationId: string): Promise<{
    success: boolean;
    status: string;
    scheduledChange?: string | null;
  }> {
    const sub = await db.getOne<Subscription>(
      `SELECT id, paddle_subscription_id as "paddleSubscriptionId", status
       FROM subscriptions WHERE organization_id = $1`,
      [organizationId]
    );

    if (!sub?.paddleSubscriptionId) {
      throw new Error('No active Paddle subscription found for this organization.');
    }

    const paddle = this.getPaddleSdk();
    if (!paddle) {
      // If Paddle SDK is not available in mock/offline mode, simulate scheduled cancellation
      await db.execute(
        `UPDATE subscriptions
         SET cancel_at_period_end = TRUE, updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $1`,
        [organizationId]
      );
      return { success: true, status: sub.status, scheduledChange: new Date(Date.now() + 30 * 86400000).toISOString() };
    }

    const canceledSub = await paddle.subscriptions.cancel(sub.paddleSubscriptionId, {
      effectiveFrom: 'next_billing_period',
    });

    await db.execute(
      `UPDATE subscriptions
       SET cancel_at_period_end = TRUE, updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $1`,
      [organizationId]
    );

    await AuditService.log({
      organizationId,
      action: AuditAction.SUBSCRIPTION_CANCELED,
      entityType: 'SUBSCRIPTION',
      metadata: {
        paddleSubscriptionId: sub.paddleSubscriptionId,
        effectiveAt: canceledSub.scheduledChange?.effectiveAt,
      },
    });

    return {
      success: true,
      status: canceledSub.status,
      scheduledChange: canceledSub.scheduledChange?.effectiveAt || null,
    };
  }
}
