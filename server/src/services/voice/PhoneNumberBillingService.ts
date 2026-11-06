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
import { CreemBillingService } from '../CreemBillingService';

export class PhoneNumberBillingService {
  /**
   * Concurrency lock map to serialize checkout and reservation creation per organization.
   * Guarantees atomic check-and-reserve so multi-tab requests cannot bypass plan quotas.
   */
  private static inFlightReservations: Map<string, Promise<any>> = new Map();

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
   *
   * Enforces:
   * 1. Concurrency-safe atomic quota reservations.
   * 2. Dedicated recurring Creem checkout ($3.00/month).
   * 3. Metadata tracking for reliable webhook routing.
   */
  static async createCheckoutSession(params: {
    organizationId: string;
    phoneNumber: string;
    countryCode: string;
    numberType?: string;
    expectedMonthlyCostUsd?: number;
    expectedSetupCostUsd?: number;
    idempotencyKey?: string;
    userEmail?: string;
    userName?: string;
  }): Promise<PhoneNumberCheckoutSession & { checkoutPayload: any; checkoutUrl?: string }> {
    const orgLockKey = `res_lock_${params.organizationId}`;

    // If an in-flight reservation exists for this organization, wait for it to ensure serialization
    if (this.inFlightReservations.has(orgLockKey)) {
      try {
        await this.inFlightReservations.get(orgLockKey);
      } catch {
        // Proceed even if prior attempt failed
      }
    }

    const reservationPromise = this.executeCreateCheckoutSession(params);
    this.inFlightReservations.set(orgLockKey, reservationPromise);

    try {
      return await reservationPromise;
    } finally {
      this.inFlightReservations.delete(orgLockKey);
    }
  }

  private static async executeCreateCheckoutSession(params: {
    organizationId: string;
    phoneNumber: string;
    countryCode: string;
    numberType?: string;
    expectedMonthlyCostUsd?: number;
    expectedSetupCostUsd?: number;
    idempotencyKey?: string;
    userEmail?: string;
    userName?: string;
  }): Promise<PhoneNumberCheckoutSession & { checkoutPayload: any; checkoutUrl?: string }> {
    const { VoiceService } = await import('./VoiceService');

    // Execute atomic reservation within a database transaction with organization-level locks.
    // Guarantees distributed multi-instance quota safety across Railway containers.
    const res = await db.withTransaction(async (tx) => {
      // 1. Organization-specific PostgreSQL advisory transaction lock
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`phone_res_${params.organizationId}`]);

      // 1b. Subscription & Trial entitlement check with row lock FOR UPDATE
      const sub = await tx.getOne<{ status: string; trial_ends_at: string; creem_customer_id?: string; plan_tier?: string }>(
        'SELECT status, trial_ends_at, creem_customer_id, plan_tier FROM subscriptions WHERE organization_id = $1 FOR UPDATE',
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

      // 2. Atomic phone number quota reservation check (counts active + unexpired pending reservations)
      const quotaCheck = await VoiceService.checkPhoneNumberLimit(params.organizationId, tx, {
        includePendingReservations: true,
      });

      if (!quotaCheck.allowed) {
        const planName = quotaCheck.planTier === 'TRIAL' ? 'Free Trial'
          : quotaCheck.planTier === 'STARTER' ? 'Starter ($19/mo)'
          : quotaCheck.planTier === 'PRO' ? 'Pro ($49/mo)'
          : 'Business ($99/mo)';
        throw new Error(
          `Phone number limit reached. Your ${planName} plan allows a maximum of ${quotaCheck.limit} active phone number${quotaCheck.limit === 1 ? '' : 's'}. ` +
          `You currently have ${quotaCheck.activeCount} active and ${quotaCheck.pendingCount} pending reservation${quotaCheck.pendingCount === 1 ? '' : 's'}. Please upgrade your plan to add more numbers.`
        );
      }

      // 3. Format and validate phone number
      const normalized = VoiceService.normalizePhoneNumber(params.phoneNumber);
      if (!normalized || normalized.length < 7) {
        throw new Error('Invalid phone number format.');
      }

      const country = (params.countryCode || 'US').toUpperCase().trim();
      const type = (params.numberType || 'local').toLowerCase();

      // Check if phone number is already owned by another tenant
      const existingNum = await tx.getOne<{ id: string; organization_id: string; status: string; provisioning_status: string }>(
        'SELECT id, organization_id, status, provisioning_status FROM voice_phone_numbers WHERE phone_number = $1',
        [normalized]
      );
      if (existingNum && existingNum.organization_id !== params.organizationId) {
        throw new Error('This phone number is already registered to another organization.');
      }
      if (existingNum && (existingNum.status === 'ACTIVE' || existingNum.provisioning_status === 'ACTIVE')) {
        throw new Error('This phone number has already been provisioned for your organization.');
      }

      // 4. Validate Creem Dedicated Phone Number Product configuration
      const productId = config.creem.phoneNumberProductId;
      const isProductIdValid = Boolean(
        productId &&
        !productId.includes('placeholder') &&
        !productId.includes('your_') &&
        productId.trim().length > 0
      );

      if (!isProductIdValid && process.env.NODE_ENV !== 'test') {
        console.warn('[PhoneNumberBilling] Phone number checkout attempted but CREEM_PHONE_NUMBER_PRODUCT_ID is missing or not configured on the server.');
        throw new Error('Dedicated phone number checkout is currently unavailable. Please contact support or check back later.');
      }

      // Safety guard: Test/sandbox product IDs cannot be used in production environment
      if (config.creem.environment === 'prod' && (productId?.toLowerCase().includes('test') || productId?.toLowerCase().includes('sandbox'))) {
        console.warn('[PhoneNumberBilling] Test phone number product ID cannot be used in production environment.');
        throw new Error('Dedicated phone number checkout is currently unavailable. Please contact support or check back later.');
      }

      // 5. Authoritative Pricing ($3.00/month recurring)
      const quote = PhoneNumberPricingService.getAuthoritativePricing({
        countryCode: country,
        numberType: type,
        phoneNumber: normalized,
      });

      PhoneNumberPricingService.validateCustomerPrice({
        expectedCustomerMonthlyCostUsd: params.expectedMonthlyCostUsd,
        expectedSetupCostUsd: params.expectedSetupCostUsd,
        authoritativeProviderMonthlyCostUsd: quote.providerCostUsd,
        authoritativeProviderSetupCostUsd: quote.setupCostUsd,
      });

      // 6. Check for existing active checkout with same idempotency key
      if (params.idempotencyKey) {
        const existing = await tx.getOne<any>(
          `SELECT id, organization_id as "organizationId", phone_number as "phoneNumber",
                  country_code as "countryCode", number_type as "numberType",
                  provider_cost_usd as "providerCostUsd", markup_usd as "markupUsd",
                  customer_monthly_cost_usd as "customerMonthlyCostUsd", setup_cost_usd as "setupCostUsd",
                  currency, pricing_policy_version as "pricingPolicyVersion", status,
                  paddle_transaction_id as "paddleTransactionId", paddle_subscription_id as "paddleSubscriptionId",
                  creem_checkout_id as "creemCheckoutId", creem_subscription_id as "creemSubscriptionId",
                  creem_customer_id as "creemCustomerId", creem_product_id as "creemProductId",
                  reservation_id as "reservationId",
                  expires_at as "expiresAt", created_at as "createdAt"
           FROM voice_phone_number_checkouts
           WHERE organization_id = $1 AND idempotency_key = $2 AND status IN ('PENDING', 'AUTHORIZED', 'PAID')
             AND expires_at > CURRENT_TIMESTAMP
           LIMIT 1`,
          [params.organizationId, params.idempotencyKey]
        );
        if (existing) {
          return { existingCheckout: existing, normalized, country, type, quote, productId, sub };
        }
      }

      // 7. Create durable checkout session and atomic reservation record
      const checkoutId = `pnc_${uuidv4().replace(/-/g, '')}`;
      const reservationId = `res_${uuidv4().replace(/-/g, '')}`;
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min reservation expiry
      const customerMonthlyCostUsd = 3.00; // Flat $3/month independent recurring fee

      await tx.execute(
        `INSERT INTO voice_phone_number_checkouts (
           id, organization_id, phone_number, country_code, number_type,
           provider_cost_usd, markup_usd, customer_monthly_cost_usd, setup_cost_usd,
           currency, pricing_policy_version, status, idempotency_key, expires_at,
           creem_product_id, reservation_id, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDING', $12, $13, $14, $15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          checkoutId,
          params.organizationId,
          normalized,
          country,
          type,
          quote.providerCostUsd,
          quote.markupUsd,
          customerMonthlyCostUsd,
          quote.setupCostUsd,
          'USD',
          quote.policyVersion,
          params.idempotencyKey || null,
          expiresAt,
          productId || null,
          reservationId,
        ]
      );

      return {
        checkoutId,
        reservationId,
        expiresAt,
        customerMonthlyCostUsd,
        normalized,
        country,
        type,
        quote,
        productId,
        sub,
      };
    });

    if (res.existingCheckout) {
      const existing = res.existingCheckout;
      return {
        ...existing,
        providerCostUsd: Number(existing.providerCostUsd),
        markupUsd: Number(existing.markupUsd),
        customerMonthlyCostUsd: Number(existing.customerMonthlyCostUsd),
        setupCostUsd: Number(existing.setupCostUsd),
        checkoutUrl: existing.creemCheckoutId ? `https://checkout.creem.io/c/${existing.creemCheckoutId}` : undefined,
        checkoutPayload: {
          checkoutId: existing.id,
          reservationId: existing.reservationId,
          creemCheckoutId: existing.creemCheckoutId,
          customerMonthlyCostUsd: Number(existing.customerMonthlyCostUsd),
          customData: {
            type: 'PHONE_NUMBER',
            organization_id: params.organizationId,
            phone_number: res.normalized,
            checkout_id: existing.id,
            reservation_id: existing.reservationId,
          },
        },
      };
    }

    const checkoutId = res.checkoutId!;
    const reservationId = res.reservationId!;
    const expiresAt = res.expiresAt!;
    const customerMonthlyCostUsd = res.customerMonthlyCostUsd ?? 3.00;
    const normalized = res.normalized;
    const country = res.country;
    const type = res.type;
    const quote = res.quote;
    const productId = res.productId;
    const sub = res.sub;

    // 8. Create independent Creem checkout session
    const creem = CreemBillingService.getCreemSdk();
    let checkoutUrl = '';
    let creemCheckoutId: string | undefined = undefined;

    if (creem && productId) {
      let customerEmail = params.userEmail;
      let customerName = params.userName;
      let creemCustomerId: string | undefined = sub?.creem_customer_id;

      if (!customerEmail) {
        const owner = await db.getOne<{ email: string; full_name: string }>(
          `SELECT u.email, u.full_name
           FROM organization_memberships om
           JOIN users u ON om.user_id = u.id
           WHERE om.organization_id = $1 AND om.role = 'OWNER'
           ORDER BY om.created_at ASC
           LIMIT 1`,
          [params.organizationId]
        );
        if (owner) {
          customerEmail = owner.email;
          customerName = customerName || owner.full_name;
        }
      }

      const successUrl = `${config.app.url || 'http://localhost:5173'}/dashboard/receptionist?checkout=success&phone=${encodeURIComponent(normalized)}&checkoutId=${checkoutId}`;

      try {
        const creemSession = await creem.checkouts.create({
          productId,
          customer: {
            id: creemCustomerId || undefined,
            email: customerEmail || undefined,
            name: customerName || undefined,
          },
          successUrl,
          metadata: {
            type: 'PHONE_NUMBER',
            organizationId: params.organizationId,
            phoneNumber: normalized,
            countryCode: country,
            numberType: type,
            checkoutSessionId: checkoutId,
            reservationId,
          },
        });

        if (creemSession?.checkoutUrl) {
          checkoutUrl = creemSession.checkoutUrl;
          creemCheckoutId = creemSession.id;
        }
      } catch (creemErr: any) {
        await db.execute(
          `UPDATE voice_phone_number_checkouts
           SET status = 'CANCELLED', failure_reason = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [`Creem checkout creation failed: ${creemErr.message}`, checkoutId]
        );
        throw new Error(`Failed to create checkout session with Creem: ${creemErr.message}`);
      }
    } else {
      // Test mode / Mock fallback URL when live Creem API key is not configured
      checkoutUrl = `${config.app.url || 'http://localhost:5173'}/dashboard/receptionist?mock_checkout=true&checkoutId=${checkoutId}&phone=${encodeURIComponent(normalized)}`;
      creemCheckoutId = `chk_test_${checkoutId}`;
    }

    if (creemCheckoutId) {
      await db.execute(
        `UPDATE voice_phone_number_checkouts
         SET creem_checkout_id = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [creemCheckoutId, checkoutId]
      );
    }

    const session: PhoneNumberCheckoutSession = {
      id: checkoutId,
      organizationId: params.organizationId,
      phoneNumber: normalized,
      countryCode: country,
      numberType: type,
      providerCostUsd: quote.providerCostUsd,
      markupUsd: quote.markupUsd,
      customerMonthlyCostUsd,
      setupCostUsd: quote.setupCostUsd,
      currency: 'USD',
      pricingPolicyVersion: quote.policyVersion,
      status: 'PENDING',
      creemCheckoutId,
      creemProductId: productId || undefined,
      reservationId,
      checkoutUrl,
      expiresAt,
      createdAt: new Date().toISOString(),
    };

    const checkoutPayload = {
      checkoutId,
      reservationId,
      creemCheckoutId,
      customerMonthlyCostUsd,
      setupCostUsd: quote.setupCostUsd,
      separateFromPlanNotice: 'Phone-number rental is billed as an independent recurring subscription of $3.00/month via Creem, completely separate from your main ONCEClic subscription.',
      taxNotice: 'Applicable sales tax or VAT is calculated by Creem at checkout based on your billing address.',
      customData: {
        type: 'PHONE_NUMBER',
        organization_id: params.organizationId,
        phone_number: normalized,
        checkout_id: checkoutId,
        reservation_id: reservationId,
      },
    };

    return { ...session, checkoutPayload, checkoutUrl };
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
              creem_checkout_id as "creemCheckoutId", creem_subscription_id as "creemSubscriptionId",
              creem_customer_id as "creemCustomerId", creem_product_id as "creemProductId",
              reservation_id as "reservationId",
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
    creemSubscriptionId?: string;
    creemCustomerId?: string;
    paddleTransactionId?: string;
    paddleSubscriptionId?: string;
  }): Promise<PhoneNumberCheckoutSession> {
    const existing = await this.getCheckoutSession(params.organizationId, params.checkoutId);
    if (!existing) {
      throw new Error('Checkout session not found.');
    }

    if (new Date(existing.expiresAt) < new Date() && existing.status === 'PENDING') {
      throw new Error('Checkout session has expired. Please initiate a new number order.');
    }

    if (existing.status === 'CANCELLED') {
      throw new Error('Checkout session was cancelled.');
    }

    await db.execute(
      `UPDATE voice_phone_number_checkouts
       SET status = 'PAID',
           creem_subscription_id = COALESCE($1, creem_subscription_id),
           creem_customer_id = COALESCE($2, creem_customer_id),
           paddle_transaction_id = COALESCE($3, paddle_transaction_id),
           paddle_subscription_id = COALESCE($4, paddle_subscription_id),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 AND organization_id = $6`,
      [
        params.creemSubscriptionId || null,
        params.creemCustomerId || null,
        params.paddleTransactionId || null,
        params.paddleSubscriptionId || null,
        params.checkoutId,
        params.organizationId,
      ]
    );

    return (await this.getCheckoutSession(params.organizationId, params.checkoutId))!;
  }

  /**
   * Cancel an in-flight checkout session and immediately release the pending quota reservation.
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
   * Cancel phone-number rental subscription.
   * Cancelling a phone number does NOT cancel or affect the organization's main plan subscription!
   */
  static async cancelPhoneNumberRental(organizationId: string, phoneNumberId: string): Promise<{
    success: boolean;
    cancelAtPeriodEnd: boolean;
    message: string;
  }> {
    const record = await db.getOne<any>(
      `SELECT id, phone_number, creem_subscription_id, paddle_subscription_id, billing_status, cancel_at_period_end
       FROM voice_phone_numbers
       WHERE id = $1 AND organization_id = $2`,
      [phoneNumberId, organizationId]
    );

    if (!record) {
      throw new Error('Phone number record not found.');
    }

    if (record.cancel_at_period_end || record.billing_status === 'CANCELED') {
      return {
        success: true,
        cancelAtPeriodEnd: true,
        message: `Phone number subscription for ${record.phone_number} is already scheduled for cancellation.`,
      };
    }

    // 1. Cancel Creem subscription scheduled at period end
    if (record.creem_subscription_id) {
      const creem = CreemBillingService.getCreemSdk();
      if (creem) {
        try {
          await creem.subscriptions.cancel(record.creem_subscription_id, {
            mode: 'scheduled',
          });
        } catch (err: any) {
          console.error(`[PhoneNumberBilling] Creem subscription cancel failed: ${err.message}`);
          await db.execute(
            `UPDATE voice_phone_numbers
             SET cancellation_status = 'FAILED',
                 cancellation_error = $1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2 AND organization_id = $3`,
            [err.message, phoneNumberId, organizationId]
          );
          throw new Error(`Failed to schedule cancellation with payment provider: ${err.message}. Please try again or contact support.`);
        }
      }
    }

    // 2. Backward compatibility: Cancel Paddle subscription if present
    if (record.paddle_subscription_id) {
      const paddle = this.getPaddleSdk();
      if (paddle) {
        try {
          await paddle.subscriptions.cancel(record.paddle_subscription_id, {
            effectiveFrom: 'next_billing_period',
          });
        } catch (err: any) {
          console.warn(`[PhoneNumberBilling] Paddle cancel notice: ${err.message}`);
        }
      }
    }

    await db.execute(
      `UPDATE voice_phone_numbers
       SET cancel_at_period_end = TRUE,
           billing_status = 'CANCELED',
           cancellation_status = 'SCHEDULED',
           cancellation_error = NULL,
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
      message: `Phone number rental for ${record.phone_number} has been scheduled for cancellation at the end of the billing period. Your main subscription remains active.`,
    };
  }

  /**
   * Process and record a safe, idempotent refund for a failed provisioning or customer return.
   * Full refund of the dedicated phone number rental is executed through Creem.
   */
  static async processRefund(params: {
    organizationId: string;
    phoneNumberId: string;
    transactionId?: string;
    reason?: string;
    amountUsd?: number;
  }): Promise<{ success: boolean; amountRefunded: number }> {
    const record = await db.getOne<any>(
      `SELECT id, customer_monthly_cost_usd, setup_cost_usd, refund_status, refund_amount_usd,
              creem_subscription_id
       FROM voice_phone_numbers
       WHERE id = $1 AND organization_id = $2`,
      [params.phoneNumberId, params.organizationId]
    );

    if (!record) {
      throw new Error('Phone number not found.');
    }

    if (record.refund_status === 'REFUNDED') {
      return { success: true, amountRefunded: Number(record.refund_amount_usd || 0) };
    }

    const refundAmount = Number(record.customer_monthly_cost_usd || 3.00);

    // Call Creem refund API if transaction ID is available (full refund)
    if (params.transactionId) {
      const creem = CreemBillingService.getCreemSdk();
      if (creem) {
        try {
          await creem.transactions.refund({ transactionId: params.transactionId });
        } catch (err: any) {
          if (!err.message?.includes('already refunded')) {
            console.error(`[PhoneNumberBilling] Creem refund error: ${err.message}`);
            throw err;
          }
        }
      }
    }

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

  /**
   * Handle incoming verified Paddle webhook events for phone number rental (legacy support).
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

    console.log(`[PhoneNumberBilling Legacy] Handling Paddle event ${event_type}`, { organizationId, checkoutId, phoneNumber });

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
             SET status = 'PAID',
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
        break;
      }
    }

    return { success: true, message: `Handled Paddle phone number event ${event_type}` };
  }
}
