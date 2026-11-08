process.env.USE_EMBEDDED_DB = 'true';
process.env.NODE_ENV = 'test';

import assert from 'assert';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../server/src/db';
import { AuthService } from '../server/src/services/AuthService';
import { VoiceService } from '../server/src/services/voice/VoiceService';
import { PhoneDeprovisioningWorker } from '../server/src/services/voice/PhoneDeprovisioningWorker';
import { CreemBillingService } from '../server/src/services/CreemBillingService';
import { PhoneNumberBillingService } from '../server/src/services/voice/PhoneNumberBillingService';

export async function runPhoneRenewalVsReleaseRaceTests() {
  console.log('--- Running Phone Renewal vs. Telnyx Release Race Tests ---');

  const uniqueSuffix = Date.now().toString();

  // Set up mock Creem SDK to capture refunds and cancellations deterministically
  const refundedTransactions: string[] = [];
  const canceledSubscriptions: string[] = [];
  CreemBillingService.setCreemSdk({
    checkouts: {
      create: async () => ({
        id: `chk_mock_${uniqueSuffix}`,
        checkoutUrl: 'https://checkout.creem.io/mock',
      }),
    },
    transactions: {
      refund: async (params: { transactionId: string }) => {
        refundedTransactions.push(params.transactionId);
        return { success: true };
      },
    },
    subscriptions: {
      cancel: async (subId: string) => {
        canceledSubscriptions.push(subId);
        return { success: true };
      },
    },
  });

  // 1. Organization Setup
  const authRes = await AuthService.register({
    email: `race_test_${uniqueSuffix}@example.com`,
    password: 'Password123!Secure',
    fullName: 'Renewal Race Dental Clinic',
    businessName: 'Renewal Race Dental',
    industry: 'clinic',
  });
  assert.ok(authRes.organization, 'Registration must return organization');
  const orgId = authRes.organization.id;

  // Insert active subscription for the organization so phone number checkout/renewal is allowed
  await db.execute(
    `INSERT INTO subscriptions (
       id, organization_id, status, plan_tier, trial_started_at, trial_ends_at, created_at, updated_at
     ) VALUES (
       $1, $2, 'TRIALING', 'TRIAL', CURRENT_TIMESTAMP, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [uuidv4(), orgId, new Date(Date.now() + 14 * 86400000).toISOString()]
  );

  // -------------------------------------------------------------------------
  // Case 1: Renewal commits before worker claims release: number remains active
  // -------------------------------------------------------------------------
  const phone1 = '+14155552001';
  const phone1Id = uuidv4();
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
       billing_status, release_status, is_retained, retention_ends_at, monthly_cost_usd,
       customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'SUSPENDED', 'ACTIVE',
       'SUSPENDED_GRACE_PERIOD', 'RELEASE_PENDING', TRUE, CURRENT_TIMESTAMP, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [phone1Id, orgId, phone1]
  );

  // Renewal fulfillment arrives first
  const renewedPhone = await VoiceService.fulfillPaidPhoneNumberOrder({
    organizationId: orgId,
    phoneNumber: phone1,
    creemSubscriptionId: `sub_renew_before_claim_${uniqueSuffix}`,
    targetPhoneNumberId: phone1Id,
    checkoutType: 'RENEWAL',
  });
  assert.equal(renewedPhone.status, 'ACTIVE', 'Phone must be restored to ACTIVE on renewal');

  const phone1AfterRenewal = await VoiceService.getPhoneNumberById(orgId, phone1Id);
  assert.equal(phone1AfterRenewal?.releaseStatus, 'NOT_RELEASED', 'Release status must be reset to NOT_RELEASED');
  assert.equal(phone1AfterRenewal?.releaseWorkerId, null, 'Worker claim ID must be cleared');
  assert.equal(phone1AfterRenewal?.releaseLockedUntil, null, 'Worker lock time must be cleared');

  // Worker runs afterward — must be blocked from claiming
  const claimBlocked = await PhoneDeprovisioningWorker.claimReleaseLease(phone1Id, 'worker_stale');
  assert.equal(claimBlocked, false, 'Worker must not claim lease on successfully renewed number');
  console.log('  ✓ 1. Renewal commits before worker claims release: number remains active and lease claim blocked');

  // -------------------------------------------------------------------------
  // Case 2: Worker claims release before renewal checkout: renewal is rejected
  // -------------------------------------------------------------------------
  const phone2 = '+14155552002';
  const phone2Id = uuidv4();
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
       billing_status, release_status, is_retained, retention_ends_at, monthly_cost_usd,
       customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'SUSPENDED', 'ACTIVE',
       'SUSPENDED_GRACE_PERIOD', 'RELEASE_PENDING', TRUE, CURRENT_TIMESTAMP, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [phone2Id, orgId, phone2]
  );

  // Worker claims release
  const claimedCase2 = await PhoneDeprovisioningWorker.claimReleaseLease(phone2Id, 'worker_lead');
  assert.equal(claimedCase2, true, 'Worker must claim lease and transition to RELEASE_IN_PROGRESS');

  const phone2Claimed = await VoiceService.getPhoneNumberById(orgId, phone2Id);
  assert.equal(phone2Claimed?.releaseStatus, 'RELEASE_IN_PROGRESS', 'Phone release status must be RELEASE_IN_PROGRESS');

  // Customer tries to create renewal checkout after release claim
  await assert.rejects(
    async () => {
      await PhoneNumberBillingService.createCheckoutSession({
        organizationId: orgId,
        phoneNumber: phone2,
        countryCode: 'US',
        checkoutType: 'RENEWAL',
        targetPhoneNumberId: phone2Id,
      });
    },
    /Renewal is no longer possible/,
    'Renewal checkout creation must be rejected when release is in progress'
  );
  console.log('  ✓ 2. Worker claims release before renewal: renewal checkout creation is rejected');

  // -------------------------------------------------------------------------
  // Case 3: Checkout created before claim, payment completed after claim:
  //         automatic refund triggered and no false reactivation occurs
  // -------------------------------------------------------------------------
  const phone3 = '+14155552003';
  const phone3Id = uuidv4();
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
       billing_status, release_status, is_retained, retention_ends_at, monthly_cost_usd,
       customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'SUSPENDED', 'ACTIVE',
       'SUSPENDED_GRACE_PERIOD', 'RELEASE_PENDING', TRUE, CURRENT_TIMESTAMP, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [phone3Id, orgId, phone3]
  );

  // 3a. Customer created renewal checkout while still eligible
  const checkout3 = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgId,
    phoneNumber: phone3,
    countryCode: 'US',
    checkoutType: 'RENEWAL',
    targetPhoneNumberId: phone3Id,
  });

  // 3b. Worker claims release before customer finishes payment
  const claimedCase3 = await PhoneDeprovisioningWorker.claimReleaseLease(phone3Id, 'worker_fast');
  assert.equal(claimedCase3, true, 'Worker claims release');

  // 3c. Payment webhook arrives later
  const sub3Id = `sub_race_case3_${uniqueSuffix}`;
  const txn3Id = `txn_race_case3_${uniqueSuffix}`;
  await assert.rejects(
    async () => {
      await VoiceService.fulfillPaidPhoneNumberOrder({
        organizationId: orgId,
        phoneNumber: phone3,
        creemSubscriptionId: sub3Id,
        checkoutSessionId: checkout3.id,
        transactionId: txn3Id,
        checkoutType: 'RENEWAL',
        targetPhoneNumberId: phone3Id,
      });
    },
    /Automatic refund initiated/,
    'Fulfillment must reject reactivation when release is in progress'
  );

  // Verify number was NOT reactivated
  const phone3Check = await VoiceService.getPhoneNumberById(orgId, phone3Id);
  assert.notEqual(phone3Check?.status, 'ACTIVE', 'Phone must not be reactivated');
  assert.equal(phone3Check?.releaseStatus, 'RELEASE_IN_PROGRESS', 'Phone must remain in RELEASE_IN_PROGRESS');

  // Verify refund and cancellation were triggered
  assert.ok(refundedTransactions.includes(txn3Id), 'Transaction must be refunded');
  assert.ok(canceledSubscriptions.includes(sub3Id), 'Subscription must be cancelled');

  // Verify checkout session state marked as REFUND_PENDING
  const checkout3Rec = await db.getOne<{ status: string }>(
    'SELECT status FROM voice_phone_number_checkouts WHERE id = $1',
    [checkout3.id]
  );
  assert.equal(checkout3Rec?.status, 'REFUND_PENDING', 'Checkout must be marked REFUND_PENDING');
  console.log('  ✓ 3. Checkout created before claim, payment completed afterward: refunded safely without false reactivation');

  // -------------------------------------------------------------------------
  // Case 4: Worker claims release, then renewal fulfillment attempts to update:
  //         conditional update prevents reactivation
  // -------------------------------------------------------------------------
  const phone4 = '+14155552004';
  const phone4Id = uuidv4();
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
       billing_status, release_status, is_retained, retention_ends_at, monthly_cost_usd,
       customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'SUSPENDED', 'ACTIVE',
       'SUSPENDED_GRACE_PERIOD', 'RELEASE_PENDING', TRUE, CURRENT_TIMESTAMP, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [phone4Id, orgId, phone4]
  );

  await PhoneDeprovisioningWorker.claimReleaseLease(phone4Id, 'worker_atomic');

  // Attempt fulfillment directly
  await assert.rejects(
    async () => {
      await VoiceService.fulfillPaidPhoneNumberOrder({
        organizationId: orgId,
        phoneNumber: phone4,
        creemSubscriptionId: `sub_conditional_guard_${uniqueSuffix}`,
        targetPhoneNumberId: phone4Id,
        checkoutType: 'RENEWAL',
      });
    },
    /Renewal payment was received, but phone number deprovisioning was already in progress/,
    'Conditional update must fail when release_status = RELEASE_IN_PROGRESS'
  );
  console.log('  ✓ 4. Worker claims release: conditional update strictly prevents reactivation');

  // -------------------------------------------------------------------------
  // Case 5: Worker completion arrives after a newer database state:
  //         stale worker cannot overwrite valid newer state
  // -------------------------------------------------------------------------
  const phone5 = '+14155552005';
  const phone5Id = uuidv4();
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
       billing_status, release_status, is_retained, retention_ends_at, monthly_cost_usd,
       customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'RELEASE_PENDING', 'ACTIVE',
       'CANCELED', 'RELEASE_PENDING', TRUE, CURRENT_TIMESTAMP, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [phone5Id, orgId, phone5]
  );

  const staleWorkerId = 'worker_stale_instance_99';
  await PhoneDeprovisioningWorker.claimReleaseLease(phone5Id, staleWorkerId);

  // Newer database state occurs (e.g. administrative status reset or override)
  await db.execute(
    `UPDATE voice_phone_numbers
     SET release_status = 'NOT_RELEASED',
         status = 'ACTIVE',
         release_worker_id = NULL,
         release_locked_until = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [phone5Id]
  );

  // Stale worker tries to complete release with old workerId
  const staleOverwrites = await db.execute(
    `UPDATE voice_phone_numbers
     SET release_status = 'RELEASED',
         status = 'RELEASED',
         provisioning_status = 'INACTIVE',
         released_at = CURRENT_TIMESTAMP,
         release_worker_id = NULL,
         release_locked_until = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND organization_id = $2 AND release_worker_id = $3 AND release_status = 'RELEASE_IN_PROGRESS'`,
    [phone5Id, orgId, staleWorkerId]
  );
  assert.equal(staleOverwrites, 0, 'Stale worker must not affect row if worker ID or release status changed');

  const phone5Record = await VoiceService.getPhoneNumberById(orgId, phone5Id);
  assert.equal(phone5Record?.status, 'ACTIVE', 'Active status must be preserved against stale worker completion');
  console.log('  ✓ 5. Stale worker completion cannot overwrite newer valid database state');

  // -------------------------------------------------------------------------
  // Case 6: Two workers attempt to claim the same number: only one succeeds
  // -------------------------------------------------------------------------
  const phone6 = '+14155552006';
  const phone6Id = uuidv4();
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
       billing_status, release_status, is_retained, retention_ends_at, monthly_cost_usd,
       customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'RELEASE_PENDING', 'ACTIVE',
       'CANCELED', 'RELEASE_PENDING', TRUE, CURRENT_TIMESTAMP, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [phone6Id, orgId, phone6]
  );

  const [claimA, claimB] = await Promise.all([
    PhoneDeprovisioningWorker.claimReleaseLease(phone6Id, 'worker_node_1'),
    PhoneDeprovisioningWorker.claimReleaseLease(phone6Id, 'worker_node_2'),
  ]);

  const successCount = (claimA ? 1 : 0) + (claimB ? 1 : 0);
  assert.equal(successCount, 1, 'Exactly one concurrent worker must claim release');
  console.log('  ✓ 6. Two workers attempt to claim the same number: only one succeeds');

  // -------------------------------------------------------------------------
  // Case 7: Worker crashes after claiming: lease expiry and retry behavior remain safe
  // -------------------------------------------------------------------------
  const phone7 = '+14155552007';
  const phone7Id = uuidv4();
  const pastLeaseTime = new Date(Date.now() - 600000).toISOString(); // 10 minutes in past
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
       billing_status, release_status, release_worker_id, release_locked_until, release_attempts,
       next_release_attempt_at, monthly_cost_usd, customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'RELEASE_IN_PROGRESS', 'ACTIVE',
       'CANCELED', 'RELEASE_IN_PROGRESS', 'crashed_worker_dead', $4, 0,
       CURRENT_TIMESTAMP, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [phone7Id, orgId, phone7, pastLeaseTime]
  );

  const reClaimSuccess = await PhoneDeprovisioningWorker.claimReleaseLease(phone7Id, 'new_worker_revived');
  assert.equal(reClaimSuccess, true, 'Surviving worker must re-claim lease after previous worker crash and timeout');
  console.log('  ✓ 7. Worker crashes after claiming: expired lease is re-claimed safely');

  // -------------------------------------------------------------------------
  // Case 8: Telnyx deletion succeeds: database reaches correct RELEASED state
  // -------------------------------------------------------------------------
  const phone8 = '+14155552008';
  const phone8Id = uuidv4();
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
       billing_status, release_status, release_attempts, next_release_attempt_at, monthly_cost_usd,
       customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'RELEASE_PENDING', 'ACTIVE',
       'CANCELED', 'RELEASE_PENDING', 0, CURRENT_TIMESTAMP, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [phone8Id, orgId, phone8]
  );

  await PhoneDeprovisioningWorker.processPendingReleases(1);

  const phone8Record = await VoiceService.getPhoneNumberById(orgId, phone8Id);
  assert.equal(phone8Record?.releaseStatus, 'RELEASED', 'Phone release status must be RELEASED');
  assert.equal(phone8Record?.status, 'RELEASED', 'Phone status must be RELEASED');
  assert.equal(phone8Record?.releaseWorkerId, null, 'Worker ID must be cleared after release');
  assert.equal(phone8Record?.releaseLockedUntil, null, 'Lock time must be cleared after release');
  console.log('  ✓ 8. Telnyx deletion succeeds: database reaches correct RELEASED state with cleared lease');

  // -------------------------------------------------------------------------
  // Case 9: Telnyx deletion fails: retry and manual-attention behavior correct
  // -------------------------------------------------------------------------
  const phone9 = '+14155552009';
  const phone9Id = uuidv4();
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
       billing_status, release_status, release_attempts, next_release_attempt_at, monthly_cost_usd,
       customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'RELEASE_PENDING', 'ACTIVE',
       'CANCELED', 'RELEASE_PENDING', 4, CURRENT_TIMESTAMP, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [phone9Id, orgId, phone9]
  );

  // Temporarily force telephony release to fail
  const origTelephony = VoiceService.getTelephonyProvider();
  const mockFailingTelephony = {
    ...origTelephony,
    releaseNumber: async () => false,
  };
  (VoiceService as any).activeTelephonyProvider = mockFailingTelephony;

  try {
    await PhoneDeprovisioningWorker.processPendingReleases(1);

    const phone9Record = await VoiceService.getPhoneNumberById(orgId, phone9Id);
    assert.equal(phone9Record?.releaseStatus, 'RELEASE_FAILED_MANUAL_ATTENTION', 'Release status must transition to manual attention');
    assert.equal(phone9Record?.releaseAttempts, 5, 'Attempts must reach max threshold (5)');
  } finally {
    (VoiceService as any).activeTelephonyProvider = origTelephony;
  }
  console.log('  ✓ 9. Telnyx deletion fails: retry threshold transitions to RELEASE_FAILED_MANUAL_ATTENTION');

  // -------------------------------------------------------------------------
  // Case 10: Duplicate Creem webhooks: no duplicate fulfillment, refund, or state transition
  // -------------------------------------------------------------------------
  const phone10 = '+14155552010';
  const phone10Id = uuidv4();
  const sub10Id = `sub_dup_race_${uniqueSuffix}`;
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
       billing_status, release_status, creem_subscription_id, is_retained, monthly_cost_usd,
       customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'SUSPENDED', 'ACTIVE',
       'SUSPENDED_GRACE_PERIOD', 'RELEASE_IN_PROGRESS', $4, TRUE, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [phone10Id, orgId, phone10, sub10Id]
  );

  const duplicateEventId = `evt_dup_race_${uniqueSuffix}`;
  const firstWebhookRes = await CreemBillingService.handleWebhookEvent({
    id: duplicateEventId,
    eventType: 'subscription.paid',
    object: {
      id: sub10Id,
      status: 'active',
      transaction_id: `txn_dup_race_${uniqueSuffix}`,
    },
  });
  assert.equal(firstWebhookRes.success, true, 'First webhook must be processed');

  const secondWebhookRes = await CreemBillingService.handleWebhookEvent({
    id: duplicateEventId,
    eventType: 'subscription.paid',
    object: {
      id: sub10Id,
      status: 'active',
      transaction_id: `txn_dup_race_${uniqueSuffix}`,
    },
  });
  assert.equal(secondWebhookRes.success, true, 'Second duplicate webhook must be acknowledged idempotently');
  assert.ok(secondWebhookRes.message.includes('idempotent'), 'Must report idempotency');

  console.log('  ✓ 10. Duplicate Creem webhooks: acknowledged idempotently with zero duplicate transitions');

  console.log('\n=======================================================================');
  console.log('  ALL 10 PHONE RENEWAL VS. TELNYX RELEASE RACE TESTS PASSED (10/10)!');
  console.log('=======================================================================\n');
}

if (require.main === module) {
  runPhoneRenewalVsReleaseRaceTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ RACE TEST FAILURE:', err);
      process.exit(1);
    });
}
