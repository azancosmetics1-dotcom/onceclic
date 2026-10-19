import crypto from 'crypto';
import { PaddleBillingService } from '../server/src/services/PaddleBillingService';
import { AuthService } from '../server/src/services/AuthService';
import { config } from '../server/src/config';
import {
  SubscriptionStatus,
  SUBSCRIPTION_PLANS,
  PaidPlanTier,
  PlanTier,
} from '@onceclic/shared';
import { db } from '../server/src/db';
import { toCustomerBillingStatus, toCustomerBillingConfig } from '../server/src/serializers/customerSerializers';
import { Environment } from '@paddle/paddle-node-sdk';

export async function runPaddleLiveSwitchTests() {
  console.log('--- Running Paddle Live Switch & Pricing Verification Tests ---');

  // =========================================================================
  // 1. Live/Sandbox environment selection logic
  // =========================================================================
  const originalEnv = config.paddle.environment;
  const originalPlans = JSON.parse(JSON.stringify(config.paddle.plans));
  const originalSecret = config.paddle.webhookSecret;

  try {
    // 1.1 Verify SDK Environment mapping
    if (Environment.production !== 'production') {
      throw new Error(`Expected Environment.production to be "production", got ${Environment.production}`);
    }
    if (Environment.sandbox !== 'sandbox') {
      throw new Error(`Expected Environment.sandbox to be "sandbox", got ${Environment.sandbox}`);
    }

    // 1.2 Verify environment selection behavior
    config.paddle.environment = 'production';
    if (config.paddle.environment !== 'production') {
      throw new Error('Failed to set paddle environment to production');
    }

    config.paddle.environment = 'sandbox';
    if (config.paddle.environment !== 'sandbox') {
      throw new Error('Failed to set paddle environment to sandbox');
    }

    // Restore to sandbox for local tests
    config.paddle.environment = 'sandbox';
    console.log('  ✓ 1. Live and Sandbox environments map correctly to Paddle Node SDK constants');

    // =========================================================================
    // 2. Final Live Pricing ($19/mo, $49/mo, $99/mo)
    // =========================================================================
    if (SUBSCRIPTION_PLANS.STARTER.priceUsd !== 19) {
      throw new Error(`Expected STARTER price to be 19, got ${SUBSCRIPTION_PLANS.STARTER.priceUsd}`);
    }
    if (SUBSCRIPTION_PLANS.STARTER.voiceMinutes !== 50) {
      throw new Error(`Expected STARTER voiceMinutes to be 50, got ${SUBSCRIPTION_PLANS.STARTER.voiceMinutes}`);
    }

    if (SUBSCRIPTION_PLANS.PRO.priceUsd !== 49) {
      throw new Error(`Expected PRO price to be 49, got ${SUBSCRIPTION_PLANS.PRO.priceUsd}`);
    }
    if (SUBSCRIPTION_PLANS.PRO.voiceMinutes !== 150) {
      throw new Error(`Expected PRO voiceMinutes to be 150, got ${SUBSCRIPTION_PLANS.PRO.voiceMinutes}`);
    }

    if (SUBSCRIPTION_PLANS.BUSINESS.priceUsd !== 99) {
      throw new Error(`Expected BUSINESS price to be 99, got ${SUBSCRIPTION_PLANS.BUSINESS.priceUsd}`);
    }
    if (SUBSCRIPTION_PLANS.BUSINESS.voiceMinutes !== 400) {
      throw new Error(`Expected BUSINESS voiceMinutes to be 400, got ${SUBSCRIPTION_PLANS.BUSINESS.voiceMinutes}`);
    }
    console.log('  ✓ 2. Customer-facing pricing verified: Starter $19/mo, Pro $49/mo, Business $99/mo');

    // =========================================================================
    // 3. Six Price-ID mapping paths (Backend & Frontend variables)
    // =========================================================================
    const testStarterPriceId = 'pri_live_starter_01j7live0001';
    const testProPriceId = 'pri_live_pro_01j7live0002';
    const testBusinessPriceId = 'pri_live_business_01j7live0003';

    config.paddle.plans.STARTER.priceId = testStarterPriceId;
    config.paddle.plans.PRO.priceId = testProPriceId;
    config.paddle.plans.BUSINESS.priceId = testBusinessPriceId;

    const resolvedStarter = PaddleBillingService.resolvePlanTierFromPriceId(testStarterPriceId);
    const resolvedPro = PaddleBillingService.resolvePlanTierFromPriceId(testProPriceId);
    const resolvedBusiness = PaddleBillingService.resolvePlanTierFromPriceId(testBusinessPriceId);

    if (resolvedStarter !== 'STARTER') throw new Error(`Expected STARTER, got ${resolvedStarter}`);
    if (resolvedPro !== 'PRO') throw new Error(`Expected PRO, got ${resolvedPro}`);
    if (resolvedBusiness !== 'BUSINESS') throw new Error(`Expected BUSINESS, got ${resolvedBusiness}`);

    // Verify serialization to client config
    const clientConfig = toCustomerBillingConfig(config);
    if (clientConfig.plans.STARTER.priceId !== testStarterPriceId || clientConfig.plans.STARTER.priceUsd !== 19) {
      throw new Error('Client config mismatch for STARTER');
    }
    if (clientConfig.plans.PRO.priceId !== testProPriceId || clientConfig.plans.PRO.priceUsd !== 49) {
      throw new Error('Client config mismatch for PRO');
    }
    if (clientConfig.plans.BUSINESS.priceId !== testBusinessPriceId || clientConfig.plans.BUSINESS.priceUsd !== 99) {
      throw new Error('Client config mismatch for BUSINESS');
    }
    console.log('  ✓ 3. All three subscription tiers map authoritatively without collisions');

    // =========================================================================
    // 4. Missing price-ID handling & Collision detection
    // =========================================================================
    config.paddle.plans.STARTER.priceId = '';
    const missingStarterCheck = PaddleBillingService.validatePlanPriceMapping('STARTER');
    if (missingStarterCheck.valid || !missingStarterCheck.error?.includes('Missing configured Paddle price ID')) {
      throw new Error('Missing price ID must produce invalid status with clear error message');
    }
    config.paddle.plans.STARTER.priceId = testStarterPriceId;

    // Test collision
    config.paddle.plans.BUSINESS.priceId = testStarterPriceId;
    const collisionCheck = PaddleBillingService.validatePlanPriceMapping('BUSINESS');
    if (collisionCheck.valid || !collisionCheck.error?.includes('collision')) {
      throw new Error('Price ID collision must be detected and rejected');
    }
    config.paddle.plans.BUSINESS.priceId = testBusinessPriceId;
    console.log('  ✓ 4. Missing price IDs and duplicate/colliding IDs produce safe validation errors');

    // =========================================================================
    // 5. Rejection of Sandbox price IDs when in Live/Production mode
    // =========================================================================
    config.paddle.environment = 'production';
    config.paddle.plans.STARTER.priceId = 'pri_starter_19m_sandbox';
    const sandboxInProdValidation = PaddleBillingService.validatePlanPriceMapping('STARTER');
    if (sandboxInProdValidation.valid || !sandboxInProdValidation.error?.includes('Sandbox price ID')) {
      throw new Error('Sandbox price ID must be rejected in production mode');
    }

    const resolvedSandboxInProd = PaddleBillingService.resolvePlanTierFromPriceId('pri_starter_19m_sandbox');
    if (resolvedSandboxInProd !== null) {
      throw new Error('Sandbox price ID must never resolve to a paid tier in production mode');
    }

    // Restore to sandbox
    config.paddle.environment = 'sandbox';
    config.paddle.plans.STARTER.priceId = testStarterPriceId;
    console.log('  ✓ 5. Accidental sandbox price IDs in Live/Production mode are strictly rejected');

    // =========================================================================
    // 6. Unknown Price Rejection in Webhook Handler
    // =========================================================================
    const authUnknown = await AuthService.register({
      email: `paddle-live-unknown-${Date.now()}@example.test`,
      password: 'password123',
      fullName: 'Unknown Price Test User',
      businessName: 'org_unknown_paddle_test',
    });
    const orgUnknownId = authUnknown.organization!.id;
    await AuthService.completeOnboarding({
      userId: authUnknown.user.id,
      organizationId: orgUnknownId,
      industry: 'Dental',
      businessKnowledge: 'Dental practice is open Mon-Fri.',
    });

    // Expire trial so trialing access does not mask paid entitlement evaluation
    await db.execute(
      `UPDATE subscriptions SET status = 'EXPIRED', trial_ends_at = $1 WHERE organization_id = $2`,
      [new Date(Date.now() - 86400000).toISOString(), orgUnknownId]
    );

    const unknownWebhook = {
      event_id: `evt_unknown_price_${Date.now()}`,
      event_type: 'subscription.activated',
      occurred_at: new Date().toISOString(),
      data: {
        id: `sub_unknown_${Date.now()}`,
        customer_id: 'ctm_unknown',
        status: 'active',
        custom_data: { organization_id: orgUnknownId },
        items: [{ price: { id: 'pri_completely_unmapped_and_fake_9999' } }],
      },
    };
    await PaddleBillingService.handleWebhookEvent(unknownWebhook);

    const subAfterUnknown = await PaddleBillingService.getSubscription(orgUnknownId);
    if (subAfterUnknown.isPro || subAfterUnknown.subscription?.status === SubscriptionStatus.ACTIVE) {
      throw new Error('Unknown price ID MUST NOT activate paid subscription or grant isPro!');
    }
    console.log('  ✓ 6. Unknown price IDs are rejected by webhook handler and do not activate paid plans');

    // =========================================================================
    // 7. Webhook HMAC-SHA256 Signature Verification & Idempotency
    // =========================================================================
    config.paddle.webhookSecret = 'pdl_ntfset_01jh_test_live_switch_secret';
    const samplePayload = JSON.stringify({
      event_id: 'evt_sig_verification_test',
      event_type: 'subscription.activated',
      occurred_at: new Date().toISOString(),
      data: { id: 'sub_sig_test' },
    });

    const nowTs = Math.floor(Date.now() / 1000).toString();
    const correctHmac = crypto.createHmac('sha256', config.paddle.webhookSecret).update(`${nowTs}:${samplePayload}`).digest('hex');
    const validHeader = `ts=${nowTs};h1=${correctHmac}`;

    if (!PaddleBillingService.verifyWebhookSignature(samplePayload, validHeader)) {
      throw new Error('Valid HMAC signature failed verification');
    }

    if (PaddleBillingService.verifyWebhookSignature(samplePayload, `ts=${nowTs};h1=tampered_signature`)) {
      throw new Error('Tampered signature unexpectedly passed verification');
    }

    if (PaddleBillingService.verifyWebhookSignature(samplePayload + 'tampered', validHeader)) {
      throw new Error('Tampered payload unexpectedly passed verification');
    }

    // Idempotency: duplicate event
    const duplicateEvt = {
      event_id: `evt_idempotency_live_test_${Date.now()}`,
      event_type: 'subscription.updated',
      occurred_at: new Date().toISOString(),
      data: { id: `sub_idemp_${Date.now()}` },
    };
    const firstCall = await PaddleBillingService.handleWebhookEvent(duplicateEvt);
    const secondCall = await PaddleBillingService.handleWebhookEvent(duplicateEvt);
    if (!firstCall.success || !secondCall.success || !secondCall.message.includes('already processed')) {
      throw new Error('Duplicate webhook event was not idempotently deduplicated');
    }
    console.log('  ✓ 7. Webhook signature verification and idempotency verified strictly');

    // =========================================================================
    // 8. Correct Plan Activation for all 3 Tiers
    // =========================================================================
    const authTiers = await AuthService.register({
      email: `paddle-live-tiers-${Date.now()}@example.test`,
      password: 'password123',
      fullName: 'Live Tiers User',
      businessName: 'org_live_tiers_test',
    });
    const orgTiersId = authTiers.organization!.id;
    await AuthService.completeOnboarding({
      userId: authTiers.user.id,
      organizationId: orgTiersId,
      industry: 'Clinic',
      businessKnowledge: 'Clinic is open 9 to 5.',
    });

    const tiersToTest: { tier: PaidPlanTier; priceId: string }[] = [
      { tier: 'STARTER', priceId: testStarterPriceId },
      { tier: 'PRO', priceId: testProPriceId },
      { tier: 'BUSINESS', priceId: testBusinessPriceId },
    ];

    for (const item of tiersToTest) {
      const evtId = `evt_activate_${item.tier.toLowerCase()}_${Date.now()}`;
      await PaddleBillingService.handleWebhookEvent({
        event_id: evtId,
        event_type: 'subscription.activated',
        occurred_at: new Date().toISOString(),
        data: {
          id: `sub_${item.tier.toLowerCase()}_${Date.now()}`,
          customer_id: `ctm_${item.tier.toLowerCase()}`,
          status: 'active',
          custom_data: { organization_id: orgTiersId },
          items: [{ price: { id: item.priceId } }],
          current_billing_period: {
            starts_at: new Date().toISOString(),
            ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
          },
        },
      });

      const subStatus = await PaddleBillingService.getSubscription(orgTiersId);
      if (subStatus.subscription?.status !== SubscriptionStatus.ACTIVE) {
        throw new Error(`Expected ACTIVE status for ${item.tier}, got ${subStatus.subscription?.status}`);
      }
      if (subStatus.subscription?.planTier !== item.tier) {
        throw new Error(`Expected planTier ${item.tier}, got ${subStatus.subscription?.planTier}`);
      }
      if (!subStatus.isPro) {
        throw new Error(`Expected isPro to be true for ${item.tier}`);
      }
    }
    console.log('  ✓ 8. Verified successful payments activate Starter, Pro, and Business correctly');

    // =========================================================================
    // 9. Failed & Canceled Payments Do Not Activate Plans
    // =========================================================================
    const authPastDue = await AuthService.register({
      email: `paddle-live-pastdue-${Date.now()}@example.test`,
      password: 'password123',
      fullName: 'Past Due User',
      businessName: 'org_past_due_test',
    });
    const orgPastDueId = authPastDue.organization!.id;
    await AuthService.completeOnboarding({
      userId: authPastDue.user.id,
      organizationId: orgPastDueId,
      industry: 'Restaurant',
      businessKnowledge: 'Restaurant is open weekdays.',
    });

    await db.execute(
      `UPDATE subscriptions SET status = 'EXPIRED', trial_ends_at = $1 WHERE organization_id = $2`,
      [new Date(Date.now() - 86400000).toISOString(), orgPastDueId]
    );

    // Past due
    await PaddleBillingService.handleWebhookEvent({
      event_id: `evt_past_due_${Date.now()}`,
      event_type: 'subscription.past_due',
      occurred_at: new Date().toISOString(),
      data: {
        id: `sub_past_due_${Date.now()}`,
        customer_id: 'ctm_past_due',
        status: 'past_due',
        custom_data: { organization_id: orgPastDueId },
      },
    });

    const subPastDue = await PaddleBillingService.getSubscription(orgPastDueId);
    if (subPastDue.subscription?.status === SubscriptionStatus.ACTIVE) {
      throw new Error('Past due status must NOT be ACTIVE');
    }

    // Canceled
    await PaddleBillingService.handleWebhookEvent({
      event_id: `evt_canceled_${Date.now()}`,
      event_type: 'subscription.canceled',
      occurred_at: new Date().toISOString(),
      data: {
        id: `sub_canceled_${Date.now()}`,
        customer_id: 'ctm_canceled',
        status: 'canceled',
        custom_data: { organization_id: orgPastDueId },
      },
    });

    const subCanceled = await PaddleBillingService.getSubscription(orgPastDueId);
    if (subCanceled.subscription?.status === SubscriptionStatus.ACTIVE) {
      throw new Error('Canceled status must NOT be ACTIVE');
    }
    console.log('  ✓ 9. Failed/canceled events do not activate paid subscriptions');

    // =========================================================================
    // 10. Preservation of Existing Subscriptions & Tenant Isolation
    // =========================================================================
    const initialOrgTiersSub = await PaddleBillingService.getSubscription(orgTiersId);
    const initialSubId = initialOrgTiersSub.subscription?.id;

    // Retry checkout event for same organization
    await PaddleBillingService.handleWebhookEvent({
      event_id: `evt_retry_${Date.now()}`,
      event_type: 'subscription.activated',
      occurred_at: new Date().toISOString(),
      data: {
        id: `sub_retry_${Date.now()}`,
        customer_id: 'ctm_retry',
        status: 'active',
        custom_data: { organization_id: orgTiersId },
        items: [{ price: { id: testBusinessPriceId } }],
      },
    });

    const subRows = await db.query(
      'SELECT id, organization_id FROM subscriptions WHERE organization_id = $1',
      [orgTiersId]
    );
    if (subRows.rows.length !== 1) {
      throw new Error(`Expected exactly 1 subscription row for organization, found ${subRows.rows.length}`);
    }
    if (subRows.rows[0].id !== initialSubId) {
      throw new Error('Existing subscription ID was replaced rather than updated in place');
    }
    console.log('  ✓ 10. Existing subscriptions and billing records preserved without duplicate rows');

    // =========================================================================
    // 11. Customer Serializer Strips Internal AI Dollar Budgets
    // =========================================================================
    const rawInternalData = {
      subscription: initialOrgTiersSub.subscription,
      planTier: 'PRO' as PlanTier,
      isPro: true,
      daysRemainingInTrial: 0,
      billingConfigured: true,
      budgetUsd: 10.0,
      spentUsd: 0.15,
      remainingUsd: 9.85,
      trialAiBudgetUsd: 0.5,
      proAiBudgetUsd: 10.0,
      openAiCostUsd: 0.05,
    };

    const serialized = toCustomerBillingStatus(rawInternalData as any);
    const leakedKeys = ['budgetUsd', 'spentUsd', 'remainingUsd', 'trialAiBudgetUsd', 'proAiBudgetUsd', 'openAiCostUsd'];
    for (const key of leakedKeys) {
      if (key in serialized) {
        throw new Error(`Customer serializer leaked internal budget field "${key}"`);
      }
    }
    console.log('  ✓ 11. Customer-facing API responses strip internal AI dollar budgets completely');

    console.log('--- All Paddle Live Switch & Pricing Tests Passed Successfully ---\n');
  } finally {
    // Restore configuration to original sandbox test state
    config.paddle.environment = originalEnv;
    config.paddle.plans = originalPlans;
    config.paddle.webhookSecret = originalSecret;
  }
}
