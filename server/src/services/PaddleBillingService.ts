import crypto from 'crypto';
import { Paddle, Environment } from '@paddle/paddle-node-sdk';
import { db } from '../db';
import { config } from '../config';
import { Subscription, SubscriptionStatus, AuditAction, PlanTier, PaidPlanTier } from '@onceclic/shared';
import { AuditService } from './AuditService';
import { TrialService } from './TrialService';
import { AIBudgetService } from './AIBudgetService';
import { normalizeEmail } from '../utils/emailNormalizer';
import { v4 as uuidv4 } from 'uuid';

export class PaddleBillingService {
  /**
   * Authoritatively resolve a Paddle Price ID to its configured PlanTier.
   * Returns null if the price ID is unknown or not mapped to any configured paid plan.
   */
  static resolvePlanTierFromPriceId(priceId: string | null | undefined): PaidPlanTier | null {
    if (!priceId) return null;
    const p = priceId.trim();
    if (!p || p.includes('placeholder')) return null;

    // Safety guard: Never resolve a sandbox price ID in production mode
    if (config.paddle.environment === 'production' && p.toLowerCase().includes('sandbox')) {
      return null;
    }

    const starterId = config.paddle.plans?.STARTER?.priceId?.trim();
    const proId = config.paddle.plans?.PRO?.priceId?.trim();
    const businessId = config.paddle.plans?.BUSINESS?.priceId?.trim();

    // Check plan price IDs
    if (starterId && p === starterId) return 'STARTER';
    if (proId && p === proId) return 'PRO';
    if (businessId && p === businessId) return 'BUSINESS';

    // Legacy fallback configured price ID (maps to PRO only if not colliding with STARTER or BUSINESS)
    const legacyPro = (config.paddle.proMonthlyPriceId || config.paddle.priceId)?.trim();
    if (legacyPro && p === legacyPro && p !== starterId && p !== businessId) {
      if (config.paddle.environment === 'production' && legacyPro.toLowerCase().includes('sandbox')) {
        return null;
      }
      return 'PRO';
    }

    return null;
  }

  /**
   * Validate that a plan has a configured price ID that maps to the expected plan without collisions.
   */
  static validatePlanPriceMapping(tier: PaidPlanTier): {
    valid: boolean;
    priceId: string;
    priceUsd: number;
    error?: string;
  } {
    const plan = config.paddle.plans?.[tier];
    if (!plan || !plan.priceId || plan.priceId.includes('placeholder')) {
      return {
        valid: false,
        priceId: '',
        priceUsd: (plan?.priceUsd || (tier === 'STARTER' ? 19 : tier === 'PRO' ? 49 : 99)),
        error: `Missing configured Paddle price ID for ${tier}`,
      };
    }

    const currentId = plan.priceId.trim();

    // Safety guard: Sandbox price IDs cannot be used in production environment
    if (config.paddle.environment === 'production' && currentId.toLowerCase().includes('sandbox')) {
      return {
        valid: false,
        priceId: currentId,
        priceUsd: plan.priceUsd,
        error: `Sandbox price ID "${currentId}" cannot be used in production environment for ${tier}`,
      };
    }

    const otherTiers = (['STARTER', 'PRO', 'BUSINESS'] as PaidPlanTier[]).filter((t) => t !== tier);
    for (const other of otherTiers) {
      const otherId = config.paddle.plans?.[other]?.priceId?.trim();
      if (otherId && otherId === currentId) {
        return {
          valid: false,
          priceId: currentId,
          priceUsd: plan.priceUsd,
          error: `Price ID collision: ${tier} shares price ID "${currentId}" with ${other}`,
        };
      }
    }

    return {
      valid: true,
      priceId: currentId,
      priceUsd: plan.priceUsd,
    };
  }

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
   * Enforces the 1-trial-per-email policy.
   */
  static async createTrialSubscription(organizationId: string, emailParam?: string): Promise<Subscription> {
    let email = emailParam ? normalizeEmail(emailParam) : '';
    let userId = '';

    if (!email) {
      const owner = await db.getOne<{ email: string; user_id: string }>(
        `SELECT u.email, om.user_id
         FROM organization_memberships om
         JOIN users u ON om.user_id = u.id
         WHERE om.organization_id = $1 AND om.role = 'OWNER'
         ORDER BY om.created_at ASC
         LIMIT 1`,
        [organizationId]
      );
      if (owner) {
        email = normalizeEmail(owner.email);
        userId = owner.user_id;
      }
    }

    if (email && userId) {
      const eligibility = await TrialService.checkEligibility(email);
      if (!eligibility.eligible) {
        const subId = uuidv4();
        await db.execute(
          `INSERT INTO subscriptions (
             id, organization_id, status, plan_tier, trial_started_at, trial_ends_at, cancel_at_period_end, created_at, updated_at
           ) VALUES ($1, $2, 'EXPIRED', 'TRIAL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [subId, organizationId]
        );
        return (await db.getOne<Subscription>(
          `SELECT id, organization_id as "organizationId", status, plan_tier as "planTier", trial_started_at as "trialStartedAt", trial_ends_at as "trialEndsAt",
                  cancel_at_period_end as "cancelAtPeriodEnd", created_at as "createdAt", updated_at as "updatedAt"
           FROM subscriptions WHERE id = $1`,
          [subId]
        ))!;
      }
      await TrialService.redeemTrial({ userId, organizationId, email });
      return (await db.getOne<Subscription>(
        `SELECT id, organization_id as "organizationId", paddle_customer_id as "paddleCustomerId",
                paddle_subscription_id as "paddleSubscriptionId", paddle_transaction_id as "paddleTransactionId",
                price_id as "priceId", plan_tier as "planTier", status, trial_started_at as "trialStartedAt", trial_ends_at as "trialEndsAt",
                current_period_start as "currentPeriodStart", current_period_end as "currentPeriodEnd",
                cancel_at_period_end as "cancelAtPeriodEnd", created_at as "createdAt", updated_at as "updatedAt"
         FROM subscriptions WHERE organization_id = $1`,
        [organizationId]
      ))!;
    }

    const subId = uuidv4();
    const trialStartedAt = new Date();
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + config.billing.trialPeriodDays);

    await db.execute(
      `INSERT INTO subscriptions (
         id, organization_id, status, plan_tier, trial_started_at, trial_ends_at, cancel_at_period_end, created_at, updated_at
       ) VALUES ($1, $2, $3, 'TRIAL', $4, $5, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
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
      metadata: { status: SubscriptionStatus.TRIALING, trialEndsAt: trialEndsAt.toISOString(), planTier: 'TRIAL' },
    });

    const sub = await db.getOne<Subscription>(
      `SELECT id, organization_id as "organizationId", paddle_customer_id as "paddleCustomerId",
              paddle_subscription_id as "paddleSubscriptionId", paddle_transaction_id as "paddleTransactionId",
              price_id as "priceId", plan_tier as "planTier", status, trial_started_at as "trialStartedAt", trial_ends_at as "trialEndsAt",
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

    // Detect if webhook event belongs to separate phone-number rental
    const isPhoneNumberRental =
      customData?.type === 'phone_number_rental' ||
      customData?.target === 'voice_phone_number' ||
      Boolean(
        paddleSubId &&
        (await db.getOne('SELECT id FROM voice_phone_numbers WHERE paddle_subscription_id = $1', [paddleSubId]))
      );

    if (isPhoneNumberRental) {
      const { PhoneNumberBillingService } = await import('./voice/PhoneNumberBillingService');
      return PhoneNumberBillingService.handleWebhookEvent(event);
    }

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
        const rawPriceId = data.items?.[0]?.price?.id || data.items?.[0]?.price_id || data.price_id;
        const priceId = rawPriceId ? String(rawPriceId).trim() : null;

        // Authoritatively map price ID to plan tier
        const matchedTier = this.resolvePlanTierFromPriceId(priceId);

        if (!matchedTier) {
          console.warn(`[Paddle Webhook] Unknown or unmapped price_id "${priceId}". Refusing to activate paid plan.`);
          if (organizationId) {
            await db.execute(
              `UPDATE subscriptions
               SET paddle_customer_id = COALESCE($1, paddle_customer_id),
                   paddle_subscription_id = COALESCE($2, paddle_subscription_id),
                   price_id = $3,
                   updated_at = CURRENT_TIMESTAMP
               WHERE organization_id = $4`,
              [paddleCustomerId, paddleSubId, priceId || null, organizationId]
            );
          }
          break;
        }

        if (organizationId) {
          await db.execute(
            `UPDATE subscriptions
             SET paddle_customer_id = COALESCE($1, paddle_customer_id),
                 paddle_subscription_id = COALESCE($2, paddle_subscription_id),
                 price_id = COALESCE($3, price_id),
                 plan_tier = $4,
                 status = $5,
                 current_period_start = $6,
                 current_period_end = $7,
                 cancel_at_period_end = FALSE,
                 updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = $8`,
            [paddleCustomerId, paddleSubId, priceId, matchedTier, status, currentPeriodStart, currentPeriodEnd, organizationId]
          );

          await AuditService.log({
            organizationId,
            action: AuditAction.SUBSCRIPTION_ACTIVATED,
            entityType: 'SUBSCRIPTION',
            metadata: { paddleSubscriptionId: paddleSubId, status, planTier: matchedTier },
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
        const rawPriceId = data.items?.[0]?.price?.id || data.items?.[0]?.price_id || data.price_id;
        const priceId = rawPriceId !== undefined ? rawPriceId : null;
        const matchedTier = priceId ? this.resolvePlanTierFromPriceId(priceId) : null;

        await db.execute(
          `UPDATE subscriptions
           SET status = $1,
               cancel_at_period_end = $2,
               current_period_start = COALESCE($3, current_period_start),
               current_period_end = COALESCE($4, current_period_end),
               price_id = COALESCE($5, price_id),
               plan_tier = COALESCE($6, plan_tier),
               paddle_customer_id = COALESCE($7, paddle_customer_id),
               updated_at = CURRENT_TIMESTAMP
           WHERE paddle_subscription_id = $8 OR organization_id = $9`,
          [status, cancelAtPeriodEnd, currentPeriodStart, currentPeriodEnd, priceId || null, matchedTier, paddleCustomerId, paddleSubId, organizationId]
        );

        if (organizationId) {
          await AuditService.log({
            organizationId,
            action: AuditAction.SUBSCRIPTION_UPDATED,
            entityType: 'SUBSCRIPTION',
            metadata: { paddleSubscriptionId: paddleSubId, status, cancelAtPeriodEnd, planTier: matchedTier },
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
  static async getSubscription(organizationId: string, referenceTime?: Date): Promise<{
    subscription: Subscription | null;
    isPro: boolean;
    planTier: PlanTier;
    daysRemainingInTrial: number;
    billingConfigured: boolean;
    aiBudget: {
      budgetUsd: number;
      spentUsd: number;
      remainingUsd: number;
      isExceeded: boolean;
      plan: string;
    };
  }> {
    let sub = await db.getOne<Subscription>(
      `SELECT id, organization_id as "organizationId", paddle_customer_id as "paddleCustomerId",
              paddle_subscription_id as "paddleSubscriptionId", paddle_transaction_id as "paddleTransactionId",
              price_id as "priceId", plan_tier as "planTier", status, trial_started_at as "trialStartedAt", trial_ends_at as "trialEndsAt",
              current_period_start as "currentPeriodStart", current_period_end as "currentPeriodEnd",
              cancel_at_period_end as "cancelAtPeriodEnd", created_at as "createdAt", updated_at as "updatedAt"
       FROM subscriptions WHERE organization_id = $1`,
      [organizationId]
    );

    if (!sub) {
      const org = await db.getOne('SELECT id FROM organizations WHERE id = $1 AND is_active = TRUE', [organizationId]);
      if (org) {
        try {
          sub = await this.createTrialSubscription(organizationId);
        } catch {
          // Fall back if cannot create
        }
      }
    }

    const budgetStatus = await AIBudgetService.checkBudget(organizationId);

    if (!sub) {
      return {
        subscription: null,
        isPro: false,
        planTier: 'TRIAL',
        daysRemainingInTrial: 0,
        billingConfigured: config.paddle.isConfigured,
        aiBudget: {
          budgetUsd: 0,
          spentUsd: budgetStatus.spentUsd,
          remainingUsd: 0,
          isExceeded: false,
          plan: 'NONE',
        },
      };
    }

    const now = referenceTime ? referenceTime.getTime() : Date.now();
    const trialEndMs = new Date(sub.trialEndsAt).getTime();
    const diffDays = Math.max(0, Math.ceil((trialEndMs - now) / (1000 * 60 * 60 * 24)));

    // Auto-update expired trial if trialing without active paddle subscription
    if (sub.status === SubscriptionStatus.TRIALING && !sub.paddleSubscriptionId && now > trialEndMs) {
      await db.execute(
        `UPDATE subscriptions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [SubscriptionStatus.EXPIRED, sub.id]
      );
      sub.status = SubscriptionStatus.EXPIRED;
    }

    // Determine plan tier and paid entitlement
    let planTier: PlanTier = 'TRIAL';
    const rawTier = (sub as any).planTier || (sub as any).plan_tier;
    const resolvedTier = rawTier ? rawTier.toUpperCase() : (sub.priceId ? this.resolvePlanTierFromPriceId(sub.priceId) : null);

    const isPaidActive =
      (sub.status === SubscriptionStatus.ACTIVE || sub.status === SubscriptionStatus.PAST_DUE) &&
      Boolean(resolvedTier && (resolvedTier === 'STARTER' || resolvedTier === 'PRO' || resolvedTier === 'BUSINESS'));

    if (isPaidActive && resolvedTier) {
      planTier = resolvedTier as PlanTier;
    } else {
      planTier = 'TRIAL';
    }

    const isTrialActive = sub.status === SubscriptionStatus.TRIALING && diffDays > 0;
    // Access is granted if paid subscription is active for a valid tier, or currently trialing.
    // An active paid subscription with an unknown/missing price ID will NOT receive isPro.
    const isPro = isPaidActive || isTrialActive;

    return {
      subscription: sub,
      isPro,
      planTier,
      daysRemainingInTrial: diffDays,
      billingConfigured: config.paddle.isConfigured,
      aiBudget: {
        budgetUsd: budgetStatus.budgetUsd,
        spentUsd: budgetStatus.spentUsd,
        remainingUsd: budgetStatus.remainingUsd,
        isExceeded: !!budgetStatus.isExceeded,
        plan: budgetStatus.plan,
      },
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
