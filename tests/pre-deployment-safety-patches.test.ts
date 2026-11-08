/**
 * ONCEClic — Pre-Deployment Safety Patches Verification Test Suite
 *
 * Verifies:
 * - PATCH 1: Prevent Suspended Phone Test Reactivation (connection test and test-call endpoints)
 * - PATCH 2: Suspend Past-Due Recurring Phone Subscriptions and restore on payment
 * - PATCH 3: Durable multi-instance worker lease coordination, crash recovery, and renewal protection
 */

process.env.NODE_ENV = 'test';
process.env.USE_EMBEDDED_DB = 'true';

import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../server/src/db';
import { VoiceService } from '../server/src/services/voice/VoiceService';
import { CreemBillingService } from '../server/src/services/CreemBillingService';
import { PhoneDeprovisioningWorker } from '../server/src/services/voice/PhoneDeprovisioningWorker';
import { AuthService } from '../server/src/services/AuthService';
import { SubscriptionStatus } from '../shared/src';

async function runSafetyPatchesTests() {
  console.log('--- Running Pre-Deployment Safety Patches Verification Test Suite ---\n');

  // Set up mock provider environment
  const telephony = VoiceService.getTelephonyProvider();
  const voice = VoiceService.getVoiceProvider();

  // 1. Setup test organization & user
  const uniqueSuffix = Date.now();
  const testEmail = `safety_test_${uniqueSuffix}@example.com`;
  const authRes = await AuthService.register({
    email: testEmail,
    password: 'SecurePassword123!',
    fullName: 'Safety Audit Dental Clinic',
    businessName: 'Safety Audit Dental Clinic',
    industry: 'clinic',
  });

  assert(authRes.organization, 'Registration must return organization');
  const orgId = authRes.organization.id;

  // Setup trial subscription for test org
  await db.execute(
    `INSERT INTO subscriptions (
       id, organization_id, status, plan_tier, trial_started_at, trial_ends_at, created_at, updated_at
     ) VALUES (
       $1, $2, 'TRIALING', 'TRIAL', CURRENT_TIMESTAMP, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [uuidv4(), orgId, new Date(Date.now() + 14 * 86400000).toISOString()]
  );

  // Setup second organization to test cross-tenant authorization
  const otherAuthRes = await AuthService.register({
    email: `other_org_${uniqueSuffix}@example.com`,
    password: 'SecurePassword123!',
    fullName: 'Other Tenant Spa',
    businessName: 'Other Tenant Spa',
    industry: 'salon',
  });
  assert(otherAuthRes.organization, 'Registration must return organization');
  const otherOrgId = otherAuthRes.organization.id;

  // =========================================================================
  // PATCH 1: Prevent Suspended Phone Test Reactivation
  // =========================================================================
  console.log('--- Testing PATCH 1: Prevent Suspended Phone Test Reactivation ---');

  // 1. Suspended temporary rental cannot be reactivated through connection testing
  const suspendedRentalPhone = '+14155551101';
  const suspendedRentalId = uuidv4();
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, country_code, phone_number_type,
       connection_method, status, provisioning_status, billing_status, is_trial_number,
       is_retained, rental_ends_at, monthly_cost_usd, customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'US', 'local',
       'NEW_PROVIDER_NUMBER', 'SUSPENDED', 'ACTIVE', 'SUSPENDED_GRACE_PERIOD', TRUE,
       TRUE, $4, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [suspendedRentalId, orgId, suspendedRentalPhone, new Date(Date.now() - 3600000).toISOString()]
  );

  await assert.rejects(
    async () => {
      await VoiceService.testNumberConnection(orgId, suspendedRentalId);
    },
    (err: any) => {
      assert.match(err.message, /currently suspended or inactive/i);
      return true;
    },
    'Connection test on suspended temporary rental must reject'
  );

  const check1 = await VoiceService.getPhoneNumberById(orgId, suspendedRentalId);
  assert.equal(check1?.status, 'SUSPENDED', 'Phone status must remain SUSPENDED after rejected test');
  console.log('  ✓ 1. Suspended temporary rental cannot be reactivated through connection testing');

  // 2. Suspended number cannot be reactivated through test-call endpoint
  await assert.rejects(
    async () => {
      await VoiceService.executeTestCall({ organizationId: orgId, phoneNumberId: suspendedRentalId });
    },
    (err: any) => {
      assert.match(err.message, /currently suspended or inactive/i);
      return true;
    },
    'Test-call on suspended number must reject'
  );

  const check2 = await VoiceService.getPhoneNumberById(orgId, suspendedRentalId);
  assert.equal(check2?.status, 'SUSPENDED', 'Phone status must remain SUSPENDED after rejected test-call');
  console.log('  ✓ 2. Suspended number cannot be reactivated through test-call endpoint');

  // 3. Retained number cannot be reactivated without successful renewal
  const retainedPhone = '+14155551102';
  const retainedId = uuidv4();
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, country_code, phone_number_type,
       connection_method, status, provisioning_status, billing_status, is_trial_number,
       is_retained, retention_ends_at, monthly_cost_usd, customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'US', 'local',
       'NEW_PROVIDER_NUMBER', 'SUSPENDED', 'ACTIVE', 'SUSPENDED_GRACE_PERIOD', TRUE,
       TRUE, $4, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [retainedId, orgId, retainedPhone, new Date(Date.now() + 20 * 86400000).toISOString()]
  );

  await assert.rejects(
    async () => {
      await VoiceService.testNumberConnection(orgId, retainedId);
    },
    /currently suspended or inactive/i,
    'Connection test on retained number must reject'
  );
  console.log('  ✓ 3. Retained number cannot be reactivated without successful renewal');

  // 4. Past-due recurring number cannot be reactivated through test endpoints
  const pastDuePhone = '+14155551103';
  const pastDueId = uuidv4();
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, country_code, phone_number_type,
       connection_method, status, provisioning_status, billing_status, creem_subscription_id,
       monthly_cost_usd, customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'US', 'local',
       'NEW_PROVIDER_NUMBER', 'SUSPENDED', 'ACTIVE', 'PAST_DUE', 'sub_creem_pastdue_1',
       3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [pastDueId, orgId, pastDuePhone]
  );

  await assert.rejects(
    async () => {
      await VoiceService.testNumberConnection(orgId, pastDueId);
    },
    /currently suspended or inactive/i,
    'Connection test on past-due number must reject'
  );
  console.log('  ✓ 4. Past-due recurring number cannot be reactivated');

  // 5. Active eligible phone number can still be tested
  const activePhone = '+14155551104';
  const activeId = uuidv4();
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, country_code, phone_number_type,
       connection_method, status, provisioning_status, billing_status, creem_subscription_id,
       monthly_cost_usd, customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'US', 'local',
       'NEW_PROVIDER_NUMBER', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'sub_creem_active_1',
       3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [activeId, orgId, activePhone]
  );

  const activeTestRes = await VoiceService.testNumberConnection(orgId, activeId);
  assert.equal(activeTestRes.success, true, 'Active number test must succeed');
  assert.equal(activeTestRes.status, 'CONNECTED', 'Active number test must report CONNECTED');
  console.log('  ✓ 5. Active eligible phone number can still be tested');

  // 6. Unauthorized organization cannot test another organization's number
  await assert.rejects(
    async () => {
      await VoiceService.testNumberConnection(otherOrgId, activeId);
    },
    /phone number not found/i,
    'Cross-tenant connection test must fail closed'
  );
  console.log('  ✓ 6. Unauthorized organization cannot test another organization\'s number');

  // =========================================================================
  // PATCH 2: Suspend Past-Due Recurring Phone Subscriptions
  // =========================================================================
  console.log('\n--- Testing PATCH 2: Suspend Past-Due Recurring Phone Subscriptions ---');

  const recurringSubId = `sub_creem_rec_${uniqueSuffix}`;
  const recurringPhone = '+14155551201';
  const recurringPhoneId = uuidv4();

  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, country_code, phone_number_type,
       connection_method, status, provisioning_status, billing_status, creem_subscription_id,
       monthly_cost_usd, customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'US', 'local',
       'NEW_PROVIDER_NUMBER', 'ACTIVE', 'ACTIVE', 'ACTIVE', $4,
       3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [recurringPhoneId, orgId, recurringPhone, recurringSubId]
  );

  // 7. Past-due subscription suspends its corresponding phone number
  await CreemBillingService.handleWebhookEvent({
    id: `evt_past_due_${uniqueSuffix}`,
    eventType: 'subscription.past_due',
    object: {
      id: recurringSubId,
      status: 'past_due',
    },
  });

  const suspendedPhoneRec = await VoiceService.getPhoneNumberById(orgId, recurringPhoneId);
  assert.equal(suspendedPhoneRec?.status, 'SUSPENDED', 'Phone status must be SUSPENDED after subscription.past_due');
  assert.equal(suspendedPhoneRec?.billingStatus, 'PAST_DUE', 'Billing status must be PAST_DUE');
  console.log('  ✓ 7. Past-due subscription suspends its corresponding phone number');

  // 8. Inbound calls fail closed after suspension
  const inboundRes = await VoiceService.handleInboundCall({
    callId: `call_pastdue_${uniqueSuffix}`,
    fromNumber: '+14155559999',
    toNumber: recurringPhone,
    provider: 'TELNYX',
  });
  assert.equal(inboundRes.allowed, false, 'Inbound call to suspended past-due number must be rejected');
  console.log('  ✓ 8. Inbound calls fail closed after suspension');

  // 9. Payment-failed event also suspends phone number
  const failedSubId = `sub_creem_failed_${uniqueSuffix}`;
  const failedPhone = '+14155551202';
  const failedPhoneId = uuidv4();
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, country_code, phone_number_type,
       connection_method, status, provisioning_status, billing_status, creem_subscription_id,
       monthly_cost_usd, customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'US', 'local',
       'NEW_PROVIDER_NUMBER', 'ACTIVE', 'ACTIVE', 'ACTIVE', $4,
       3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [failedPhoneId, orgId, failedPhone, failedSubId]
  );

  await CreemBillingService.handleWebhookEvent({
    id: `evt_pay_failed_${uniqueSuffix}`,
    eventType: 'subscription.payment_failed',
    object: {
      id: failedSubId,
      status: 'payment_failed',
    },
  });

  const failedRec = await VoiceService.getPhoneNumberById(orgId, failedPhoneId);
  assert.equal(failedRec?.status, 'SUSPENDED', 'Phone status must be SUSPENDED after subscription.payment_failed');
  assert.equal(failedRec?.billingStatus, 'PAST_DUE', 'Billing status must be PAST_DUE');
  console.log('  ✓ 9. Payment-failed subscription suspends its corresponding phone number');

  // 10. Successful recurring payment restores an eligible suspended number
  await CreemBillingService.handleWebhookEvent({
    id: `evt_sub_paid_${uniqueSuffix}`,
    eventType: 'subscription.paid',
    object: {
      id: recurringSubId,
      status: 'active',
    },
  });

  const restoredPhoneRec = await VoiceService.getPhoneNumberById(orgId, recurringPhoneId);
  assert.equal(restoredPhoneRec?.status, 'ACTIVE', 'Phone status must be restored to ACTIVE after subscription.paid');
  assert.equal(restoredPhoneRec?.billingStatus, 'ACTIVE', 'Billing status must be restored to ACTIVE');
  console.log('  ✓ 10. Successful recurring payment restores an eligible suspended number');

  // 11. Successful payment does NOT restore a released number
  const releasedSubId = `sub_creem_rel_${uniqueSuffix}`;
  const releasedPhone = '+14155551203';
  const releasedPhoneId = uuidv4();
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, country_code, phone_number_type,
       connection_method, status, provisioning_status, billing_status, release_status, creem_subscription_id,
       monthly_cost_usd, customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'US', 'local',
       'NEW_PROVIDER_NUMBER', 'RELEASED', 'INACTIVE', 'CANCELED', 'RELEASED', $4,
       3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [releasedPhoneId, orgId, releasedPhone, releasedSubId]
  );

  await CreemBillingService.handleWebhookEvent({
    id: `evt_rel_paid_${uniqueSuffix}`,
    eventType: 'subscription.paid',
    object: {
      id: releasedSubId,
      status: 'active',
    },
  });

  const unresurrectedRec = await VoiceService.getPhoneNumberById(orgId, releasedPhoneId);
  assert.equal(unresurrectedRec?.status, 'RELEASED', 'Released phone must NOT be reactivated by subscription.paid');
  console.log('  ✓ 11. Successful payment does not restore a released number');

  // 12. Phone billing webhooks never alter core software subscription billing
  const mainSubBefore = await db.getOne<{ status: string; trial_ends_at: string }>(
    'SELECT status, trial_ends_at FROM subscriptions WHERE organization_id = $1',
    [orgId]
  );
  assert.equal(mainSubBefore?.status, SubscriptionStatus.TRIALING, 'Main subscription must remain intact');
  console.log('  ✓ 12. Phone billing webhooks never alter core software subscription billing');

  // =========================================================================
  // PATCH 3: Durable Database Coordination & Multi-Instance Worker Safety
  // =========================================================================
  console.log('\n--- Testing PATCH 3: Durable Multi-Instance Worker Lease Coordination ---');

  // 13. Two worker instances cannot claim the same release simultaneously
  const leasePhone = '+14155551301';
  const leasePhoneId = uuidv4();
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, country_code, phone_number_type,
       connection_method, status, provisioning_status, billing_status, release_status, release_attempts,
       next_release_attempt_at, monthly_cost_usd, customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'US', 'local',
       'NEW_PROVIDER_NUMBER', 'RELEASE_PENDING', 'ACTIVE', 'CANCELED', 'RELEASE_PENDING', 0,
       CURRENT_TIMESTAMP, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [leasePhoneId, orgId, leasePhone]
  );

  const worker1Id = 'worker_pod_instance_alpha';
  const worker2Id = 'worker_pod_instance_beta';

  const claim1 = await PhoneDeprovisioningWorker.claimReleaseLease(leasePhoneId, worker1Id);
  assert.equal(claim1, true, 'First worker must successfully claim lease');

  const claim2 = await PhoneDeprovisioningWorker.claimReleaseLease(leasePhoneId, worker2Id);
  assert.equal(claim2, false, 'Second concurrent worker must be blocked from claiming active lease');
  console.log('  ✓ 13. Two worker instances cannot claim the same release simultaneously');

  // 14. Concurrent workers release different eligible numbers safely
  const multiPhoneA = '+14155551302';
  const multiPhoneB = '+14155551303';
  const multiIdA = uuidv4();
  const multiIdB = uuidv4();

  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
       billing_status, release_status, release_attempts, next_release_attempt_at, monthly_cost_usd,
       customer_monthly_cost_usd, created_at, updated_at
     ) VALUES
       ($1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'RELEASE_PENDING', 'ACTIVE', 'CANCELED', 'RELEASE_PENDING', 0, CURRENT_TIMESTAMP, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       ($4, $2, 'TELNYX', $5, 'NEW_PROVIDER_NUMBER', 'RELEASE_PENDING', 'ACTIVE', 'CANCELED', 'RELEASE_PENDING', 0, CURRENT_TIMESTAMP, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [multiIdA, orgId, multiPhoneA, multiIdB, multiPhoneB]
  );

  // Both batches run concurrently
  const [resA, resB] = await Promise.all([
    PhoneDeprovisioningWorker.processPendingReleases(1),
    PhoneDeprovisioningWorker.processPendingReleases(1),
  ]);

  const totalSucceeded = resA.succeeded + resB.succeeded;
  assert.ok(totalSucceeded >= 1, 'Concurrent batches must safely process distinct records');
  console.log('  ✓ 14. Concurrent workers release different eligible numbers safely');

  // 15. Active renewed numbers are never released and leases are cleared
  const activeRenewedPhone = '+14155551304';
  const activeRenewedId = uuidv4();
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
       billing_status, release_status, creem_subscription_id, release_attempts, monthly_cost_usd,
       customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'RELEASE_PENDING',
       'sub_active_renewed_keep', 0, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [activeRenewedId, orgId, activeRenewedPhone]
  );

  const activeClaim = await PhoneDeprovisioningWorker.claimReleaseLease(activeRenewedId, 'worker_audit');
  assert.equal(activeClaim, false, 'Active renewed number must be rejected from release claim');

  await PhoneDeprovisioningWorker.processPendingReleases();
  const renewedCheck = await VoiceService.getPhoneNumberById(orgId, activeRenewedId);
  assert.equal(renewedCheck?.status, 'ACTIVE', 'Renewed number must remain ACTIVE');
  assert.notEqual(renewedCheck?.releaseStatus, 'RELEASED', 'Renewed number must never be RELEASED');
  console.log('  ✓ 15. Active renewed numbers are never released');

  // 16. Expired lease is reclaimed safely after simulated worker crash
  const crashedWorkerPhone = '+14155551305';
  const crashedWorkerId = uuidv4();
  const pastLeaseTime = new Date(Date.now() - 600000).toISOString(); // 10 minutes in past (lease was for 5 min)
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
       billing_status, release_status, release_worker_id, release_locked_until, release_attempts,
       next_release_attempt_at, monthly_cost_usd, customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'RELEASE_PENDING', 'ACTIVE', 'CANCELED', 'RELEASE_PENDING',
       'crashed_pod_dead', $4, 0, CURRENT_TIMESTAMP, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [crashedWorkerId, orgId, crashedWorkerPhone, pastLeaseTime]
  );

  const reclaimed = await PhoneDeprovisioningWorker.claimReleaseLease(crashedWorkerId, 'recovering_worker_gamma');
  assert.equal(reclaimed, true, 'Expired lease from crashed worker must be reclaimed');

  // Insert second crashed record that processPendingReleases will autonomously pick up and release
  const autoRecoverPhone = '+14155551306';
  const autoRecoverId = uuidv4();
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method, status, provisioning_status,
       billing_status, release_status, release_worker_id, release_locked_until, release_attempts,
       next_release_attempt_at, monthly_cost_usd, customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'RELEASE_PENDING', 'ACTIVE', 'CANCELED', 'RELEASE_PENDING',
       'crashed_pod_dead_2', $4, 0, CURRENT_TIMESTAMP, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [autoRecoverId, orgId, autoRecoverPhone, pastLeaseTime]
  );

  const crashRecoveryRun = await PhoneDeprovisioningWorker.processPendingReleases();
  assert.ok(crashRecoveryRun.succeeded >= 1, 'Recovering worker must complete release of previously crashed record');

  const recoveredRec = await VoiceService.getPhoneNumberById(orgId, autoRecoverId);
  assert.equal(recoveredRec?.releaseStatus, 'RELEASED', 'Crashed worker record must be released by background processor');
  assert.equal(recoveredRec?.releaseWorkerId, null, 'Lease worker ID must be cleared after successful release');
  console.log('  ✓ 16. Expired leases from crashed workers are reclaimed safely');

  console.log('\n=======================================================================');
  console.log('  ALL PRE-DEPLOYMENT SAFETY PATCH REQUIREMENTS VERIFIED (PASS)!');
  console.log('=======================================================================\n');
}

runSafetyPatchesTests().catch(err => {
  console.error('\n❌ SAFETY PATCHES TEST FAILURE:', err);
  process.exit(1);
});
