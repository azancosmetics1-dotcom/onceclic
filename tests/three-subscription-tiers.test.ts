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

  // 1. All three plans appear with correct prices
  if (SUBSCRIPTION_PLANS.STARTER.priceUsd !== 19) {
    throw new Error(`Expected STARTER price to be 19, got ${SUBSCRIPTION_PLANS.STARTER.priceUsd}`);
  }
  if (SUBSCRIPTION_PLANS.PRO.priceUsd !== 49) {
    throw new Error(`Expected PRO price to be 49, got ${SUBSCRIPTION_PLANS.PRO.priceUsd}`);
  }
  if (SUBSCRIPTION_PLANS.BUSINESS.priceUsd !== 99) {
    throw new Error(`Expected BUSINESS price to be 99, got ${SUBSCRIPTION_PLANS.BUSINESS.priceUsd}`);
  }
  console.log('  ✓ 1. All three plans configured with correct prices ($19, $49, $99)');

  // 2. Each plan selection reaches the correct checkout configuration
  // Set test price IDs in config for verification
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
  console.log('  ✓ 2. Each plan reaches correct checkout configuration');

  // 3. Missing price IDs fail safely
  const originalStarterPriceId = config.paddle.plans.STARTER.priceId;
  config.paddle.plans.STARTER.priceId = '';
  const resolvedMissing = PaddleBillingService.resolvePlanTierFromPriceId('');
  if (resolvedMissing !== null) {
    throw new Error(`Expected missing price ID to resolve to null, got ${resolvedMissing}`);
  }
  // Restore
  config.paddle.plans.STARTER.priceId = originalStarterPriceId;
  console.log('  ✓ 3. Missing price IDs fail safely without fallback');

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

  // 4. Each verified Paddle price activates the matching plan
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
  console.log('  ✓ 4. Each verified Paddle price activates matching plan (STARTER, PRO, BUSINESS)');

  // 5. Unknown price IDs do not grant Pro or paid entitlements
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

  const unknownEventId = `evt_unknown_price_${Date.now()}`;
  await PaddleBillingService.handleWebhookEvent({
    event_id: unknownEventId,
    event_type: 'subscription.activated',
    occurred_at: new Date().toISOString(),
    data: {
      id: `sub_unknown_${Date.now()}`,
      customer_id: 'ctm_unknown',
      status: 'active',
      custom_data: { organization_id: orgUnknownId },
      items: [{ price: { id: 'pri_unknown_random_id_9999' } }],
    },
  });

  const unknownSub = await PaddleBillingService.getSubscription(orgUnknownId);
  // Unknown price ID must not be activated or grant Pro
  if (unknownSub.subscription?.status === SubscriptionStatus.ACTIVE) {
    throw new Error('Unknown price ID must NOT activate subscription!');
  }
  if (unknownSub.isPro === true) {
    throw new Error('Unknown price ID must NOT grant isPro!');
  }
  if (unknownSub.planTier !== 'TRIAL') {
    throw new Error('Unknown price ID must NOT grant paid planTier!');
  }
  console.log('  ✓ 5. Unknown price IDs fail closed and do not grant Pro');

  // 6. Failed and cancelled checkouts do not activate paid plans
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
  console.log('  ✓ 6. Failed and cancelled checkouts do not activate paid plans');

  // 7. Voice-minute limits match the selected plan
  // Trial: 15m
  const trialUsage = await VoiceService.getVoiceUsage(orgUnknownId);
  if (trialUsage.includedMinutes !== 15) {
    throw new Error(`Expected Trial to have 15 voice minutes, got ${trialUsage.includedMinutes}`);
  }

  // Starter: 50m
  await db.execute(
    `UPDATE subscriptions SET status = 'ACTIVE', plan_tier = 'STARTER', price_id = $1 WHERE organization_id = $2`,
    [config.paddle.plans.STARTER.priceId, orgId]
  );
  const starterUsage = await VoiceService.getVoiceUsage(orgId);
  if (starterUsage.includedMinutes !== 50) {
    throw new Error(`Expected Starter to have 50 voice minutes, got ${starterUsage.includedMinutes}`);
  }

  // Pro: 150m
  await db.execute(
    `UPDATE subscriptions SET status = 'ACTIVE', plan_tier = 'PRO', price_id = $1 WHERE organization_id = $2`,
    [config.paddle.plans.PRO.priceId, orgId]
  );
  const proUsage = await VoiceService.getVoiceUsage(orgId);
  if (proUsage.includedMinutes !== 150) {
    throw new Error(`Expected Pro to have 150 voice minutes, got ${proUsage.includedMinutes}`);
  }

  // Business: 400m
  await db.execute(
    `UPDATE subscriptions SET status = 'ACTIVE', plan_tier = 'BUSINESS', price_id = $1 WHERE organization_id = $2`,
    [config.paddle.plans.BUSINESS.priceId, orgId]
  );
  const businessUsage = await VoiceService.getVoiceUsage(orgId);
  if (businessUsage.includedMinutes !== 400) {
    throw new Error(`Expected Business to have 400 voice minutes, got ${businessUsage.includedMinutes}`);
  }
  console.log('  ✓ 7. Voice-minute limits match selected plan (Trial=15m, Starter=50m, Pro=150m, Business=400m)');

  // 8. Trial remains free, cardless, and seven days
  const authFresh = await AuthService.register({
    email: `fresh-trial-${Date.now()}@example.test`,
    password: 'password123',
    fullName: 'Fresh Trial User',
    businessName: 'org_fresh_trial_001',
  });
  const freshOrgId = authFresh.organization!.id;
  await AuthService.completeOnboarding({
    userId: authFresh.user.id,
    organizationId: freshOrgId,
    industry: 'Clinic',
    businessKnowledge: 'Fresh trial clinic is open Monday through Friday 9 AM to 6 PM.',
  });

  const freshSub = await PaddleBillingService.getSubscription(freshOrgId);
  if (freshSub.subscription?.status !== SubscriptionStatus.TRIALING) {
    throw new Error(`Expected TRIALING, got ${freshSub.subscription?.status}`);
  }
  if (freshSub.subscription?.paddleSubscriptionId || freshSub.subscription?.paddleCustomerId) {
    throw new Error('Trial must be completely cardless with no Paddle payment method');
  }
  const trialDays = Math.round(
    (new Date(freshSub.subscription!.trialEndsAt!).getTime() - new Date(freshSub.subscription!.trialStartedAt!).getTime()) /
      (1000 * 60 * 60 * 24)
  );
  if (trialDays !== 7) {
    throw new Error(`Expected trial duration to be 7 days, got ${trialDays}`);
  }
  console.log('  ✓ 8. Trial remains free ($0), cardless, and exactly 7 days');

  // 9. Expired trial users can still access Billing and upgrade
  await db.execute(
    `UPDATE subscriptions SET status = 'EXPIRED', trial_ends_at = $1 WHERE organization_id = $2`,
    [new Date(Date.now() - 86400000).toISOString(), freshOrgId]
  );
  const expiredStatus = await PaddleBillingService.getSubscription(freshOrgId);
  const customerBillingStatus = toCustomerBillingStatus({
    subscription: expiredStatus.subscription,
    planTier: 'TRIAL',
    isTrial: false,
    isTrialActive: false,
    daysRemainingInTrial: 0,
    aiUsageStatus: 'LIMIT_REACHED',
  });

  if (customerBillingStatus.subscription?.status !== SubscriptionStatus.EXPIRED) {
    throw new Error('Expected expired subscription in customer billing status');
  }
  console.log('  ✓ 9. Expired trial users can still access Billing and view plans');

  // 10. Webhook signature validation and idempotency remain intact
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
  console.log('  ✓ 10. Webhook signature validation and idempotency verified');

  // 11. Tenant isolation remains intact
  const authTenantB = await AuthService.register({
    email: `tenant-b-${Date.now()}@example.test`,
    password: 'password123',
    fullName: 'Tenant B User',
    businessName: 'org_tenant_b_001',
  });
  const tenantBOrgId = authTenantB.organization!.id;

  // Activating subscription on orgId must NOT activate Tenant B
  const tenantBSub = await PaddleBillingService.getSubscription(tenantBOrgId);
  if (tenantBSub.subscription?.status === SubscriptionStatus.ACTIVE) {
    throw new Error('Tenant B subscription must NOT be active');
  }
  console.log('  ✓ 11. Multi-tenant subscription isolation verified');

  // 12. Internal AI-cost values are not exposed to normal customers
  const rawStatus = {
    subscription: freshSub.subscription,
    planTier: 'STARTER' as PlanTier,
    isTrial: false,
    isTrialActive: false,
    daysRemainingInTrial: 0,
    aiUsageStatus: 'ACTIVE' as const,
    // Internal values that should be stripped
    budgetUsd: 10,
    costUsd: 1.25,
    internalAllowance: 500,
  };
  const customerView: any = toCustomerBillingStatus(rawStatus);
  if ('budgetUsd' in customerView || 'costUsd' in customerView || 'internalAllowance' in customerView) {
    throw new Error('Customer serializer exposed internal budget/cost fields!');
  }
  console.log('  ✓ 12. Internal AI cost and dollar budgets hidden from customer serializer');

  console.log('--- All Three Subscription Tiers Tests Passed Successfully ---\n');
}
