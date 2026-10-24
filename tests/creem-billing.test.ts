import crypto from 'crypto';
import { CreemBillingService } from '../server/src/services/CreemBillingService';
import { PaddleBillingService } from '../server/src/services/PaddleBillingService';
import { getDatabase } from '../server/src/db';
import { config } from '../server/src/config';
import { SubscriptionStatus, PaidPlanTier } from '@onceclic/shared';
import { toCustomerBillingStatus, toCustomerBillingConfig } from '../server/src/serializers/customerSerializers';
import { v4 as uuidv4 } from 'uuid';

export async function runCreemBillingTests() {
  console.log('--- Running Creem Billing & Webhook Audit Test Suite ---');
  const db = getDatabase();
  await db.runMigrations();

  const originalCreemConfig = JSON.parse(JSON.stringify(config.creem));
  const testSecret = 'whsec_test_secret_for_creem_verification_98765';

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Plan Tier Resolution & Safety Guards
    // -------------------------------------------------------------------------
    console.log('  Testing Plan Tier Resolution & Product Mapping...');
    config.creem.plans = {
      STARTER: { id: 'STARTER', name: 'Starter', priceUsd: 19, productId: 'prod_creem_starter_test', voiceMinutes: 50 },
      PRO: { id: 'PRO', name: 'ONCEClic Pro', priceUsd: 49, productId: 'prod_creem_pro_test', voiceMinutes: 150 },
      BUSINESS: { id: 'BUSINESS', name: 'Business', priceUsd: 99, productId: 'prod_creem_biz_test', voiceMinutes: 400 },
    };
    config.creem.environment = 'test';

    if (CreemBillingService.resolvePlanTierFromProductId('prod_creem_starter_test') !== 'STARTER') {
      throw new Error('resolvePlanTierFromProductId failed for STARTER');
    }
    if (CreemBillingService.resolvePlanTierFromProductId('prod_creem_pro_test') !== 'PRO') {
      throw new Error('resolvePlanTierFromProductId failed for PRO');
    }
    if (CreemBillingService.resolvePlanTierFromProductId('prod_creem_biz_test') !== 'BUSINESS') {
      throw new Error('resolvePlanTierFromProductId failed for BUSINESS');
    }
    if (CreemBillingService.resolvePlanTierFromProductId('unknown_product_id') !== null) {
      throw new Error('resolvePlanTierFromProductId should return null for unknown product');
    }
    if (CreemBillingService.resolvePlanTierFromProductId('') !== null || CreemBillingService.resolvePlanTierFromProductId(null) !== null) {
      throw new Error('resolvePlanTierFromProductId should return null for empty/null product');
    }
    if (CreemBillingService.resolvePlanTierFromProductId('prod_placeholder_starter') !== null) {
      throw new Error('resolvePlanTierFromProductId should return null for placeholder');
    }

    // Safety guard: test product in production environment
    config.creem.environment = 'prod';
    if (CreemBillingService.resolvePlanTierFromProductId('prod_creem_starter_test') !== null) {
      throw new Error('resolvePlanTierFromProductId MUST return null for test/sandbox product ID when environment=prod');
    }
    config.creem.environment = 'test';
    console.log('  ✓ 1. Plan Tier Resolution and production sandbox guard verified.');

    // -------------------------------------------------------------------------
    // TEST 2: Plan Product Mapping Validation & Collision Detection
    // -------------------------------------------------------------------------
    console.log('  Testing Plan Product Mapping Validation...');
    const validStarter = CreemBillingService.validatePlanProductMapping('STARTER');
    if (!validStarter.valid || validStarter.productId !== 'prod_creem_starter_test') {
      throw new Error('validatePlanProductMapping failed for valid STARTER');
    }

    // Collision detection test: If PRO has the same product ID as STARTER
    config.creem.plans.PRO.productId = 'prod_creem_starter_test';
    const collisionCheck = CreemBillingService.validatePlanProductMapping('STARTER');
    if (collisionCheck.valid || !collisionCheck.error?.includes('collision')) {
      throw new Error('validatePlanProductMapping MUST reject product ID collision between tiers');
    }
    config.creem.plans.PRO.productId = 'prod_creem_pro_test';

    // Missing product ID
    config.creem.plans.BUSINESS.productId = '';
    const missingCheck = CreemBillingService.validatePlanProductMapping('BUSINESS');
    if (missingCheck.valid || !missingCheck.error?.includes('Missing')) {
      throw new Error('validatePlanProductMapping MUST reject missing product ID');
    }
    config.creem.plans.BUSINESS.productId = 'prod_creem_biz_test';
    console.log('  ✓ 2. Collision detection and missing-config guards verified.');

    // -------------------------------------------------------------------------
    // TEST 3: Webhook Signature Verification (Valid, Invalid, Formats, Cross-Contamination)
    // -------------------------------------------------------------------------
    console.log('  Testing Creem Webhook Signature Verification...');
    config.creem.webhookSecret = testSecret;
    const testPayload = JSON.stringify({
      id: 'evt_test_sig_' + Date.now(),
      eventType: 'checkout.completed',
      created_at: Math.floor(Date.now() / 1000),
      object: { id: 'chk_123' },
    });

    const expectedHexHmac = crypto
      .createHmac('sha256', testSecret)
      .update(testPayload)
      .digest('hex');

    // 3a. Valid raw hex HMAC in creem-signature
    const validHexResult = await CreemBillingService.verifyWebhookSignature(testPayload, expectedHexHmac);
    if (!validHexResult) {
      throw new Error('verifyWebhookSignature should accept valid raw hex HMAC');
    }

    // 3b. Valid signature with sha256= prefix
    const validPrefixedResult = await CreemBillingService.verifyWebhookSignature(testPayload, `sha256=${expectedHexHmac}`);
    if (!validPrefixedResult) {
      throw new Error('verifyWebhookSignature should accept valid sha256= prefixed HMAC');
    }

    // 3c. Valid signature passed via headers object
    const validHeadersResult = await CreemBillingService.verifyWebhookSignature(testPayload, {
      'creem-signature': expectedHexHmac,
    });
    if (!validHeadersResult) {
      throw new Error('verifyWebhookSignature should accept headers object with creem-signature');
    }

    // 3d. Valid signature passed via x-creem-signature header
    const validXHeadersResult = await CreemBillingService.verifyWebhookSignature(testPayload, {
      'x-creem-signature': expectedHexHmac,
    });
    if (!validXHeadersResult) {
      throw new Error('verifyWebhookSignature should accept headers object with x-creem-signature');
    }

    // 3e. Invalid signature rejection
    const invalidResult = await CreemBillingService.verifyWebhookSignature(testPayload, 'tampered_invalid_hex_signature');
    if (invalidResult) {
      throw new Error('verifyWebhookSignature MUST reject invalid signature');
    }

    // 3f. Tampered body rejection
    const tamperedResult = await CreemBillingService.verifyWebhookSignature(testPayload + 'tampered', expectedHexHmac);
    if (tamperedResult) {
      throw new Error('verifyWebhookSignature MUST reject tampered payload');
    }

    // 3g. Missing signature
    const missingSigResult = await CreemBillingService.verifyWebhookSignature(testPayload, '');
    if (missingSigResult) {
      throw new Error('verifyWebhookSignature MUST reject empty signature');
    }

    // 3h. Cross-contamination guard: Paddle signature against Creem verifier
    const paddleSigHeader = `ts=${Math.floor(Date.now() / 1000)};h1=${expectedHexHmac}`;
    const crossContamCreem = await CreemBillingService.verifyWebhookSignature(testPayload, paddleSigHeader);
    if (crossContamCreem) {
      throw new Error('Creem verifier MUST NOT accept a Paddle signature format');
    }

    // 3i. Cross-contamination guard: Creem signature against Paddle verifier
    const crossContamPaddle = PaddleBillingService.verifyWebhookSignature(testPayload, expectedHexHmac);
    if (crossContamPaddle) {
      throw new Error('Paddle verifier MUST NOT accept a raw Creem signature');
    }

    // 3j. Synchronous verifier check
    const syncResult = CreemBillingService.verifyWebhookSignatureSync(testPayload, expectedHexHmac);
    if (!syncResult) {
      throw new Error('verifyWebhookSignatureSync failed for valid signature');
    }
    console.log('  ✓ 3. Webhook signatures (SDK, legacy, prefixes, tamper, cross-contamination) verified.');

    // -------------------------------------------------------------------------
    // TEST 4: Subscription Lifecycle via Webhooks (checkout.completed -> active -> cancel -> canceled)
    // -------------------------------------------------------------------------
    console.log('  Testing Full Creem Subscription Lifecycle Webhooks...');
    const testOrgId = uuidv4();
    const testUserId = uuidv4();

    await db.execute(
      `INSERT INTO organizations (id, name, slug, is_active, created_at, updated_at)
       VALUES ($1, 'Creem Test Org', $2, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [testOrgId, `creem-test-org-${Date.now()}`]
    );

    await db.execute(
      `INSERT INTO subscriptions (
         id, organization_id, status, plan_tier, trial_started_at, trial_ends_at, cancel_at_period_end, created_at, updated_at
       ) VALUES ($1, $2, 'TRIAL', 'TRIAL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '7 days', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [uuidv4(), testOrgId]
    );

    const testCreemSubId = `sub_creem_${Date.now()}`;
    const testCreemCustId = `cust_creem_${Date.now()}`;
    const testCreemCheckoutId = `chk_creem_${Date.now()}`;

    // 4a. checkout.completed activates Pro subscription
    const checkoutEvtId = `evt_chk_${Date.now()}`;
    const checkoutResult = await CreemBillingService.handleWebhookEvent({
      id: checkoutEvtId,
      eventType: 'checkout.completed',
      created_at: Math.floor(Date.now() / 1000),
      object: {
        id: testCreemCheckoutId,
        object: 'checkout',
        product: { id: 'prod_creem_pro_test' },
        subscription: { id: testCreemSubId },
        customer: { id: testCreemCustId, email: 'customer@creemtest.com' },
        metadata: {
          organization_id: testOrgId,
          user_id: testUserId,
          plan_tier: 'PRO',
        },
      },
    });

    if (!checkoutResult.success) {
      throw new Error(`checkout.completed failed: ${checkoutResult.message}`);
    }

    const subAfterCheckout = await CreemBillingService.getSubscription(testOrgId);
    if (subAfterCheckout.subscription?.status !== SubscriptionStatus.ACTIVE) {
      throw new Error(`Expected status ACTIVE after checkout.completed, got: ${subAfterCheckout.subscription?.status}`);
    }
    if (subAfterCheckout.planTier !== 'PRO') {
      throw new Error(`Expected planTier PRO after checkout.completed, got: ${subAfterCheckout.planTier}`);
    }
    if (subAfterCheckout.subscription?.creemSubscriptionId !== testCreemSubId) {
      throw new Error(`Expected creemSubscriptionId ${testCreemSubId}, got: ${subAfterCheckout.subscription?.creemSubscriptionId}`);
    }
    if (subAfterCheckout.subscription?.creemCustomerId !== testCreemCustId) {
      throw new Error(`Expected creemCustomerId ${testCreemCustId}, got: ${subAfterCheckout.subscription?.creemCustomerId}`);
    }

    // 4b. subscription.active event updates billing period
    const activeEvtId = `evt_act_${Date.now()}`;
    const periodStart = new Date().toISOString();
    const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString();
    await CreemBillingService.handleWebhookEvent({
      id: activeEvtId,
      eventType: 'subscription.active',
      created_at: Math.floor(Date.now() / 1000),
      object: {
        id: testCreemSubId,
        object: 'subscription',
        product: { id: 'prod_creem_pro_test' },
        customer: { id: testCreemCustId },
        current_period_start_date: periodStart,
        current_period_end_date: periodEnd,
        metadata: { organization_id: testOrgId },
      },
    });

    const subAfterActive = await CreemBillingService.getSubscription(testOrgId);
    if (!subAfterActive.subscription?.currentPeriodStart) {
      throw new Error('Expected currentPeriodStart to be set by subscription.active event');
    }

    // 4c. subscription.scheduled_cancel sets cancelAtPeriodEnd = true
    const schedCancelEvtId = `evt_scancel_${Date.now()}`;
    await CreemBillingService.handleWebhookEvent({
      id: schedCancelEvtId,
      eventType: 'subscription.scheduled_cancel',
      created_at: Math.floor(Date.now() / 1000),
      object: {
        id: testCreemSubId,
        metadata: { organization_id: testOrgId },
      },
    });

    const subAfterSchedCancel = await CreemBillingService.getSubscription(testOrgId);
    if (!subAfterSchedCancel.subscription?.cancelAtPeriodEnd) {
      throw new Error('Expected cancelAtPeriodEnd to be true after subscription.scheduled_cancel');
    }
    if (subAfterSchedCancel.subscription?.status !== SubscriptionStatus.ACTIVE) {
      throw new Error('Subscription should remain ACTIVE during scheduled cancel period');
    }

    // 4d. subscription.canceled revokes paid access
    const cancelEvtId = `evt_cancel_${Date.now()}`;
    await CreemBillingService.handleWebhookEvent({
      id: cancelEvtId,
      eventType: 'subscription.canceled',
      created_at: Math.floor(Date.now() / 1000),
      object: {
        id: testCreemSubId,
        metadata: { organization_id: testOrgId },
      },
    });

    const subAfterCancel = await CreemBillingService.getSubscription(testOrgId);
    if (subAfterCancel.subscription?.status !== SubscriptionStatus.CANCELED) {
      throw new Error(`Expected status CANCELED, got: ${subAfterCancel.subscription?.status}`);
    }
    if (subAfterCancel.isPro !== false) {
      throw new Error('Expected isPro to be false after subscription.canceled');
    }
    console.log('  ✓ 4. Full subscription lifecycle (checkout -> active -> scheduled_cancel -> canceled) verified.');

    // -------------------------------------------------------------------------
    // TEST 5: Idempotency & Duplicate Webhook Rejection
    // -------------------------------------------------------------------------
    console.log('  Testing Webhook Idempotency & Duplicate Deliveries...');
    const duplicateDelivery = await CreemBillingService.handleWebhookEvent({
      id: checkoutEvtId, // already processed above!
      eventType: 'checkout.completed',
      created_at: Math.floor(Date.now() / 1000),
      object: {
        id: testCreemCheckoutId,
        metadata: { organization_id: testOrgId },
      },
    });

    if (!duplicateDelivery.message.includes('idempotent')) {
      throw new Error(`Expected duplicate webhook delivery to be skipped idempotently, got: ${duplicateDelivery.message}`);
    }

    // Verify processed_webhook_events only has 1 record for this event ID
    const countRes = await db.getOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM processed_webhook_events WHERE event_id = $1`,
      [checkoutEvtId]
    );
    if (parseInt(countRes?.count || '0', 10) !== 1) {
      throw new Error('processed_webhook_events must contain exactly 1 entry for duplicate eventId');
    }
    console.log('  ✓ 5. Webhook idempotency and deduplication verified.');

    // -------------------------------------------------------------------------
    // TEST 6: Out-of-Order Delivery Protection
    // -------------------------------------------------------------------------
    console.log('  Testing Out-of-Order Webhook Protection...');
    // Subscription for testOrgId is currently CANCELED.
    // Send an out-of-order 'subscription.active' event whose created_at timestamp is older than cancellation.
    const staleEvtId = `evt_stale_active_${Date.now()}`;
    const oldTimestamp = Math.floor(Date.now() / 1000) - 86400; // 1 day ago

    const outOfOrderResult = await CreemBillingService.handleWebhookEvent({
      id: staleEvtId,
      eventType: 'subscription.active',
      created_at: oldTimestamp,
      object: {
        id: testCreemSubId,
        product: { id: 'prod_creem_pro_test' },
        customer: { id: testCreemCustId },
        metadata: { organization_id: testOrgId },
      },
    });

    if (!outOfOrderResult.message.includes('out-of-order') && !outOfOrderResult.message.includes('canceled')) {
      throw new Error(`Expected out-of-order active event to be ignored, got: ${outOfOrderResult.message}`);
    }

    const subCheckAfterStale = await CreemBillingService.getSubscription(testOrgId);
    if (subCheckAfterStale.subscription?.status !== SubscriptionStatus.CANCELED) {
      throw new Error('Out-of-order active event MUST NOT resurrect a canceled subscription!');
    }
    console.log('  ✓ 6. Out-of-order event protection verified.');

    // -------------------------------------------------------------------------
    // TEST 7: Tenant Isolation & Graceful Unknown Org Handling
    // -------------------------------------------------------------------------
    console.log('  Testing Tenant Isolation in Webhook Processing...');
    const foreignOrgId = uuidv4();
    await db.execute(
      `INSERT INTO organizations (id, name, slug, is_active, created_at, updated_at)
       VALUES ($1, 'Foreign Org', $2, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [foreignOrgId, `foreign-org-${Date.now()}`]
    );
    const futureDate = new Date(Date.now() + 7 * 86400000).toISOString();
    await db.execute(
      `INSERT INTO subscriptions (id, organization_id, status, plan_tier, trial_started_at, trial_ends_at, cancel_at_period_end)
       VALUES ($1, $2, $3, 'TRIAL', CURRENT_TIMESTAMP, $4, FALSE)`,
      [uuidv4(), foreignOrgId, SubscriptionStatus.TRIALING, futureDate]
    );

    // Event targeting testOrgId must NOT alter foreignOrgId
    const targetEvtId = `evt_iso_${Date.now()}`;
    await CreemBillingService.handleWebhookEvent({
      id: targetEvtId,
      eventType: 'subscription.past_due',
      created_at: Math.floor(Date.now() / 1000),
      object: {
        id: testCreemSubId,
        metadata: { organization_id: testOrgId },
      },
    });

    const foreignSub = await CreemBillingService.getSubscription(foreignOrgId);
    if (foreignSub.subscription?.status !== SubscriptionStatus.TRIALING) {
      throw new Error('Foreign organization subscription was altered! Tenant isolation failure.');
    }
    console.log('  ✓ 7. Tenant isolation verified.');

    // -------------------------------------------------------------------------
    // TEST 8: Customer Serializer Safety & Creem Fields
    // -------------------------------------------------------------------------
    console.log('  Testing Customer Serializers with Creem Fields...');
    const rawSubRecord = {
      id: 'sub_123',
      organizationId: testOrgId,
      status: SubscriptionStatus.ACTIVE,
      planTier: 'PRO',
      creemProductId: 'prod_creem_pro_test',
      creemCustomerId: testCreemCustId,
      creemSubscriptionId: testCreemSubId,
      priceId: null,
      trialStartedAt: null,
      trialEndsAt: null,
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
      cancelAtPeriodEnd: false,
    };

    const customerStatus = toCustomerBillingStatus({
      subscription: rawSubRecord,
      isPro: true,
      planTier: 'PRO',
      daysRemainingInTrial: 0,
      billingConfigured: true,
    });

    if (customerStatus.subscription?.creemCustomerId !== testCreemCustId) {
      throw new Error('Customer serializer omitted creemCustomerId');
    }
    if (customerStatus.subscription?.creemSubscriptionId !== testCreemSubId) {
      throw new Error('Customer serializer omitted creemSubscriptionId');
    }
    if ((customerStatus as any).apiKey || (customerStatus as any).webhookSecret || (customerStatus as any).budgetUsd) {
      throw new Error('Customer serializer leaked confidential internal fields!');
    }

    const clientConfig = toCustomerBillingConfig(config);
    if (clientConfig.provider !== 'creem') {
      throw new Error(`Expected billing config provider to be 'creem', got: ${clientConfig.provider}`);
    }
    if (clientConfig.plans?.STARTER?.priceUsd !== 19 || clientConfig.plans?.PRO?.priceUsd !== 49 || clientConfig.plans?.BUSINESS?.priceUsd !== 99) {
      throw new Error('Client billing config prices must remain $19, $49, $99');
    }
    console.log('  ✓ 8. Customer serializers and price stability ($19, $49, $99) verified.');

    // -------------------------------------------------------------------------
    // TEST 9: Backward Compatibility — Legacy Paddle Subscriber Handling
    // -------------------------------------------------------------------------
    console.log('  Testing Legacy Paddle Subscriber Coexistence...');
    const legacyOrgId = uuidv4();
    const legacyPaddleSubId = `sub_paddle_legacy_${Date.now()}`;
    const legacyPaddleCustId = `ctm_paddle_legacy_${Date.now()}`;

    await db.execute(
      `INSERT INTO organizations (id, name, slug, is_active, created_at, updated_at)
       VALUES ($1, 'Legacy Paddle Org', $2, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [legacyOrgId, `legacy-paddle-org-${Date.now()}`]
    );

    await db.execute(
      `INSERT INTO subscriptions (
         id, organization_id, status, plan_tier, paddle_customer_id, paddle_subscription_id, trial_started_at, trial_ends_at, cancel_at_period_end
       ) VALUES ($1, $2, 'ACTIVE', 'PRO', $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 days', FALSE)`,
      [uuidv4(), legacyOrgId, legacyPaddleCustId, legacyPaddleSubId]
    );

    const legacySub = await CreemBillingService.getSubscription(legacyOrgId);
    if (!legacySub.isPro) {
      throw new Error('Legacy Paddle subscriber should maintain isPro = true');
    }
    if (legacySub.planTier !== 'PRO') {
      throw new Error(`Legacy Paddle subscriber expected planTier PRO, got: ${legacySub.planTier}`);
    }
    if (legacySub.subscription?.paddleSubscriptionId !== legacyPaddleSubId) {
      throw new Error('Legacy Paddle subscriber paddleSubscriptionId was lost');
    }
    console.log('  ✓ 9. Legacy Paddle subscriber backward compatibility verified.');

    console.log('\n--- All 9 Creem Billing & Webhook Audit Tests Passed! ---\n');
  } finally {
    // Restore original config
    config.creem = originalCreemConfig;
  }
}
