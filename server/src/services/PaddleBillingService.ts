import crypto from 'crypto';
import { db } from '../db';
import { config } from '../config';
import { Subscription, SubscriptionStatus, AuditAction } from '@onceclic/shared';
import { AuditService } from './AuditService';
import { v4 as uuidv4 } from 'uuid';

export class PaddleBillingService {
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
   * Initialize a default 7-day free trial subscription for a new organization.
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
   * Process verified Paddle webhook event and update subscription status.
   */
  static async handleWebhookEvent(event: {
    event_id: string;
    event_type: string;
    occurred_at: string;
    data: any;
  }): Promise<{ success: boolean; message: string }> {
    const { event_type, data } = event;
    console.log(`[Paddle] Processing webhook event: ${event_type}`, { id: data?.id });

    const paddleSubId = data?.id || data?.subscription_id;
    const paddleCustomerId = data?.customer_id;
    const customData = data?.custom_data || {};
    const organizationId = customData?.organization_id;

    // Log webhook receipt
    if (organizationId) {
      await AuditService.log({
        organizationId,
        action: AuditAction.PADDLE_WEBHOOK_RECEIVED,
        entityType: 'PADDLE_WEBHOOK',
        metadata: { eventType: event_type, eventId: event.event_id },
      });
    }

    switch (event_type) {
      case 'subscription.created':
      case 'subscription.activated': {
        const status = SubscriptionStatus.ACTIVE;
        const currentPeriodStart = data.current_billing_period?.starts_at;
        const currentPeriodEnd = data.current_billing_period?.ends_at;

        if (organizationId) {
          await db.execute(
            `UPDATE subscriptions
             SET paddle_customer_id = $1,
                 paddle_subscription_id = $2,
                 status = $3,
                 current_period_start = $4,
                 current_period_end = $5,
                 cancel_at_period_end = FALSE,
                 updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = $6`,
            [paddleCustomerId, paddleSubId, status, currentPeriodStart, currentPeriodEnd, organizationId]
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
        const paddleStatus = (data.status || '').toLowerCase();
        let status = SubscriptionStatus.ACTIVE;
        if (paddleStatus === 'past_due') status = SubscriptionStatus.PAST_DUE;
        if (paddleStatus === 'paused') status = SubscriptionStatus.PAUSED;
        if (paddleStatus === 'canceled') status = SubscriptionStatus.CANCELED;

        const scheduledChange = data.scheduled_change;
        const cancelAtPeriodEnd = scheduledChange?.action === 'cancel';
        const currentPeriodStart = data.current_billing_period?.starts_at;
        const currentPeriodEnd = data.current_billing_period?.ends_at;

        await db.execute(
          `UPDATE subscriptions
           SET status = $1,
               cancel_at_period_end = $2,
               current_period_start = $3,
               current_period_end = $4,
               updated_at = CURRENT_TIMESTAMP
           WHERE paddle_subscription_id = $5 OR organization_id = $6`,
          [status, cancelAtPeriodEnd, currentPeriodStart, currentPeriodEnd, paddleSubId, organizationId]
        );
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

      case 'transaction.payment_failed': {
        if (organizationId) {
          await AuditService.log({
            organizationId,
            action: AuditAction.PAYMENT_FAILED,
            entityType: 'TRANSACTION',
            metadata: { transactionId: data.id, reason: data.error_code },
          });
        }
        break;
      }
    }

    return { success: true, message: `Handled ${event_type}` };
  }

  /**
   * Get subscription status for an organization.
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

    const isPro = sub.status === SubscriptionStatus.ACTIVE || (sub.status === SubscriptionStatus.TRIALING && diffDays > 0);

    return {
      subscription: sub,
      isPro,
      daysRemainingInTrial: diffDays,
      billingConfigured: config.paddle.isConfigured,
    };
  }
}
