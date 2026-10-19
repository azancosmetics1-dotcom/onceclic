import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db';
import { config } from '../../config';
import { AuditService } from '../AuditService';
import {
  AuditAction,
  SubscriptionStatus,
  PhoneNumberCheckoutSession,
} from '@onceclic/shared';
import { PhoneNumberPricingService } from './PhoneNumberPricingService';
import { Paddle, Environment } from '@paddle/paddle-node-sdk';

export class PhoneNumberBillingService {
  private static getPaddleSdk(): Paddle | null {
    if (!config.paddle.apiKey || config.paddle.apiKey.includes('placeholder')) {
      return null;
    }
    return new Paddle(config.paddle.apiKey, {
      environment: config.paddle.environment === 'production' ? Environment.production : Environment.sandbox,
    });
  }

  /**
   * Create an explicit customer checkout session for a phone number rental.
   * This authorizes billing before any real Telnyx order or provider commitment.
   */
  static async createCheckoutSession(params: {
    organizationId: string;
    phoneNumber: string;
    countryCode: string;
    numberType?: string;
    expectedMonthlyCostUsd?: number;
    expectedSetupCostUsd?: number;
    idempotencyKey?: string;
  }): Promise<PhoneNumberCheckoutSession & { checkoutPayload: any }> {
    // 1. Subscription & Trial entitlement check
    const sub = await db.getOne<{ status: string; trial_ends_at: string }>(
      'SELECT status, trial_ends_at FROM subscriptions WHERE organization_id = $1',
      [params.organizationId]
    );

    const now = new Date();
    const isSubActive =
      sub &&
      (sub.status === SubscriptionStatus.ACTIVE ||
        (sub.status === SubscriptionStatus.TRIALING && new Date(sub.trial_ends_at) > now));

    if (!isSubActive) {
      throw new Error('An active subscription or valid trial is required to purchase and rent a business phone number.');
    }

    const country = (params.countryCode || 'US').toUpperCase().trim();
    const type = (params.numberType || 'local').toLowerCase();

    // 2. Authoritative Server-Side Pricing (Telnyx cost + $1.00 markup)
    const quote = PhoneNumberPricingService.getAuthoritativePricing({
      countryCode: country,
      numberType: type,
      phoneNumber: params.phoneNumber,
    });

    // 3. Server-side validation of client expected price (prevent tampered client values)
    PhoneNumberPricingService.validateCustomerPrice({
      expectedCustomerMonthlyCostUsd: params.expectedMonthlyCostUsd,
      expectedSetupCostUsd: params.expectedSetupCostUsd,
      authoritativeProviderMonthlyCostUsd: quote.providerCostUsd,
      authoritativeProviderSetupCostUsd: quote.setupCostUsd,
    });

    // 4. Check for existing active checkout with same idempotency key
    if (params.idempotencyKey) {
      const existing = await db.getOne<any>(
        `SELECT id, organization_id as "organizationId", phone_number as "phoneNumber",
                country_code as "countryCode", number_type as "numberType",
                provider_cost_usd as "providerCostUsd", markup_usd as "markupUsd",
                customer_monthly_cost_usd as "customerMonthlyCostUsd", setup_cost_usd as "setupCostUsd",
                currency, pricing_policy_version as "pricingPolicyVersion", status,
                paddle_transaction_id as "paddleTransactionId", paddle_subscription_id as "paddleSubscriptionId",
                expires_at as "expiresAt", created_at as "createdAt"
         FROM voice_phone_number_checkouts
         WHERE organization_id = $1 AND idempotency_key = $2 AND status IN ('PENDING', 'AUTHORIZED', 'PAID')
         LIMIT 1`,
        [params.organizationId, params.idempotencyKey]
      );
      if (existing) {
        return {
          ...existing,
          providerCostUsd: Number(existing.providerCostUsd),
          markupUsd: Number(existing.markupUsd),
          customerMonthlyCostUsd: Number(existing.customerMonthlyCostUsd),
          setupCostUsd: Number(existing.setupCostUsd),
          checkoutPayload: {
            checkoutId: existing.id,
            customData: {
              type: 'phone_number_rental',
              organization_id: params.organizationId,
              phone_number: params.phoneNumber,
              checkout_id: existing.id,
            },
          },
        };
      }
    }

    // 5. Create durable checkout session in database
    const checkoutId = `pnc_${uuidv4().replace(/-/g, '')}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min expiration

    await db.execute(
      `INSERT INTO voice_phone_number_checkouts (
         id, organization_id, phone_number, country_code, number_type,
         provider_cost_usd, markup_usd, customer_monthly_cost_usd, setup_cost_usd,
         currency, pricing_policy_version, status, idempotency_key, expires_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDING', $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        checkoutId,
        params.organizationId,
        params.phoneNumber,
        country,
        type,
        quote.providerCostUsd,
        quote.markupUsd,
        quote.customerMonthlyPriceUsd,
        quote.setupCostUsd,
        quote.currency,
        quote.policyVersion,
        params.idempotencyKey || null,
        expiresAt,
      ]
    );

    const session: PhoneNumberCheckoutSession = {
      id: checkoutId,
      organizationId: params.organizationId,
      phoneNumber: params.phoneNumber,
      countryCode: country,
      numberType: type,
      providerCostUsd: quote.providerCostUsd,
      markupUsd: quote.markupUsd,
      customerMonthlyCostUsd: quote.customerMonthlyPriceUsd,
      setupCostUsd: quote.setupCostUsd,
      currency: quote.currency,
      pricingPolicyVersion: quote.policyVersion,
      status: 'PENDING',
      expiresAt,
      createdAt: new Date().toISOString(),
    };

    const checkoutPayload = {
      checkoutId,
      customerMonthlyCostUsd: quote.customerMonthlyPriceUsd,
      setupCostUsd: quote.setupCostUsd,
      proMonthlyCostUsd: quote.proSubscriptionUsd,
      combinedMonthlyTotalUsd: quote.combinedMonthlyTotalUsd,
      separateFromProNotice: quote.separateFromProNotice,
      taxNotice: quote.taxNotice,
      customData: {
        type: 'phone_number_rental',
        organization_id: params.organizationId,
        phone_number: params.phoneNumber,
        checkout_id: checkoutId,
      },
    };

    return { ...session, checkoutPayload };
  }

  /**
   * Retrieve a checkout session by ID
   */
  static async getCheckoutSession(organizationId: string, checkoutId: string): Promise<PhoneNumberCheckoutSession | null> {
    const res = await db.getOne<any>(
      `SELECT id, organization_id as "organizationId", phone_number as "phoneNumber",
              country_code as "countryCode", number_type as "numberType",
              provider_cost_usd as "providerCostUsd", markup_usd as "markupUsd",
              customer_monthly_cost_usd as "customerMonthlyCostUsd", setup_cost_usd as "setupCostUsd",
              currency, pricing_policy_version as "pricingPolicyVersion", status,
              paddle_transaction_id as "paddleTransactionId", paddle_subscription_id as "paddleSubscriptionId",
              expires_at as "expiresAt", created_at as "createdAt"
       FROM voice_phone_number_checkouts
       WHERE organization_id = $1 AND id = $2`,
      [organizationId, checkoutId]
    );

    if (!res) return null;

    return {
      ...res,
      providerCostUsd: Number(res.providerCostUsd),
      markupUsd: Number(res.markupUsd),
      customerMonthlyCostUsd: Number(res.customerMonthlyCostUsd),
      setupCostUsd: Number(res.setupCostUsd),
    };
  }

  /**
   * Authorize a checkout session after verified customer payment authorization.
   */
  static async authorizeCheckoutSession(params: {
    organizationId: string;
    checkoutId: string;
    paddleTransactionId?: string;
    paddleSubscriptionId?: string;
  }): Promise<PhoneNumberCheckoutSession> {
    const existing = await this.getCheckoutSession(params.organizationId, params.checkoutId);
    if (!existing) {
      throw new Error('Checkout session not found.');
    }

    if (new Date(existing.expiresAt) < new Date()) {
      throw new Error('Checkout session has expired. Please initiate a new number order.');
    }

    if (existing.status === 'CANCELLED') {
      throw new Error('Checkout session was cancelled.');
    }

    await db.execute(
      `UPDATE voice_phone_number_checkouts
       SET status = 'AUTHORIZED',
           paddle_transaction_id = COALESCE($1, paddle_transaction_id),
           paddle_subscription_id = COALESCE($2, paddle_subscription_id),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND organization_id = $4`,
      [params.paddleTransactionId || null, params.paddleSubscriptionId || null, params.checkoutId, params.organizationId]
    );

    return (await this.getCheckoutSession(params.organizationId, params.checkoutId))!;
  }

  /**
   * Cancel an in-flight checkout session.
   */
  static async cancelCheckoutSession(organizationId: string, checkoutId: string): Promise<boolean> {
    const count = await db.execute(
      `UPDATE voice_phone_number_checkouts
       SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND organization_id = $2 AND status = 'PENDING'`,
      [checkoutId, organizationId]
    );
    return count > 0;
  }

  /**
   * Mark a checkout session as failed (e.g. payment failure).
   */
  static async failCheckoutSession(organizationId: string, checkoutId: string, reason: string): Promise<boolean> {
    const count = await db.execute(
      `UPDATE voice_phone_number_checkouts
       SET status = 'FAILED', failure_reason = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND organization_id = $3`,
      [reason, checkoutId, organizationId]
    );
    return count > 0;
  }

  /**
   * Handle incoming verified Paddle webhook events for phone number rental.
   * Completely isolated from base Pro software subscription events!
   */
  static async handleWebhookEvent(event: {
    event_id: string;
    event_type: string;
    occurred_at: string;
    data: any;
  }): Promise<{ success: boolean; message: string }> {
    const { event_type, data } = event;
    const customData = data?.custom_data || data?.customData || {};
    const organizationId = customData?.organization_id || customData?.organizationId;
    const checkoutId = customData?.checkout_id || customData?.checkoutId;
    const phoneNumber = customData?.phone_number || customData?.phoneNumber;
    const paddleSubId = data?.id || data?.subscription_id;
    const paddleTxnId = data?.transaction_id || data?.id;

    console.log(`[PhoneNumberBilling] Handling webhook ${event_type}`, { organizationId, checkoutId, phoneNumber });

    switch (event_type) {
      case 'transaction.completed': {
        if (checkoutId && organizationId) {
          await db.execute(
            `UPDATE voice_phone_number_checkouts
             SET status = 'PAID',
                 paddle_transaction_id = $1,
                 paddle_subscription_id = COALESCE($2, paddle_subscription_id),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $3 AND organization_id = $4`,
            [paddleTxnId, paddleSubId || null, checkoutId, organizationId]
          );
        }

        if (phoneNumber) {
          await db.execute(
            `UPDATE voice_phone_numbers
             SET billing_status = 'PAID',
                 paddle_transaction_id = $1,
                 paddle_subscription_id = COALESCE($2, paddle_subscription_id),
                 updated_at = CURRENT_TIMESTAMP
             WHERE phone_number = $3`,
            [paddleTxnId, paddleSubId || null, phoneNumber]
          );
        }
        break;
      }

      case 'subscription.created':
      case 'subscription.activated': {
        if (phoneNumber) {
          await db.execute(
            `UPDATE voice_phone_numbers
             SET billing_status = 'ACTIVE',
                 paddle_subscription_id = $1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE phone_number = $2`,
            [paddleSubId, phoneNumber]
          );
        }
        if (checkoutId && organizationId) {
          await db.execute(
            `UPDATE voice_phone_number_checkouts
             SET status = 'AUTHORIZED',
                 paddle_subscription_id = $1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2 AND organization_id = $3`,
            [paddleSubId, checkoutId, organizationId]
          );
        }
        break;
      }

      case 'subscription.updated': {
        const scheduledChange = data?.scheduled_change || data?.scheduledChange;
        const cancelAtPeriodEnd = scheduledChange?.action === 'cancel' || scheduledChange?.action === 'canceled';
        const paddleStatus = (data?.status || 'active').toLowerCase();
        let billingStatus = 'ACTIVE';
        if (paddleStatus === 'past_due') billingStatus = 'PAYMENT_FAILED';
        if (paddleStatus === 'canceled') billingStatus = 'CANCELED';

        if (paddleSubId) {
          await db.execute(
            `UPDATE voice_phone_numbers
             SET billing_status = $1,
                 cancel_at_period_end = $2,
                 updated_at = CURRENT_TIMESTAMP
             WHERE paddle_subscription_id = $3`,
            [billingStatus, cancelAtPeriodEnd, paddleSubId]
          );
        }
        break;
      }

      case 'subscription.canceled': {
        if (paddleSubId) {
          await db.execute(
            `UPDATE voice_phone_numbers
             SET billing_status = 'CANCELED',
                 cancel_at_period_end = TRUE,
                 canceled_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE paddle_subscription_id = $1`,
            [paddleSubId]
          );
        }
        break;
      }

      case 'transaction.payment_failed': {
        if (phoneNumber) {
          await db.execute(
            `UPDATE voice_phone_numbers
             SET billing_status = 'PAYMENT_FAILED',
                 updated_at = CURRENT_TIMESTAMP
             WHERE phone_number = $1`,
            [phoneNumber]
          );
        }
        if (organizationId) {
          await AuditService.log({
            organizationId,
            action: AuditAction.PAYMENT_FAILED,
            entityType: 'VOICE_PHONE_NUMBER',
            metadata: { phoneNumber, error: data?.error_code || 'payment_failed' },
          });
        }
        break;
      }
    }

    return { success: true, message: `Handled phone number rental event ${event_type}` };
  }

  /**
   * Cancel phone-number rental subscription.
   * Cancelling a phone number does NOT cancel or affect the organization's Pro software subscription!
   */
  static async cancelPhoneNumberRental(organizationId: string, phoneNumberId: string): Promise<{
    success: boolean;
    cancelAtPeriodEnd: boolean;
    message: string;
  }> {
    const record = await db.getOne<any>(
      'SELECT id, phone_number, paddle_subscription_id, billing_status FROM voice_phone_numbers WHERE id = $1 AND organization_id = $2',
      [phoneNumberId, organizationId]
    );

    if (!record) {
      throw new Error('Phone number record not found.');
    }

    // Call Paddle SDK if configured
    const paddle = this.getPaddleSdk();
    if (paddle && record.paddle_subscription_id) {
      try {
        await paddle.subscriptions.cancel(record.paddle_subscription_id, {
          effectiveFrom: 'next_billing_period',
        });
      } catch (err: any) {
        console.warn(`[PhoneNumberBilling] Paddle cancel notice: ${err.message}`);
      }
    }

    await db.execute(
      `UPDATE voice_phone_numbers
       SET cancel_at_period_end = TRUE,
           billing_status = 'CANCELED',
           canceled_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND organization_id = $2`,
      [phoneNumberId, organizationId]
    );

    await AuditService.log({
      organizationId,
      action: AuditAction.VOICE_NUMBER_DISCONNECTED,
      entityType: 'VOICE_PHONE_NUMBER',
      entityId: phoneNumberId,
      metadata: { phoneNumber: record.phone_number, action: 'rental_cancelled' },
    });

    return {
      success: true,
      cancelAtPeriodEnd: true,
      message: `Phone number rental for ${record.phone_number} has been cancelled at the end of the current billing cycle. Your Pro subscription remains active.`,
    };
  }

  /**
   * Process and record a safe, idempotent refund for a failed provisioning or customer return.
   */
  static async processRefund(params: {
    organizationId: string;
    phoneNumberId: string;
    amountUsd?: number;
    reason?: string;
  }): Promise<{ success: boolean; amountRefunded: number }> {
    const record = await db.getOne<any>(
      'SELECT id, customer_monthly_cost_usd, setup_cost_usd, refund_status, refund_amount_usd FROM voice_phone_numbers WHERE id = $1 AND organization_id = $2',
      [params.phoneNumberId, params.organizationId]
    );

    if (!record) {
      throw new Error('Phone number not found.');
    }

    if (record.refund_status === 'REFUNDED') {
      return { success: true, amountRefunded: Number(record.refund_amount_usd || 0) };
    }

    const defaultAmount = Number(record.customer_monthly_cost_usd || 0) + Number(record.setup_cost_usd || 0);
    const refundAmount = params.amountUsd !== undefined ? Number(params.amountUsd) : defaultAmount;

    await db.execute(
      `UPDATE voice_phone_numbers
       SET refund_status = 'REFUNDED',
           refund_amount_usd = $1,
           refunded_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND organization_id = $3`,
      [refundAmount, params.phoneNumberId, params.organizationId]
    );

    return { success: true, amountRefunded: refundAmount };
  }
}
