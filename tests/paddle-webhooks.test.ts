import crypto from 'crypto';
import { PaddleBillingService } from '../server/src/services/PaddleBillingService';
import { AuthService } from '../server/src/services/AuthService';
import { config } from '../server/src/config';
import { SubscriptionStatus } from '@onceclic/shared';
import { db } from '../server/src/db';

export async function runPaddleWebhookTests() {
  console.log('--- Running Paddle Billing & Webhook Signature Tests ---');

  const auth = await AuthService.register({
    email: `paddle_test_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Paddle Tester',
    businessName: 'Paddle SaaS Test',
  });

  const orgId = auth.organization!.id;

  // 1. Initial State: Trialing with Pro access granted
  const subInit = await PaddleBillingService.getSubscription(orgId);
  if (subInit.subscription?.status !== SubscriptionStatus.TRIALING) {
    throw new Error(`Expected initial status TRIALING but got ${subInit.subscription?.status}`);
  }
  if (!subInit.isPro) {
    throw new Error(`Expected isPro to be true during initial 7-day trial`);
  }
  console.log('  ✓ New organization starts on 7-Day Trial (TRIALING status with paid access)');

  // 2. Test HMAC Signature Verification
  const testSecret = 'pdl_ntfset_01testsecretkey123456789';
  const originalSecret = config.paddle.webhookSecret;
  (config.paddle as any).webhookSecret = testSecret;

  const paddleSubId = `sub_paddle_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const paddleCustomerId = `ctm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const evtActivateId = `evt_act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const evtUpdateId = `evt_upd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const evtCancelId = `evt_cnc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const rawBody = JSON.stringify({
    event_id: evtActivateId,
    event_type: 'subscription.activated',
    occurred_at: new Date().toISOString(),
    data: {
      id: paddleSubId,
      customer_id: paddleCustomerId,
      status: 'active',
      custom_data: { organization_id: orgId },
      current_billing_period: {
        starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      },
    },
  });

  const ts = Math.floor(Date.now() / 1000).toString();
  const signedPayload = `${ts}:${rawBody}`;
  const validHmac = crypto.createHmac('sha256', testSecret).update(signedPayload).digest('hex');
  const validHeader = `ts=${ts};h1=${validHmac}`;

  // Verify valid signature
  const isValid = PaddleBillingService.verifyWebhookSignature(rawBody, validHeader);
  if (!isValid) {
    throw new Error('HMAC Signature verification failed for valid Paddle signature.');
  }
  console.log('  ✓ Authoritative Paddle HMAC-SHA256 signature verified successfully');

  // Verify tampered / invalid signature fails
  const invalidHeader = `ts=${ts};h1=badsignature00000000000000000000000000000000`;
  const isInvalidRejected = !PaddleBillingService.verifyWebhookSignature(rawBody, invalidHeader);
  if (!isInvalidRejected) {
    throw new Error('Security Failure: Tampered / forged webhook signature was accepted!');
  }
  console.log('  ✓ Forged / tampered Paddle webhook signature rejected safely');

  // 3. Process Verified Webhook Activation
  await PaddleBillingService.handleWebhookEvent(JSON.parse(rawBody));
  const subActive = await PaddleBillingService.getSubscription(orgId);
  if (subActive.subscription?.status !== SubscriptionStatus.ACTIVE || !subActive.isPro) {
    throw new Error(`Expected status ACTIVE and isPro true after webhook processing, got ${subActive.subscription?.status}`);
  }
  console.log('  ✓ Verified webhook successfully transitioned subscription to ACTIVE (Paid)');

  // 4. Test Webhook Idempotency: Processing identical event_id second time
  const dupResult = await PaddleBillingService.handleWebhookEvent(JSON.parse(rawBody));
  if (!dupResult.success || !dupResult.message.includes('idempotent')) {
    throw new Error(`Expected idempotent duplicate handling but got ${JSON.stringify(dupResult)}`);
  }
  console.log('  ✓ Webhook processing is idempotent: duplicate delivery recognized and skipped safely');

  // 5. Process Scheduled Cancellation Webhook (subscription.updated with scheduled_change = cancel)
  const updatePayload = {
    event_id: evtUpdateId,
    event_type: 'subscription.updated',
    occurred_at: new Date().toISOString(),
    data: {
      id: paddleSubId,
      customer_id: paddleCustomerId,
      status: 'active',
      scheduled_change: {
        action: 'cancel',
        effective_at: new Date(Date.now() + 20 * 86400000).toISOString(),
      },
      current_billing_period: {
        starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 20 * 86400000).toISOString(),
      },
      custom_data: { organization_id: orgId },
    },
  };

  await PaddleBillingService.handleWebhookEvent(updatePayload);
  const subScheduled = await PaddleBillingService.getSubscription(orgId);
  if (subScheduled.subscription?.status !== SubscriptionStatus.ACTIVE) {
    throw new Error(`Expected status to remain ACTIVE while cancellation is scheduled, got ${subScheduled.subscription?.status}`);
  }
  if (!subScheduled.subscription?.cancelAtPeriodEnd) {
    throw new Error(`Expected cancelAtPeriodEnd to be true`);
  }
  if (!subScheduled.isPro) {
    throw new Error(`Access should NOT be revoked immediately when cancellation is scheduled at end of period!`);
  }
  console.log('  ✓ Scheduled cancellation preserves ACTIVE status and retains Pro access until period end');

  // 6. Process Subscription Cancellation Webhook (Terminal state)
  const cancelPayload = {
    event_id: evtCancelId,
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
  if (subCanceled.subscription?.status !== SubscriptionStatus.CANCELED) {
    throw new Error(`Expected status CANCELED after webhook processing, got ${subCanceled.subscription?.status}`);
  }
  if (subCanceled.isPro) {
    throw new Error(`Expected isPro to be FALSE after terminal subscription cancellation`);
  }
  console.log('  ✓ Terminal cancellation webhook successfully transitioned subscription to CANCELED and revoked Pro access');

  // Restore config
  (config.paddle as any).webhookSecret = originalSecret;
}
