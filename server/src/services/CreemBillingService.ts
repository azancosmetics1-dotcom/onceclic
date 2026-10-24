import crypto from 'crypto';
import { Creem } from 'creem';
import { db } from '../db';
import { config } from '../config';
import {
  Subscription,
  SubscriptionStatus,
  AuditAction,
  PlanTier,
  PaidPlanTier,
} from '@onceclic/shared';
import { AuditService } from './AuditService';
import { TrialService } from './TrialService';
import { AIBudgetService } from './AIBudgetService';
import { normalizeEmail } from '../utils/emailNormalizer';
import { v4 as uuidv4 } from 'uuid';

export class CreemBillingService {
  /**
   * Authoritatively resolve a Creem Product ID to its configured PaidPlanTier.
   * Returns null if product ID is unknown or not mapped to any configured paid plan.
   */
  static resolvePlanTierFromProductId(productId: string | null | undefined): PaidPlanTier | null {
    if (!productId) return null;
    const p = productId.trim();
    if (!p || p.includes('placeholder')) return null;

    // Safety guard: Never resolve a test/sandbox product ID in production mode
    if (config.creem.environment === 'prod' && (p.toLowerCase().includes('test') || p.toLowerCase().includes('sandbox'))) {
      return null;
    }

    const starterId = config.creem.plans?.STARTER?.productId?.trim();
    const proId = config.creem.plans?.PRO?.productId?.trim();
    const businessId = config.creem.plans?.BUSINESS?.productId?.trim();

    if (starterId && p === starterId) return 'STARTER';
    if (proId && p === proId) return 'PRO';
    if (businessId && p === businessId) return 'BUSINESS';

    return null;
  }

  /**
   * Validate that a plan has a configured Creem product ID that maps without collisions.
   */
  static validatePlanProductMapping(tier: PaidPlanTier): {
    valid: boolean;
    productId: string;
    priceUsd: number;
    error?: string;
  } {
    const plan = config.creem.plans?.[tier];
    if (!plan || !plan.productId || plan.productId.includes('placeholder')) {
      return {
        valid: false,
        productId: '',
        priceUsd: (plan?.priceUsd || (tier === 'STARTER' ? 19 : tier === 'PRO' ? 49 : 99)),
        error: `Missing configured Creem product ID for ${tier}`,
      };
    }

    const currentId = plan.productId.trim();

    // Safety guard: Test/sandbox product IDs cannot be used in production environment
    if (config.creem.environment === 'prod' && (currentId.toLowerCase().includes('test') || currentId.toLowerCase().includes('sandbox'))) {
      return {
        valid: false,
        productId: currentId,
        priceUsd: plan.priceUsd,
        error: `Test product ID "${currentId}" cannot be used in production environment for ${tier}`,
      };
    }

    const otherTiers = (['STARTER', 'PRO', 'BUSINESS'] as PaidPlanTier[]).filter((t) => t !== tier);
    for (const other of otherTiers) {
      const otherId = config.creem.plans?.[other]?.productId?.trim();
      if (otherId && otherId === currentId) {
        return {
          valid: false,
          productId: currentId,
          priceUsd: plan.priceUsd,
          error: `Product ID collision: ${tier} shares product ID "${currentId}" with ${other}`,
        };
      }
    }

    return {
      valid: true,
      productId: currentId,
      priceUsd: plan.priceUsd,
    };
  }

  /**
   * Get an initialized Creem SDK client or null if not configured.
   */
  static getCreemSdk(): Creem | null {
    if (!config.creem.apiKey || config.creem.apiKey.includes('placeholder')) {
      return null;
    }
    return new Creem({
      apiKey: config.creem.apiKey,
      server: config.creem.environment === 'prod' ? 'prod' : 'test',
    });
  }

  /**
   * Verify Creem webhook HMAC-SHA256 signature.
   * Supports both official Creem SDK verification (Standard svix headers and Legacy headers)
   * and direct hex HMAC verification.
   */
  static async verifyWebhookSignature(
    rawBody: string,
    signatureOrHeaders?: string | Record<string, string | string[] | undefined>,
    overrideSecret?: string
  ): Promise<boolean> {
    const secret = overrideSecret || config.creem.webhookSecret;
    if (!secret || secret.includes('placeholder') || !signatureOrHeaders) {
      return false;
    }

    const headers: Record<string, string | string[] | undefined> =
      typeof signatureOrHeaders === 'string'
        ? { 'creem-signature': signatureOrHeaders }
        : signatureOrHeaders;

    // 1. Try official SDK verification
    try {
      // @ts-ignore - 'creem/webhooks' is an ESM/CJS subpath export resolved by Node at runtime
      const { verifyWebhookSignature: verifySdkWebhook } = await import('creem/webhooks');
      await verifySdkWebhook(rawBody, headers, secret);
      return true;
    } catch {
      // 2. Fallback manual HMAC-SHA256 check
      const sig = typeof signatureOrHeaders === 'string'
        ? signatureOrHeaders
        : (headers['creem-signature'] || headers['x-creem-signature']) as string | undefined;

      if (!sig) return false;
      try {
        const cleanSig = sig.trim().startsWith('sha256=') ? sig.trim().slice(7).toLowerCase() : sig.trim().toLowerCase();
        const computedSignature = crypto
          .createHmac('sha256', secret)
          .update(rawBody)
          .digest('hex')
          .toLowerCase();

        const expectedBuf = Buffer.from(computedSignature);
        const headerBuf = Buffer.from(cleanSig);

        if (expectedBuf.length !== headerBuf.length) {
          return false;
        }

        return crypto.timingSafeEqual(expectedBuf, headerBuf);
      } catch {
        return false;
      }
    }
  }

  /**
   * Synchronous HMAC-SHA256 check for backwards compatibility
   */
  static verifyWebhookSignatureSync(rawBody: string, signatureHeader?: string, overrideSecret?: string): boolean {
    const secret = overrideSecret || config.creem.webhookSecret;
    if (!secret || secret.includes('placeholder') || !signatureHeader) {
      return false;
    }
    try {
      const cleanSig = signatureHeader.trim().startsWith('sha256=')
        ? signatureHeader.trim().slice(7).toLowerCase()
        : signatureHeader.trim().toLowerCase();
      const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex').toLowerCase();
      const expectedBuf = Buffer.from(computed);
      const headerBuf = Buffer.from(cleanSig);
      if (expectedBuf.length !== headerBuf.length) return false;
      return crypto.timingSafeEqual(expectedBuf, headerBuf);
    } catch {
      return false;
    }
  }

  /**
   * Create an authenticated Creem checkout session server-side.
   */
  static async createCheckoutSession(params: {
    organizationId: string;
    userId: string;
    userEmail: string;
    userName?: string;
    planTier: PaidPlanTier;
  }): Promise<{ checkoutUrl: string; checkoutId: string }> {
    const { organizationId, userId, userEmail, userName, planTier } = params;

    // Validate plan tier against server-side allowlist
    const validTiers: PaidPlanTier[] = ['STARTER', 'PRO', 'BUSINESS'];
    if (!validTiers.includes(planTier)) {
      throw new Error(`Invalid plan tier: "${planTier}". Allowed tiers: Starter, Pro, Business.`);
    }

    // Validate Creem configuration & product mapping
    const mapping = this.validatePlanProductMapping(planTier);
    if (!mapping.valid) {
      throw new Error(mapping.error || `Checkout for ${planTier} is currently unavailable.`);
    }

    const creem = this.getCreemSdk();
    if (!creem) {
      throw new Error('Creem payment gateway is not configured on the server.');
    }

    const successUrl = `${config.app.url}/welcome?checkout=success`;

    const checkout = await creem.checkouts.create({
      productId: mapping.productId,
      customer: {
        email: userEmail,
        name: userName || undefined,
      },
      successUrl,
      metadata: {
        organization_id: organizationId,
        user_id: userId,
        plan_tier: planTier,
      },
    });

    if (!checkout || !checkout.checkoutUrl) {
      throw new Error('Creem API did not return a valid checkout URL.');
    }

    return {
      checkoutUrl: checkout.checkoutUrl,
      checkoutId: checkout.id,
    };
  }

  /**
   * Initialize a default 7-day trial subscription for a new organization.
   * Enforces 1-trial-per-email policy.
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
          `SELECT id, organization_id as "organizationId", creem_customer_id as "creemCustomerId",
                  creem_subscription_id as "creemSubscriptionId", creem_checkout_id as "creemCheckoutId",
                  creem_product_id as "creemProductId", paddle_customer_id as "paddleCustomerId",
                  paddle_subscription_id as "paddleSubscriptionId", paddle_transaction_id as "paddleTransactionId",
                  price_id as "priceId", plan_tier as "planTier", status, trial_started_at as "trialStartedAt", trial_ends_at as "trialEndsAt",
                  cancel_at_period_end as "cancelAtPeriodEnd", created_at as "createdAt", updated_at as "updatedAt"
           FROM subscriptions WHERE id = $1`,
          [subId]
        ))!;
      }
      await TrialService.redeemTrial({ userId, organizationId, email });
      return (await db.getOne<Subscription>(
        `SELECT id, organization_id as "organizationId", creem_customer_id as "creemCustomerId",
                creem_subscription_id as "creemSubscriptionId", creem_checkout_id as "creemCheckoutId",
                creem_product_id as "creemProductId", paddle_customer_id as "paddleCustomerId",
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
      `SELECT id, organization_id as "organizationId", creem_customer_id as "creemCustomerId",
              creem_subscription_id as "creemSubscriptionId", creem_checkout_id as "creemCheckoutId",
              creem_product_id as "creemProductId", paddle_customer_id as "paddleCustomerId",
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
   * Process verified Creem webhook event idempotently and update subscription status.
   */
  static async handleWebhookEvent(event: {
    id: string;
    eventType: string;
    created_at?: number | string;
    object: any;
  }): Promise<{ success: boolean; message: string }> {
    const { id: eventId, eventType, created_at, object } = event;
    console.log(`[Creem Webhook] Processing event: ${eventType}`, { eventId, resourceId: object?.id });

    // 1. Strict Idempotency Check (Atomic insertion with concurrency handling)
    if (eventId) {
      const existing = await db.getOne<{ event_id: string }>(
        `SELECT event_id FROM processed_webhook_events WHERE event_id = $1`,
        [eventId]
      );
      if (existing) {
        console.log(`[Creem Webhook] Event ${eventId} already processed. Skipping (idempotent).`);
        return { success: true, message: `Event ${eventId} already processed (idempotent)` };
      }

      const occurredAt = created_at
        ? new Date(typeof created_at === 'number' ? (created_at > 1e11 ? created_at : created_at * 1000) : Date.parse(created_at)).toISOString()
        : new Date().toISOString();

      try {
        await db.execute(
          `INSERT INTO processed_webhook_events (event_id, event_type, occurred_at, processed_at)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
          [eventId, eventType, occurredAt]
        );
      } catch (err: any) {
        // Unique constraint violation on primary key handles concurrent delivery atomically
        if (err.code === '23505' || err.message?.includes('duplicate key') || err.message?.includes('PRIMARY KEY') || err.message?.includes('unique constraint')) {
          console.log(`[Creem Webhook] Concurrent duplicate event ${eventId} caught. Skipping (idempotent).`);
          return { success: true, message: `Event ${eventId} already processed (idempotent)` };
        }
        throw err;
      }
    }

    // Extract identifiers from object
    const metadata = object?.metadata || {};
    let organizationId = metadata?.organization_id || metadata?.organizationId;
    const creemSubId = object?.subscription?.id || object?.subscription_id || (object?.object === 'subscription' || eventType.startsWith('subscription.') ? object?.id : null);
    const creemCustomerId = object?.customer?.id || object?.customer_id || (object?.object === 'customer' ? object?.id : (typeof object?.customer === 'string' ? object?.customer : null));
    const creemCheckoutId = object?.object === 'checkout' ? object?.id : null;

    // Organization mapping fallback
    if (!organizationId && creemSubId) {
      const subRecord = await db.getOne<{ organization_id: string }>(
        `SELECT organization_id FROM subscriptions WHERE creem_subscription_id = $1`,
        [creemSubId]
      );
      if (subRecord?.organization_id) {
        organizationId = subRecord.organization_id;
      }
    }

    if (!organizationId && creemCustomerId) {
      const subRecord = await db.getOne<{ organization_id: string }>(
        `SELECT organization_id FROM subscriptions WHERE creem_customer_id = $1`,
        [creemCustomerId]
      );
      if (subRecord?.organization_id) {
        organizationId = subRecord.organization_id;
      }
    }

    if (!organizationId) {
      const customerEmail = object?.customer?.email || (typeof object?.customer === 'string' && object?.customer.includes('@') ? object?.customer : null);
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

    if (organizationId) {
      await AuditService.log({
        organizationId,
        action: AuditAction.CREEM_WEBHOOK_RECEIVED,
        entityType: 'CREEM_WEBHOOK',
        metadata: { eventType, eventId },
      });
    }

    // Event Handling
    switch (eventType) {
      case 'checkout.completed': {
        const subData = object?.subscription;
        const subId = (typeof subData === 'object' ? subData?.id : subData) || creemSubId;
        const rawProductId = object?.product?.id || object?.product_id || (typeof object?.product === 'string' ? object.product : null);
        const productId = rawProductId ? String(rawProductId).trim() : null;

        // Authoritatively map product ID to plan tier
        let matchedTier = this.resolvePlanTierFromProductId(productId);
        if (!matchedTier && metadata?.plan_tier) {
          const requested = String(metadata.plan_tier).toUpperCase();
          if (requested === 'STARTER' || requested === 'PRO' || requested === 'BUSINESS') {
            matchedTier = requested as PaidPlanTier;
          }
        }

        if (!matchedTier) {
          console.warn(`[Creem Webhook] Unknown or unmapped product_id "${productId}". Refusing to activate paid plan.`);
          if (organizationId) {
            await db.execute(
              `UPDATE subscriptions
               SET creem_customer_id = COALESCE($1, creem_customer_id),
                   creem_subscription_id = COALESCE($2, creem_subscription_id),
                   creem_checkout_id = COALESCE($3, creem_checkout_id),
                   creem_product_id = $4,
                   updated_at = CURRENT_TIMESTAMP
               WHERE organization_id = $5`,
              [creemCustomerId, subId, creemCheckoutId, productId, organizationId]
            );
          }
          break;
        }

        if (organizationId) {
          await db.execute(
            `UPDATE subscriptions
             SET creem_customer_id = COALESCE($1, creem_customer_id),
                 creem_subscription_id = COALESCE($2, creem_subscription_id),
                 creem_checkout_id = COALESCE($3, creem_checkout_id),
                 creem_product_id = COALESCE($4, creem_product_id),
                 plan_tier = $5,
                 status = $6,
                 cancel_at_period_end = FALSE,
                 updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = $7`,
            [creemCustomerId, subId, creemCheckoutId, productId, matchedTier, SubscriptionStatus.ACTIVE, organizationId]
          );

          await AuditService.log({
            organizationId,
            action: AuditAction.SUBSCRIPTION_ACTIVATED,
            entityType: 'SUBSCRIPTION',
            metadata: { creemSubscriptionId: subId, status: SubscriptionStatus.ACTIVE, planTier: matchedTier },
          });
        }
        break;
      }

      case 'subscription.active':
      case 'subscription.paid': {
        const rawProductId = object?.product?.id || object?.product_id || (typeof object?.product === 'string' ? object.product : null);
        const productId = rawProductId ? String(rawProductId).trim() : null;
        let matchedTier = this.resolvePlanTierFromProductId(productId);
        if (!matchedTier && metadata?.plan_tier) {
          const requested = String(metadata.plan_tier).toUpperCase();
          if (requested === 'STARTER' || requested === 'PRO' || requested === 'BUSINESS') {
            matchedTier = requested as PaidPlanTier;
          }
        }

        const periodStart = object?.current_period_start_date;
        const periodEnd = object?.current_period_end_date;

        if (organizationId) {
          // Out-of-order delivery safety check: Do not restore access if subscription is already CANCELED
          // and event occurred before the subscription was canceled.
          const currentSub = await db.getOne<{ status: string; updated_at: string }>(
            `SELECT status, updated_at FROM subscriptions WHERE organization_id = $1 OR creem_subscription_id = $2`,
            [organizationId, creemSubId]
          );

          if (currentSub?.status === SubscriptionStatus.CANCELED) {
            const eventTime = created_at
              ? new Date(typeof created_at === 'number' ? (created_at > 1e11 ? created_at : created_at * 1000) : Date.parse(created_at)).getTime()
              : 0;
            const subUpdatedTime = new Date(currentSub.updated_at).getTime();
            if (eventTime && subUpdatedTime && eventTime < subUpdatedTime) {
              console.warn(`[Creem Webhook] Out-of-order ${eventType} event received for canceled subscription. Ignoring.`);
              return { success: true, message: `Ignored out-of-order ${eventType} for canceled subscription` };
            }
          }

          await db.execute(
            `UPDATE subscriptions
             SET status = $1,
                 plan_tier = COALESCE($2, plan_tier),
                 creem_subscription_id = COALESCE($3, creem_subscription_id),
                 creem_customer_id = COALESCE($4, creem_customer_id),
                 creem_product_id = COALESCE($5, creem_product_id),
                 current_period_start = COALESCE($6, current_period_start),
                 current_period_end = COALESCE($7, current_period_end),
                 cancel_at_period_end = FALSE,
                 updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = $8 OR creem_subscription_id = $3`,
            [
              SubscriptionStatus.ACTIVE,
              matchedTier,
              creemSubId,
              creemCustomerId,
              productId,
              periodStart ? new Date(periodStart).toISOString() : null,
              periodEnd ? new Date(periodEnd).toISOString() : null,
              organizationId,
            ]
          );

          await AuditService.log({
            organizationId,
            action: AuditAction.SUBSCRIPTION_UPDATED,
            entityType: 'SUBSCRIPTION',
            metadata: { creemSubscriptionId: creemSubId, status: SubscriptionStatus.ACTIVE, planTier: matchedTier },
          });
        }
        break;
      }

      case 'subscription.scheduled_cancel': {
        if (organizationId || creemSubId) {
          await db.execute(
            `UPDATE subscriptions
             SET cancel_at_period_end = TRUE,
                 updated_at = CURRENT_TIMESTAMP
             WHERE creem_subscription_id = $1 OR organization_id = $2`,
            [creemSubId, organizationId]
          );

          if (organizationId) {
            await AuditService.log({
              organizationId,
              action: AuditAction.SUBSCRIPTION_UPDATED,
              entityType: 'SUBSCRIPTION',
              metadata: { creemSubscriptionId: creemSubId, cancelAtPeriodEnd: true },
            });
          }
        }
        break;
      }

      case 'subscription.canceled': {
        if (organizationId || creemSubId) {
          await db.execute(
            `UPDATE subscriptions
             SET status = $1,
                 cancel_at_period_end = TRUE,
                 updated_at = CURRENT_TIMESTAMP
             WHERE creem_subscription_id = $2 OR organization_id = $3`,
            [SubscriptionStatus.CANCELED, creemSubId, organizationId]
          );

          if (organizationId) {
            await AuditService.log({
              organizationId,
              action: AuditAction.SUBSCRIPTION_CANCELED,
              entityType: 'SUBSCRIPTION',
              metadata: { creemSubscriptionId: creemSubId },
            });
          }
        }
        break;
      }

      case 'subscription.past_due': {
        if (organizationId || creemSubId) {
          await db.execute(
            `UPDATE subscriptions
             SET status = $1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE creem_subscription_id = $2 OR organization_id = $3`,
            [SubscriptionStatus.PAST_DUE, creemSubId, organizationId]
          );

          if (organizationId) {
            await AuditService.log({
              organizationId,
              action: AuditAction.PAYMENT_FAILED,
              entityType: 'SUBSCRIPTION',
              metadata: { creemSubscriptionId: creemSubId, reason: 'past_due' },
            });
          }
        }
        break;
      }

      case 'subscription.unpaid':
      case 'subscription.expired': {
        if (organizationId || creemSubId) {
          await db.execute(
            `UPDATE subscriptions
             SET status = $1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE creem_subscription_id = $2 OR organization_id = $3`,
            [SubscriptionStatus.EXPIRED, creemSubId, organizationId]
          );

          if (organizationId) {
            await AuditService.log({
              organizationId,
              action: AuditAction.SUBSCRIPTION_EXPIRED,
              entityType: 'SUBSCRIPTION',
              metadata: { creemSubscriptionId: creemSubId },
            });
          }
        }
        break;
      }

      case 'refund.created': {
        if (organizationId) {
          await AuditService.log({
            organizationId,
            action: AuditAction.PAYMENT_FAILED,
            entityType: 'REFUND',
            metadata: { refundId: object?.id, reason: object?.reason },
          });
        }
        break;
      }
    }

    return { success: true, message: `Successfully handled ${eventType}` };
  }

  /**
   * Get subscription status and calculated access permissions for an organization.
   * Fully preserves existing subscribers (Creem & Paddle).
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
      `SELECT id, organization_id as "organizationId", creem_customer_id as "creemCustomerId",
              creem_subscription_id as "creemSubscriptionId", creem_checkout_id as "creemCheckoutId",
              creem_product_id as "creemProductId", paddle_customer_id as "paddleCustomerId",
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
        billingConfigured: config.creem.isConfigured,
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

    // Auto-update expired trial if trialing without active subscription
    const hasActiveSubscription = Boolean(sub.creemSubscriptionId || sub.paddleSubscriptionId);
    if (sub.status === SubscriptionStatus.TRIALING && !hasActiveSubscription && now > trialEndMs) {
      await db.execute(
        `UPDATE subscriptions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [SubscriptionStatus.EXPIRED, sub.id]
      );
      sub.status = SubscriptionStatus.EXPIRED;
    }

    // Determine plan tier and paid entitlement
    let planTier: PlanTier = 'TRIAL';
    const rawTier = (sub as any).planTier || (sub as any).plan_tier;
    const resolvedTier = rawTier ? rawTier.toUpperCase() : null;

    const isPaidActive =
      (sub.status === SubscriptionStatus.ACTIVE || sub.status === SubscriptionStatus.PAST_DUE) &&
      Boolean(resolvedTier && (resolvedTier === 'STARTER' || resolvedTier === 'PRO' || resolvedTier === 'BUSINESS'));

    if (isPaidActive && resolvedTier) {
      planTier = resolvedTier as PlanTier;
    } else {
      planTier = 'TRIAL';
    }

    const isTrialActive = sub.status === SubscriptionStatus.TRIALING && diffDays > 0;
    const isPro = isPaidActive || isTrialActive;

    return {
      subscription: sub,
      isPro,
      planTier,
      daysRemainingInTrial: diffDays,
      billingConfigured: config.creem.isConfigured,
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
   * Mint a Creem Customer Portal session URL.
   * If customer only has a legacy Paddle subscription, fall back safely.
   */
  static async createCustomerPortalSession(organizationId: string): Promise<{ url: string }> {
    const sub = await db.getOne<Subscription>(
      `SELECT id, creem_customer_id as "creemCustomerId", paddle_customer_id as "paddleCustomerId",
              creem_subscription_id as "creemSubscriptionId", paddle_subscription_id as "paddleSubscriptionId"
       FROM subscriptions WHERE organization_id = $1`,
      [organizationId]
    );

    if (sub?.creemCustomerId) {
      const creem = this.getCreemSdk();
      if (!creem) {
        throw new Error('Creem API is not configured on the server.');
      }
      const links = await creem.customers.generateBillingLinks({
        customerId: sub.creemCustomerId,
      });
      if (links?.customerPortalLink) {
        return { url: links.customerPortalLink };
      }
    }

    // Fallback: If customer is a legacy Paddle subscriber
    if (sub?.paddleCustomerId) {
      const { PaddleBillingService } = await import('./PaddleBillingService');
      return PaddleBillingService.createCustomerPortalSession(organizationId);
    }

    throw new Error('No customer record found for this organization. Please complete a checkout first.');
  }

  /**
   * Schedule subscription cancellation via Creem.
   * Fall back to Paddle cancellation if organization has a legacy Paddle subscription.
   */
  static async cancelSubscription(organizationId: string): Promise<{
    success: boolean;
    status: string;
    scheduledChange?: string | null;
  }> {
    const sub = await db.getOne<Subscription>(
      `SELECT id, creem_subscription_id as "creemSubscriptionId",
              paddle_subscription_id as "paddleSubscriptionId", status
       FROM subscriptions WHERE organization_id = $1`,
      [organizationId]
    );

    if (sub?.creemSubscriptionId) {
      const creem = this.getCreemSdk();
      if (creem) {
        try {
          await creem.subscriptions.cancel(sub.creemSubscriptionId, {
            mode: 'scheduled',
          });
        } catch (err: any) {
          console.warn(`[Creem Cancel Warning] ${err.message}`);
        }
      }

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
        metadata: { creemSubscriptionId: sub.creemSubscriptionId },
      });

      return {
        success: true,
        status: sub.status,
        scheduledChange: new Date(Date.now() + 30 * 86400000).toISOString(),
      };
    }

    // Fallback: Legacy Paddle subscription cancellation
    if (sub?.paddleSubscriptionId) {
      const { PaddleBillingService } = await import('./PaddleBillingService');
      return PaddleBillingService.cancelSubscription(organizationId);
    }

    throw new Error('No active subscription found for this organization.');
  }
}
