process.env.USE_EMBEDDED_DB = 'true';
process.env.NODE_ENV = 'test';

import assert from 'assert';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../server/src/db';
import { AuthService } from '../server/src/services/AuthService';
import { VoiceService } from '../server/src/services/voice/VoiceService';
import { CreemBillingService } from '../server/src/services/CreemBillingService';
import { PhoneDeprovisioningWorker } from '../server/src/services/voice/PhoneDeprovisioningWorker';

export async function runCreemRefundReconciliationTests() {
  console.log('--- Running Creem Refund Reconciliation & State Transition Tests ---');

  const uniqueSuffix = Date.now().toString();

  // Helper to create test organization
  const authRes = await AuthService.register({
    email: `refund_test_${uniqueSuffix}@example.com`,
    password: 'Password123!Secure',
    fullName: 'Refund Reconcile Clinic',
    businessName: 'Refund Reconcile Dental',
    industry: 'clinic',
  });
  assert.ok(authRes.organization, 'Registration must return organization');
  const orgId = authRes.organization.id;

  await db.execute(
    `INSERT INTO subscriptions (
       id, organization_id, status, plan_tier, trial_started_at, trial_ends_at, created_at, updated_at
     ) VALUES (
       $1, $2, 'TRIALING', 'TRIAL', CURRENT_TIMESTAMP, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [uuidv4(), orgId, new Date(Date.now() + 14 * 86400000).toISOString()]
  );

  // -------------------------------------------------------------------------
  // Test 1: Provider returns status: 'succeeded' -> checkout marked REFUNDED
  // -------------------------------------------------------------------------
  const phone1 = '+14155553001';
  const phone1Id = uuidv4();
  const checkout1Id = `chk_test_succeed_${uniqueSuffix}`;
  const txn1Id = `txn_succeed_${uniqueSuffix}`;

  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
       billing_status, release_status, is_retained, retention_ends_at, monthly_cost_usd,
       customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'SUSPENDED', 'ACTIVE',
       'SUSPENDED_GRACE_PERIOD', 'RELEASE_IN_PROGRESS', TRUE, CURRENT_TIMESTAMP, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [phone1Id, orgId, phone1]
  );

  await db.execute(
    `INSERT INTO voice_phone_number_checkouts (
       id, organization_id, phone_number, country_code, number_type, provider_cost_usd,
       markup_usd, customer_monthly_cost_usd, setup_cost_usd, currency, pricing_policy_version,
       status, expires_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'US', 'local', 2.00, 1.00, 3.00, 0.00, 'USD', '2026-10-v1',
       'PAID', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [checkout1Id, orgId, phone1]
  );

  CreemBillingService.setCreemSdk({
    transactions: {
      refund: async () => ({
        id: `ref_succeed_${uniqueSuffix}`,
        status: 'succeeded',
      }),
    },
    subscriptions: {
      cancel: async () => ({ status: 'canceled' }),
    },
  });

  await assert.rejects(
    async () => {
      await VoiceService.fulfillPaidPhoneNumberOrder({
        organizationId: orgId,
        phoneNumber: phone1,
        creemSubscriptionId: `sub_test_succeed_${uniqueSuffix}`,
        checkoutSessionId: checkout1Id,
        transactionId: txn1Id,
        checkoutType: 'RENEWAL',
        targetPhoneNumberId: phone1Id,
      });
    },
    /Renewal payment was received, but phone number deprovisioning was already in progress/
  );

  const checkout1Record = await db.getOne<{ status: string; refund_status: string }>(
    'SELECT status, refund_status FROM voice_phone_number_checkouts WHERE id = $1',
    [checkout1Id]
  );
  assert.equal(checkout1Record?.status, 'REFUNDED', 'Checkout must transition to REFUNDED when provider returns succeeded');
  assert.equal(checkout1Record?.refund_status, 'REFUNDED', 'refund_status must be REFUNDED');

  const phone1Record = await VoiceService.getPhoneNumberById(orgId, phone1Id);
  assert.equal(phone1Record?.billingStatus, 'REFUNDED', 'Phone billing status must be REFUNDED');
  console.log('  ✓ 1. Creem refund succeeded response transitions checkout and phone to REFUNDED');

  // -------------------------------------------------------------------------
  // Test 2: Provider returns status: 'pending' -> checkout marked REFUND_PENDING
  // -------------------------------------------------------------------------
  const phone2 = '+14155553002';
  const phone2Id = uuidv4();
  const checkout2Id = `chk_test_pending_${uniqueSuffix}`;
  const txn2Id = `txn_pending_${uniqueSuffix}`;

  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
       billing_status, release_status, is_retained, retention_ends_at, monthly_cost_usd,
       customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'SUSPENDED', 'ACTIVE',
       'SUSPENDED_GRACE_PERIOD', 'RELEASE_IN_PROGRESS', TRUE, CURRENT_TIMESTAMP, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [phone2Id, orgId, phone2]
  );

  await db.execute(
    `INSERT INTO voice_phone_number_checkouts (
       id, organization_id, phone_number, country_code, number_type, provider_cost_usd,
       markup_usd, customer_monthly_cost_usd, setup_cost_usd, currency, pricing_policy_version,
       status, expires_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'US', 'local', 2.00, 1.00, 3.00, 0.00, 'USD', '2026-10-v1',
       'PAID', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [checkout2Id, orgId, phone2]
  );

  CreemBillingService.setCreemSdk({
    transactions: {
      refund: async () => ({
        id: `ref_pending_${uniqueSuffix}`,
        status: 'pending',
      }),
    },
    subscriptions: {
      cancel: async () => ({ status: 'canceled' }),
    },
  });

  await assert.rejects(
    async () => {
      await VoiceService.fulfillPaidPhoneNumberOrder({
        organizationId: orgId,
        phoneNumber: phone2,
        creemSubscriptionId: `sub_test_pending_${uniqueSuffix}`,
        checkoutSessionId: checkout2Id,
        transactionId: txn2Id,
        checkoutType: 'RENEWAL',
        targetPhoneNumberId: phone2Id,
      });
    },
    /Renewal payment was received, but phone number deprovisioning was already in progress/
  );

  const checkout2Record = await db.getOne<{ status: string; refund_status: string }>(
    'SELECT status, refund_status FROM voice_phone_number_checkouts WHERE id = $1',
    [checkout2Id]
  );
  assert.equal(checkout2Record?.status, 'REFUND_PENDING', 'Checkout must transition to REFUND_PENDING when provider returns pending');
  assert.equal(checkout2Record?.refund_status, 'REFUND_PENDING', 'refund_status must be REFUND_PENDING');
  console.log('  ✓ 2. Creem refund pending response transitions checkout and phone to REFUND_PENDING');

  // -------------------------------------------------------------------------
  // Test 3: Provider returns status: 'failed' -> checkout marked MANUAL_REFUND_REQUIRED
  // -------------------------------------------------------------------------
  const phone3 = '+14155553003';
  const phone3Id = uuidv4();
  const checkout3Id = `chk_test_failed_${uniqueSuffix}`;
  const txn3Id = `txn_failed_${uniqueSuffix}`;

  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
       billing_status, release_status, is_retained, retention_ends_at, monthly_cost_usd,
       customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'SUSPENDED', 'ACTIVE',
       'SUSPENDED_GRACE_PERIOD', 'RELEASE_IN_PROGRESS', TRUE, CURRENT_TIMESTAMP, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [phone3Id, orgId, phone3]
  );

  await db.execute(
    `INSERT INTO voice_phone_number_checkouts (
       id, organization_id, phone_number, country_code, number_type, provider_cost_usd,
       markup_usd, customer_monthly_cost_usd, setup_cost_usd, currency, pricing_policy_version,
       status, expires_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'US', 'local', 2.00, 1.00, 3.00, 0.00, 'USD', '2026-10-v1',
       'PAID', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [checkout3Id, orgId, phone3]
  );

  CreemBillingService.setCreemSdk({
    transactions: {
      refund: async () => ({
        id: `ref_failed_${uniqueSuffix}`,
        status: 'failed',
      }),
    },
    subscriptions: {
      cancel: async () => ({ status: 'canceled' }),
    },
  });

  await assert.rejects(
    async () => {
      await VoiceService.fulfillPaidPhoneNumberOrder({
        organizationId: orgId,
        phoneNumber: phone3,
        creemSubscriptionId: `sub_test_failed_${uniqueSuffix}`,
        checkoutSessionId: checkout3Id,
        transactionId: txn3Id,
        checkoutType: 'RENEWAL',
        targetPhoneNumberId: phone3Id,
      });
    },
    /Renewal payment was received, but phone number deprovisioning was already in progress/
  );

  const checkout3Record = await db.getOne<{ status: string; refund_status: string }>(
    'SELECT status, refund_status FROM voice_phone_number_checkouts WHERE id = $1',
    [checkout3Id]
  );
  assert.equal(checkout3Record?.status, 'MANUAL_REFUND_REQUIRED', 'Checkout must transition to MANUAL_REFUND_REQUIRED on failure');

  const phone3Record = await VoiceService.getPhoneNumberById(orgId, phone3Id);
  assert.equal(phone3Record?.billingStatus, 'MANUAL_REFUND_REQUIRED', 'Phone billing status must be MANUAL_REFUND_REQUIRED');
  assert.equal(phone3Record?.actionRequiredReason, 'PROVISIONING_FAILED_MANUAL_REFUND_OR_RETRY_REQUIRED', 'Admin attention flag must be set');
  console.log('  ✓ 3. Creem refund failed response transitions checkout and phone to MANUAL_REFUND_REQUIRED');

  // -------------------------------------------------------------------------
  // Test 4: Provider throws API exception -> checkout marked MANUAL_REFUND_REQUIRED
  // -------------------------------------------------------------------------
  const phone4 = '+14155553004';
  const phone4Id = uuidv4();
  const checkout4Id = `chk_test_exception_${uniqueSuffix}`;
  const txn4Id = `txn_exception_${uniqueSuffix}`;

  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
       billing_status, release_status, is_retained, retention_ends_at, monthly_cost_usd,
       customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'SUSPENDED', 'ACTIVE',
       'SUSPENDED_GRACE_PERIOD', 'RELEASE_IN_PROGRESS', TRUE, CURRENT_TIMESTAMP, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [phone4Id, orgId, phone4]
  );

  await db.execute(
    `INSERT INTO voice_phone_number_checkouts (
       id, organization_id, phone_number, country_code, number_type, provider_cost_usd,
       markup_usd, customer_monthly_cost_usd, setup_cost_usd, currency, pricing_policy_version,
       status, expires_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'US', 'local', 2.00, 1.00, 3.00, 0.00, 'USD', '2026-10-v1',
       'PAID', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [checkout4Id, orgId, phone4]
  );

  CreemBillingService.setCreemSdk({
    transactions: {
      refund: async () => {
        throw new Error('Creem network timeout (504 Gateway Timeout)');
      },
    },
    subscriptions: {
      cancel: async () => ({ status: 'canceled' }),
    },
  });

  await assert.rejects(
    async () => {
      await VoiceService.fulfillPaidPhoneNumberOrder({
        organizationId: orgId,
        phoneNumber: phone4,
        creemSubscriptionId: `sub_test_exception_${uniqueSuffix}`,
        checkoutSessionId: checkout4Id,
        transactionId: txn4Id,
        checkoutType: 'RENEWAL',
        targetPhoneNumberId: phone4Id,
      });
    },
    /Renewal payment was received, but phone number deprovisioning was already in progress/
  );

  const checkout4Record = await db.getOne<{ status: string }>(
    'SELECT status FROM voice_phone_number_checkouts WHERE id = $1',
    [checkout4Id]
  );
  assert.equal(checkout4Record?.status, 'MANUAL_REFUND_REQUIRED', 'Checkout must transition to MANUAL_REFUND_REQUIRED on API exception');
  console.log('  ✓ 4. Creem refund API exception durably records MANUAL_REFUND_REQUIRED');

  // -------------------------------------------------------------------------
  // Test 5: Provider returns 'already refunded' -> idempotent success
  // -------------------------------------------------------------------------
  const phone5 = '+14155553005';
  const phone5Id = uuidv4();
  const checkout5Id = `chk_test_already_ref_${uniqueSuffix}`;
  const txn5Id = `txn_already_ref_${uniqueSuffix}`;

  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
       billing_status, release_status, is_retained, retention_ends_at, monthly_cost_usd,
       customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'SUSPENDED', 'ACTIVE',
       'SUSPENDED_GRACE_PERIOD', 'RELEASE_IN_PROGRESS', TRUE, CURRENT_TIMESTAMP, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [phone5Id, orgId, phone5]
  );

  await db.execute(
    `INSERT INTO voice_phone_number_checkouts (
       id, organization_id, phone_number, country_code, number_type, provider_cost_usd,
       markup_usd, customer_monthly_cost_usd, setup_cost_usd, currency, pricing_policy_version,
       status, expires_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'US', 'local', 2.00, 1.00, 3.00, 0.00, 'USD', '2026-10-v1',
       'PAID', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [checkout5Id, orgId, phone5]
  );

  CreemBillingService.setCreemSdk({
    transactions: {
      refund: async () => {
        throw new Error('This transaction is already refunded in Creem');
      },
    },
    subscriptions: {
      cancel: async () => ({ status: 'canceled' }),
    },
  });

  await assert.rejects(
    async () => {
      await VoiceService.fulfillPaidPhoneNumberOrder({
        organizationId: orgId,
        phoneNumber: phone5,
        creemSubscriptionId: `sub_test_already_${uniqueSuffix}`,
        checkoutSessionId: checkout5Id,
        transactionId: txn5Id,
        checkoutType: 'RENEWAL',
        targetPhoneNumberId: phone5Id,
      });
    },
    /Renewal payment was received, but phone number deprovisioning was already in progress/
  );

  const checkout5Record = await db.getOne<{ status: string }>(
    'SELECT status FROM voice_phone_number_checkouts WHERE id = $1',
    [checkout5Id]
  );
  assert.equal(checkout5Record?.status, 'REFUNDED', 'Already refunded transaction must be acknowledged as REFUNDED');
  console.log('  ✓ 5. "Already refunded" response handled idempotently as REFUNDED');

  // -------------------------------------------------------------------------
  // Test 6: Asynchronous refund.created webhook reconciles REFUND_PENDING to REFUNDED
  // -------------------------------------------------------------------------
  // Reconcile checkout2 (which was left in REFUND_PENDING from Test 2)
  const webhookEventId = `evt_ref_created_${uniqueSuffix}`;
  const refundWebhookRes = await CreemBillingService.handleWebhookEvent({
    id: webhookEventId,
    eventType: 'refund.created',
    object: {
      id: `ref_webhook_${uniqueSuffix}`,
      status: 'succeeded',
      refund_amount: 300,
      checkout: { id: checkout2Id },
      transaction: { id: txn2Id },
    },
  });
  assert.equal(refundWebhookRes.success, true, 'refund.created webhook must be processed successfully');

  const checkout2Reconciled = await db.getOne<{ status: string; refund_id: string }>(
    'SELECT status, refund_id FROM voice_phone_number_checkouts WHERE id = $1',
    [checkout2Id]
  );
  assert.equal(checkout2Reconciled?.status, 'REFUNDED', 'Asynchronous webhook must reconcile checkout to REFUNDED');
  assert.equal(checkout2Reconciled?.refund_id, `ref_webhook_${uniqueSuffix}`, 'Refund ID must be saved from webhook');
  console.log('  ✓ 6. Asynchronous refund.created webhook reconciles REFUND_PENDING checkout to REFUNDED');

  // -------------------------------------------------------------------------
  // Test 7: subscription.paid atomic conditional update rejects renewal on RELEASE_IN_PROGRESS
  // -------------------------------------------------------------------------
  const phone7 = '+14155553007';
  const phone7Id = uuidv4();
  const sub7Id = `sub_atomic_race_${uniqueSuffix}`;
  const txn7Id = `txn_atomic_race_${uniqueSuffix}`;

  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
       billing_status, release_status, creem_subscription_id, is_retained, monthly_cost_usd,
       customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'SUSPENDED', 'ACTIVE',
       'SUSPENDED_GRACE_PERIOD', 'RELEASE_IN_PROGRESS', $4, TRUE, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [phone7Id, orgId, phone7, sub7Id]
  );

  CreemBillingService.setCreemSdk({
    transactions: {
      refund: async () => ({
        id: `ref_sub_race_${uniqueSuffix}`,
        status: 'succeeded',
      }),
    },
    subscriptions: {
      cancel: async () => ({ status: 'canceled' }),
    },
  });

  const subPaidWebhookRes = await CreemBillingService.handleWebhookEvent({
    id: `evt_sub_paid_race_${uniqueSuffix}`,
    eventType: 'subscription.paid',
    object: {
      id: sub7Id,
      status: 'active',
      last_transaction_id: txn7Id,
    },
  });
  assert.equal(subPaidWebhookRes.success, true, 'subscription.paid webhook must be handled safely');

  const phone7Record = await VoiceService.getPhoneNumberById(orgId, phone7Id);
  assert.notEqual(phone7Record?.status, 'ACTIVE', 'Number in RELEASE_IN_PROGRESS must NOT be restored to ACTIVE');
  assert.equal(phone7Record?.billingStatus, 'REFUNDED', 'Phone billing status must be transitioned to REFUNDED');
  console.log('  ✓ 7. subscription.paid atomic conditional update rejects reactivation and triggers cancellation/refund');

  // -------------------------------------------------------------------------
  // Test 8: Duplicate refund.created webhook is acknowledged idempotently
  // -------------------------------------------------------------------------
  const dupRefundWebhookRes = await CreemBillingService.handleWebhookEvent({
    id: webhookEventId, // same ID as Test 6
    eventType: 'refund.created',
    object: {
      id: `ref_webhook_${uniqueSuffix}`,
      status: 'succeeded',
    },
  });
  assert.equal(dupRefundWebhookRes.success, true, 'Duplicate webhook must succeed');
  assert.ok(dupRefundWebhookRes.message.includes('idempotent'), 'Must report idempotency');
  console.log('  ✓ 8. Duplicate refund.created webhook acknowledged idempotently without double-processing');

  console.log('\n=======================================================================');
  console.log('  ALL CREEM REFUND RECONCILIATION TESTS PASSED (8/8)!');
  console.log('=======================================================================\n');
}

if (require.main === module) {
  runCreemRefundReconciliationTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ REFUND RECONCILIATION TEST FAILURE:', err);
      process.exit(1);
    });
}

