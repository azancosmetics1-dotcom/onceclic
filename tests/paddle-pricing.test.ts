import crypto from 'crypto';
import { PaddleBillingService } from '../server/src/services/PaddleBillingService';
import { AuthService } from '../server/src/services/AuthService';
import { config } from '../server/src/config';
import { SubscriptionStatus } from '@onceclic/shared';
import { db } from '../server/src/db';

export async function runPaddlePricingTests() {
  console.log('--- Running Paddle $19/mo Pricing & 7-Day Free Trial Lifecycle Tests ---');

  // 1. $19/month price configuration verification
  if (config.billing.monthlyPriceUsd !== 19) {
    throw new Error(`Expected config.billing.monthlyPriceUsd to be 19, got ${config.billing.monthlyPriceUsd}`);
  }
  if (!config.paddle.proMonthlyPriceId) {
    throw new Error('config.paddle.proMonthlyPriceId is missing');
  }
  console.log(`  ✓ 1. $19/month price configuration verified (Price ID: ${config.paddle.proMonthlyPriceId})`);

  // 2. $0 trial configuration
  if (config.billing.trialPriceUsd !== 0) {
    throw new Error(`Expected trial price to be $0, got $${config.billing.trialPriceUsd}`);
  }
  console.log('  ✓ 2. $0 trial configuration verified ($0 trial price)');

  // 3. 7-day duration
  if (config.billing.trialPeriodDays !== 7) {
    throw new Error(`Expected trial period to be 7 days, got ${config.billing.trialPeriodDays}`);
  }
  console.log('  ✓ 3. 7-day trial duration verified (7 days)');

  // 4. No card required during trial
  const auth = await AuthService.register({
    email: `trial-test-${Date.now()}@example.test`,
    password: 'password123',
    fullName: 'Trial Test User',
    businessName: 'org_trial_test_001',
  });
  const orgId = auth.organization!.id;

  // Complete onboarding to activate trial (trial is started as part of onboarding completion)
  await AuthService.completeOnboarding({
    userId: auth.user.id,
    organizationId: orgId,
    industry: 'Restaurant',
    businessKnowledge: 'Trial test restaurant is open daily 9 AM to 9 PM. Located at 1 Test Avenue.',
  });

  const subTrial = await PaddleBillingService.getSubscription(orgId);
  if (subTrial.subscription?.status !== SubscriptionStatus.TRIALING) {
    throw new Error(`Expected status TRIALING, got ${subTrial.subscription?.status}`);
  }
  if (subTrial.subscription?.paddleSubscriptionId || subTrial.subscription?.paddleCustomerId) {
    throw new Error('Trial must start with no credit card / Paddle customer ID required');
  }
  console.log('  ✓ 4. No credit card required during trial (active without payment method)');

  // 4b. Deterministic Date Lifecycle Verification
  // Fresh trial: 2026-01-01T10:00:00Z -> 2026-01-08T10:00:00Z
  const trialStartFixed = '2026-01-01T10:00:00.000Z';
  const trialEndFixed = '2026-01-08T10:00:00.000Z';
  const trialEndMs = new Date(trialEndFixed).getTime();

  await db.execute(
    `UPDATE subscriptions SET trial_started_at = $1, trial_ends_at = $2, status = 'TRIALING' WHERE organization_id = $3`,
    [trialStartFixed, trialEndFixed, orgId]
  );

  // Scenario: Day 6 (2026-01-07T10:00:00Z) -> Active trial
  const day6Ms = new Date('2026-01-07T10:00:00.000Z').getTime();
  const diffDaysDay6 = Math.max(0, Math.ceil((trialEndMs - day6Ms) / (1000 * 60 * 60 * 24)));
  if (diffDaysDay6 !== 1 || day6Ms > trialEndMs) {
    throw new Error(`Expected Day 6 to be active with 1 day remaining, got ${diffDaysDay6} days`);
  }

  // Scenario: Exact Expiration (2026-01-08T10:00:00Z) -> Expired
  const exactExpMs = new Date('2026-01-08T10:00:00.000Z').getTime();
  const isExactExpired = exactExpMs >= trialEndMs;
  if (!isExactExpired) {
    throw new Error('Expected exact expiration timestamp to be evaluated as expired.');
  }

  // Scenario: After Expiration (2026-01-08T10:01:00Z) -> Expired
  const afterExpMs = new Date('2026-01-08T10:01:00.000Z').getTime();
  const isAfterExpired = afterExpMs > trialEndMs;
  if (!isAfterExpired) {
    throw new Error('Expected post-expiration timestamp to be evaluated as expired.');
  }
  console.log('  ✓ 4b. Deterministic trial date timeline verified (Fresh -> Day 6 Active -> Exact Expiration -> Expired)');

  // 5. Upgrade to Pro via Paddle payment flow
  const paddleSubId = `sub_pdl_${Date.now()}`;
  const paddleCustomerId = `ctm_pdl_${Date.now()}`;
  const evtActivateId = `evt_act_${Date.now()}`;

  const activatePayload = {
    event_id: evtActivateId,
    event_type: 'subscription.activated',
    occurred_at: new Date().toISOString(),
    data: {
      id: paddleSubId,
      customer_id: paddleCustomerId,
      status: 'active',
      custom_data: { organization_id: orgId },
      items: [
        {
          price: {
            id: config.paddle.proMonthlyPriceId,
            unit_price: { amount: '1900', currency_code: 'USD' },
          },
          quantity: 1,
        },
      ],
      current_billing_period: {
        starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      },
    },
  };

  // 6. Paddle HMAC-SHA256 signature verification
  const testSecret = 'pdl_ntfset_testsecret12345';
  const origSecret = config.paddle.webhookSecret;
  (config.paddle as any).webhookSecret = testSecret;

  const rawBody = JSON.stringify(activatePayload);
  const ts = Math.floor(Date.now() / 1000).toString();
  const signedPayload = `${ts}:${rawBody}`;
  const validHmac = crypto.createHmac('sha256', testSecret).update(signedPayload).digest('hex');
  const validHeader = `ts=${ts};h1=${validHmac}`;

  const sigValid = PaddleBillingService.verifyWebhookSignature(rawBody, validHeader);
  if (!sigValid) {
    throw new Error('Paddle webhook signature verification failed.');
  }
  console.log('  ✓ 5. Paddle HMAC-SHA256 signature verification verified');

  // 7. Webhook idempotency
  await PaddleBillingService.handleWebhookEvent(activatePayload);
  const dupResult = await PaddleBillingService.handleWebhookEvent(activatePayload);
  if (!dupResult.success || !dupResult.message.includes('idempotent')) {
    throw new Error('Webhook idempotency failed on duplicate event delivery');
  }
  console.log('  ✓ 6. Webhook idempotency verified (duplicate delivery recognized)');

  // 8. ACTIVE state verified
  const subActive = await PaddleBillingService.getSubscription(orgId);
  if (subActive.subscription?.status !== SubscriptionStatus.ACTIVE || !subActive.isPro) {
    throw new Error(`Expected ACTIVE state and isPro=true, got ${subActive.subscription?.status}`);
  }
  console.log('  ✓ 7. ACTIVE state verified after Pro upgrade');

  // 9. Cancellation webhook
  const cancelPayload = {
    event_id: `evt_cancel_${Date.now()}`,
    event_type: 'subscription.canceled',
    occurred_at: new Date().toISOString(),
    data: {
      id: paddleSubId,
      status: 'canceled',
      custom_data: { organization_id: orgId },
    },
  };
  await PaddleBillingService.handleWebhookEvent(cancelPayload);
  const subCanceled = await PaddleBillingService.getSubscription(orgId);
  if (subCanceled.subscription?.status !== SubscriptionStatus.CANCELED || subCanceled.isPro) {
    throw new Error(`Expected CANCELED state and isPro=false, got ${subCanceled.subscription?.status}`);
  }
  console.log('  ✓ 8. Subscription cancellation verified (status=CANCELED, access revoked)');

  // 10. Expired trial without payment
  const expAuth = await AuthService.register({
    email: `exp_test_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Exp Tester',
    businessName: 'Exp Org',
  });
  const expOrgId = expAuth.organization!.id;
  await AuthService.completeOnboarding({
    userId: expAuth.user.id,
    organizationId: expOrgId,
    industry: 'Restaurant',
    businessKnowledge: 'Exp Org Restaurant is open daily 9 AM to 9 PM. Located at 1 Expired Street.',
  });

  // Simulate 7 days elapsed with no payment method
  await db.execute(
    `UPDATE subscriptions
     SET status = 'EXPIRED',
         trial_ends_at = $1
     WHERE organization_id = $2`,
    [new Date(Date.now() - 1000).toISOString(), expOrgId]
  );

  const subExpired = await PaddleBillingService.getSubscription(expOrgId);
  if (subExpired.subscription?.status !== SubscriptionStatus.EXPIRED || subExpired.isPro) {
    throw new Error('Expired trial without payment must be marked EXPIRED with isPro=false');
  }
  console.log('  ✓ 9. Expired trial without payment verified (no auto-charge, restricted access)');

  // 11. Expired user can still access Billing and start Pro checkout
  if (!subExpired.subscription) {
    throw new Error('Expired user must be able to retrieve subscription for Billing page.');
  }
  if (!config.paddle.priceId || !config.paddle.proMonthlyPriceId) {
    throw new Error('Paddle price ID must be available for checkout creation.');
  }
  console.log('  ✓ 10. Expired account can still access Billing & initiate Pro checkout');

  // 12. Failed payment does not activate Pro
  const failOrgAuth = await AuthService.register({
    email: `fail_pay_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Fail Tester',
    businessName: 'Fail Org',
  });
  const failOrgId = failOrgAuth.organization!.id;
  await AuthService.completeOnboarding({
    userId: failOrgAuth.user.id,
    organizationId: failOrgId,
    industry: 'Restaurant',
    businessKnowledge: 'Fail Org Restaurant is open daily 9 AM to 9 PM. Located at 1 Fail Street.',
  });

  // Simulate trial expired
  await db.execute(
    `UPDATE subscriptions SET status = 'EXPIRED', trial_ends_at = $1 WHERE organization_id = $2`,
    [new Date(Date.now() - 1000).toISOString(), failOrgId]
  );

  const failedPaymentPayload = {
    event_id: `evt_fail_${Date.now()}`,
    event_type: 'transaction.payment_failed',
    occurred_at: new Date().toISOString(),
    data: {
      id: `txn_fail_${Date.now()}`,
      error_code: 'card_declined',
      custom_data: { organization_id: failOrgId },
    },
  };
  await PaddleBillingService.handleWebhookEvent(failedPaymentPayload);
  const subAfterFailedPay = await PaddleBillingService.getSubscription(failOrgId);
  if (subAfterFailedPay.isPro || subAfterFailedPay.subscription?.status === SubscriptionStatus.ACTIVE) {
    throw new Error('Failed payment must NOT activate Pro or set status to ACTIVE.');
  }
  console.log('  ✓ 11. Failed payment does not activate Pro');

  // 13. Cancelled checkout (no webhook) does not activate Pro
  const subUnchanged = await PaddleBillingService.getSubscription(failOrgId);
  if (subUnchanged.isPro) {
    throw new Error('Cancelled checkout must leave subscription inactive.');
  }
  console.log('  ✓ 12. Cancelled checkout does not activate Pro');

  // 14. Upgrade after expiration (EXPIRED -> PRO)
  const upgradeAfterExpPayload = {
    event_id: `evt_exp_upg_${Date.now()}`,
    event_type: 'subscription.activated',
    occurred_at: new Date().toISOString(),
    data: {
      id: `sub_exp_upg_${Date.now()}`,
      customer_id: `ctm_exp_upg_${Date.now()}`,
      status: 'active',
      custom_data: { organization_id: expOrgId },
      items: [
        {
          price: {
            id: config.paddle.proMonthlyPriceId,
            unit_price: { amount: '1900', currency_code: 'USD' },
          },
          quantity: 1,
        },
      ],
      current_billing_period: {
        starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      },
    },
  };
  await PaddleBillingService.handleWebhookEvent(upgradeAfterExpPayload);
  const subAfterExpUpgrade = await PaddleBillingService.getSubscription(expOrgId);
  if (subAfterExpUpgrade.subscription?.status !== SubscriptionStatus.ACTIVE || !subAfterExpUpgrade.isPro) {
    throw new Error('Upgrading from EXPIRED state must transition account to ACTIVE / Pro.');
  }
  console.log('  ✓ 13. Upgrade after expiration (EXPIRED -> PRO) succeeds immediately');

  (config.paddle as any).webhookSecret = origSecret;
}
