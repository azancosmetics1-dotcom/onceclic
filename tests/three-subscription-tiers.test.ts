import crypto from 'crypto';
import { PaddleBillingService } from '../server/src/services/PaddleBillingService';
import { AuthService } from '../server/src/services/AuthService';
import { VoiceService } from '../server/src/services/voice/VoiceService';
import { config } from '../server/src/config';
import {
  SubscriptionStatus,
  SUBSCRIPTION_PLANS,
  PaidPlanTier,
  PlanTier,
} from '@onceclic/shared';
import { db } from '../server/src/db';
import { toCustomerBillingStatus, toCustomerBillingConfig } from '../server/src/serializers/customerSerializers';

export async function runThreeSubscriptionTiersTests() {
  console.log('--- Running Three Real Subscription Tiers (Starter, Pro, Business) Tests ---');

  // =========================================================================
  // Case 23: Starter resolves to $19/month
  // =========================================================================
  if (SUBSCRIPTION_PLANS.STARTER.priceUsd !== 19) {
    throw new Error(`Expected STARTER price to be 19, got ${SUBSCRIPTION_PLANS.STARTER.priceUsd}`);
  }
  console.log('  ✓ 23. Starter resolves to $19/month');

  // =========================================================================
  // Case 24: Pro resolves to $49/month
  // =========================================================================
  if (SUBSCRIPTION_PLANS.PRO.priceUsd !== 49) {
    throw new Error(`Expected PRO price to be 49, got ${SUBSCRIPTION_PLANS.PRO.priceUsd}`);
  }
  console.log('  ✓ 24. Pro resolves to $49/month');

  // =========================================================================
  // Case 25: Business resolves to $99/month
  // =========================================================================
  if (SUBSCRIPTION_PLANS.BUSINESS.priceUsd !== 99) {
    throw new Error(`Expected BUSINESS price to be 99, got ${SUBSCRIPTION_PLANS.BUSINESS.priceUsd}`);
  }
  console.log('  ✓ 25. Business resolves to $99/month');

  // =========================================================================
  // Case 26: Each plan uses its correct configured Paddle price ID
  // =========================================================================
  // Set explicit test price IDs in config for verification
  config.paddle.plans.STARTER.priceId = 'pri_test_starter_price_id';
  config.paddle.plans.PRO.priceId = 'pri_test_pro_price_id';
  config.paddle.plans.BUSINESS.priceId = 'pri_test_business_price_id';

  const serializedConfig = toCustomerBillingConfig(config);

  if (serializedConfig.plans.STARTER.priceId !== 'pri_test_starter_price_id') {
    throw new Error('STARTER price ID mismatch in customer config');
  }
  if (serializedConfig.plans.PRO.priceId !== 'pri_test_pro_price_id') {
    throw new Error('PRO price ID mismatch in customer config');
  }
  if (serializedConfig.plans.BUSINESS.priceId !== 'pri_test_business_price_id') {
    throw new Error('BUSINESS price ID mismatch in customer config');
  }

  // Verify plan price mapping validation logic
  const starterValidation = PaddleBillingService.validatePlanPriceMapping('STARTER');
  const proValidation = PaddleBillingService.validatePlanPriceMapping('PRO');
  const businessValidation = PaddleBillingService.validatePlanPriceMapping('BUSINESS');

  if (!starterValidation.valid || starterValidation.priceId !== 'pri_test_starter_price_id' || starterValidation.priceUsd !== 19) {
    throw new Error('STARTER plan price mapping validation failed');
  }
  if (!proValidation.valid || proValidation.priceId !== 'pri_test_pro_price_id' || proValidation.priceUsd !== 49) {
    throw new Error('PRO plan price mapping validation failed');
  }
  if (!businessValidation.valid || businessValidation.priceId !== 'pri_test_business_price_id' || businessValidation.priceUsd !== 99) {
    throw new Error('BUSINESS plan price mapping validation failed');
  }

  // Ensure collision is detected and rejected
  const savedProPriceId = config.paddle.plans.PRO.priceId;
  config.paddle.plans.PRO.priceId = 'pri_test_starter_price_id'; // Force collision
  const collisionCheck = PaddleBillingService.validatePlanPriceMapping('PRO');
  if (collisionCheck.valid) {
    throw new Error('Expected price ID collision between PRO and STARTER to be caught');
  }
  config.paddle.plans.PRO.priceId = savedProPriceId; // Restore

  console.log('  ✓ 26. Each plan uses its correct configured Paddle price ID');

  // =========================================================================
  // Case 27: Missing price IDs produce safe configuration errors
  // =========================================================================
  const originalStarterPriceId = config.paddle.plans.STARTER.priceId;
  config.paddle.plans.STARTER.priceId = '';
  const resolvedMissing = PaddleBillingService.resolvePlanTierFromPriceId('');
  if (resolvedMissing !== null) {
    throw new Error(`Expected missing price ID to resolve to null, got ${resolvedMissing}`);
  }
  const missingValidation = PaddleBillingService.validatePlanPriceMapping('STARTER');
  if (missingValidation.valid || !missingValidation.error?.includes('Missing configured Paddle price ID')) {
    throw new Error('Expected missing price ID to produce safe configuration validation error');
  }
  // Restore
  config.paddle.plans.STARTER.priceId = originalStarterPriceId;
  console.log('  ✓ 27. Missing price IDs produce safe configuration errors');

  // Create test user and organization
  const auth = await AuthService.register({
    email: `sub-tier-test-${Date.now()}@example.test`,
    password: 'password123',
    fullName: 'Tier Test User',
    businessName: 'org_tier_test_001',
  });
  const orgId = auth.organization!.id;
  await AuthService.completeOnboarding({
    userId: auth.user.id,
    organizationId: orgId,
    industry: 'Healthcare',
    businessKnowledge: 'Tier test medical center is open 24/7.',
  });

  // =========================================================================
  // Case 28: Failed/canceled checkout does not activate a subscription
  // =========================================================================
  const authUnknown = await AuthService.register({
    email: `sub-unknown-price-${Date.now()}@example.test`,
    password: 'password123',
    fullName: 'Unknown Price User',
    businessName: 'org_unknown_price_001',
  });
  const orgUnknownId = authUnknown.organization!.id;
  await AuthService.completeOnboarding({
    userId: authUnknown.user.id,
    organizationId: orgUnknownId,
    industry: 'Dental',
    businessKnowledge: 'Dental clinic is open Monday through Friday 9 AM to 5 PM.',
  });

  // Expire trial first so trial access does not mask paid entitlement evaluation
  await db.execute(
    `UPDATE subscriptions SET status = 'EXPIRED', trial_ends_at = $1 WHERE organization_id = $2`,
    [new Date(Date.now() - 86400000).toISOString(), orgUnknownId]
  );

  const failedEventId = `evt_sub_failed_${Date.now()}`;
  await PaddleBillingService.handleWebhookEvent({
    event_id: failedEventId,
    event_type: 'subscription.past_due',
    occurred_at: new Date().toISOString(),
    data: {
      id: `sub_failed_${Date.now()}`,
      customer_id: 'ctm_failed',
      status: 'past_due',
      custom_data: { organization_id: orgUnknownId },
      items: [{ price: { id: config.paddle.plans.STARTER.priceId } }],
    },
  });

  const pastDueSub = await PaddleBillingService.getSubscription(orgUnknownId);
  if (pastDueSub.subscription?.status === SubscriptionStatus.ACTIVE) {
    throw new Error('Past due event must NOT activate subscription!');
  }

  const cancelEventId = `evt_sub_canceled_${Date.now()}`;
  await PaddleBillingService.handleWebhookEvent({
    event_id: cancelEventId,
    event_type: 'subscription.canceled',
    occurred_at: new Date().toISOString(),
    data: {
      id: `sub_canceled_${Date.now()}`,
      customer_id: 'ctm_canceled',
      status: 'canceled',
      custom_data: { organization_id: orgUnknownId },
      items: [{ price: { id: config.paddle.plans.STARTER.priceId } }],
    },
  });

  const canceledSub = await PaddleBillingService.getSubscription(orgUnknownId);
  if (canceledSub.subscription?.status === SubscriptionStatus.ACTIVE) {
    throw new Error('Canceled event must NOT activate subscription!');
  }
  console.log('  ✓ 28. Failed/canceled checkout does not activate a subscription');

  // =========================================================================
  // Case 29: Verified successful payment activates the correct plan
  // =========================================================================
  const testTiers: PaidPlanTier[] = ['STARTER', 'PRO', 'BUSINESS'];
  for (const tier of testTiers) {
    const priceId = config.paddle.plans[tier].priceId;
    const subEventId = `evt_activate_${tier.toLowerCase()}_${Date.now()}`;
    await PaddleBillingService.handleWebhookEvent({
      event_id: subEventId,
      event_type: 'subscription.activated',
      occurred_at: new Date().toISOString(),
      data: {
        id: `sub_${tier.toLowerCase()}_${Date.now()}`,
        customer_id: `ctm_${tier.toLowerCase()}`,
        status: 'active',
        custom_data: { organization_id: orgId },
        items: [{ price: { id: priceId } }],
        current_billing_period: {
          starts_at: new Date().toISOString(),
          ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        },
      },
    });

    const subResult = await PaddleBillingService.getSubscription(orgId);
    if (subResult.subscription?.status !== SubscriptionStatus.ACTIVE) {
      throw new Error(`Expected status ACTIVE for tier ${tier}, got ${subResult.subscription?.status}`);
    }
    if (subResult.subscription?.planTier !== tier) {
      throw new Error(`Expected planTier ${tier}, got ${subResult.subscription?.planTier}`);
    }
  }
  console.log('  ✓ 29. Verified successful payment activates the correct plan');

  // =========================================================================
  // Case 30: Webhook signature verification and idempotency remain intact
  // =========================================================================
  const rawBody = JSON.stringify({
    event_id: 'evt_sig_test_123',
    event_type: 'subscription.activated',
    occurred_at: new Date().toISOString(),
    data: { id: 'sub_test_sig' },
  });
  const validSecret = config.paddle.webhookSecret || 'pdl_ntfset_01jh123456789abcdef';
  const ts = Math.floor(Date.now() / 1000).toString();
  const hmacPayload = `${ts}:${rawBody}`;
  const validHmac = crypto.createHmac('sha256', validSecret).update(hmacPayload).digest('hex');
  const validHeader = `ts=${ts};h1=${validHmac}`;

  const isSigValid = PaddleBillingService.verifyWebhookSignature(rawBody, validHeader);
  if (!isSigValid) {
    throw new Error('Webhook signature validation failed with valid secret');
  }

  const isInvalidSig = PaddleBillingService.verifyWebhookSignature(rawBody, `ts=${ts};h1=invalid_signature`);
  if (isInvalidSig) {
    throw new Error('Webhook signature must fail with invalid signature');
  }

  // Idempotency check: sending duplicate event_id
  const duplicateEvent = {
    event_id: `evt_idempotent_${Date.now()}`,
    event_type: 'subscription.updated',
    occurred_at: new Date().toISOString(),
    data: { id: 'sub_idempotent' },
  };
  const firstRes = await PaddleBillingService.handleWebhookEvent(duplicateEvent);
  const secondRes = await PaddleBillingService.handleWebhookEvent(duplicateEvent);
  if (!firstRes.success || !secondRes.success || !secondRes.message.includes('already processed')) {
    throw new Error('Webhook idempotency failed on duplicate event_id');
  }
  console.log('  ✓ 30. Webhook signature verification and idempotency remain intact');

  // =========================================================================
  // Case 31: Existing subscriptions are not silently modified
  // =========================================================================
  // Org A is currently on BUSINESS tier
  const beforeSubA = await PaddleBillingService.getSubscription(orgId);
  if (beforeSubA.subscription?.planTier !== 'BUSINESS') {
    throw new Error(`Expected Org A to be on BUSINESS tier, got ${beforeSubA.subscription?.planTier}`);
  }

  // Create Org B with a Starter subscription
  const authB = await AuthService.register({
    email: `tenant-existing-mod-${Date.now()}@example.test`,
    password: 'password123',
    fullName: 'Tenant Existing Mod',
    businessName: 'org_tenant_mod_001',
  });
  const orgBId = authB.organization!.id;

  const eventOrgB = `evt_activate_starter_b_${Date.now()}`;
  await PaddleBillingService.handleWebhookEvent({
    event_id: eventOrgB,
    event_type: 'subscription.activated',
    occurred_at: new Date().toISOString(),
    data: {
      id: `sub_starter_b_${Date.now()}`,
      customer_id: 'ctm_starter_b',
      status: 'active',
      custom_data: { organization_id: orgBId },
      items: [{ price: { id: config.paddle.plans.STARTER.priceId } }],
      current_billing_period: {
        starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      },
    },
  });

  // Verify Org A's subscription was NOT modified by Org B's event
  const afterSubA = await PaddleBillingService.getSubscription(orgId);
  if (afterSubA.subscription?.planTier !== 'BUSINESS' || afterSubA.subscription?.id !== beforeSubA.subscription?.id) {
    throw new Error('Existing subscription for Org A was modified or repriced!');
  }

  // Also verify duplicate checkout for Org A updates the existing subscription without creating duplicates
  const countBefore = await db.query(
    'SELECT COUNT(*) as count FROM subscriptions WHERE organization_id = $1',
    [orgId]
  );
  await PaddleBillingService.handleWebhookEvent({
    event_id: `evt_retry_checkout_${Date.now()}`,
    event_type: 'subscription.activated',
    occurred_at: new Date().toISOString(),
    data: {
      id: `sub_retry_${Date.now()}`,
      customer_id: 'ctm_retry',
      status: 'active',
      custom_data: { organization_id: orgId },
      items: [{ price: { id: config.paddle.plans.BUSINESS.priceId } }],
      current_billing_period: {
        starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      },
    },
  });
  const countAfter = await db.query(
    'SELECT COUNT(*) as count FROM subscriptions WHERE organization_id = $1',
    [orgId]
  );
  if (Number(countAfter.rows[0].count) !== Number(countBefore.rows[0].count)) {
    throw new Error('Duplicate subscription was created on checkout retry');
  }
  console.log('  ✓ 31. Existing subscriptions are not silently modified and no duplicate subscriptions created on retry');

  // =========================================================================
  // Case 32: Internal AI budget amounts do not leak into customer-facing UI or APIs
  // =========================================================================
  const rawStatus = {
    subscription: afterSubA.subscription,
    planTier: 'BUSINESS' as PlanTier,
    isTrial: false,
    isTrialActive: false,
    daysRemainingInTrial: 0,
    aiUsageStatus: 'AVAILABLE' as const,
    // Internal dollar values that should be stripped
    budgetUsd: 10,
    costUsd: 1.25,
    internalAllowance: 500,
    trialAiBudgetUsd: 0.5,
    proAiBudgetUsd: 10.0,
  };
  const customerView: any = toCustomerBillingStatus(rawStatus);
  if (
    'budgetUsd' in customerView ||
    'costUsd' in customerView ||
    'internalAllowance' in customerView ||
    'trialAiBudgetUsd' in customerView ||
    'proAiBudgetUsd' in customerView
  ) {
    throw new Error('Customer serializer exposed internal budget/cost fields!');
  }

  const customerConfigSerialized = toCustomerBillingConfig(config);
  const configString = JSON.stringify(customerConfigSerialized);
  if (configString.includes('0.50') || configString.includes('10.00')) {
    throw new Error('Customer billing config leaked internal AI dollar budgets');
  }
  console.log('  ✓ 32. Internal AI budget amounts do not leak into customer-facing UI or APIs');

  console.log('--- All Three Subscription Tiers Tests Passed Successfully ---\n');
}
