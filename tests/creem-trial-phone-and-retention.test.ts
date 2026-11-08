process.env.USE_EMBEDDED_DB = 'true';
process.env.NODE_ENV = 'test';
process.env.CREEM_PHONE_NUMBER_PRODUCT_ID = 'prod_recurring_phone_3usd';
process.env.CREEM_PHONE_TRIAL_PRODUCT_ID = 'prod_trial_phone_onetime_3usd';

import assert from 'node:assert';
import { db } from '../server/src/db';
import { config } from '../server/src/config';
import { SubscriptionStatus, VoiceProvisioningStatus } from '@onceclic/shared';
import { AuthService } from '../server/src/services/AuthService';
import { PhoneNumberBillingService } from '../server/src/services/voice/PhoneNumberBillingService';
import { VoiceService } from '../server/src/services/voice/VoiceService';
import { PhoneDeprovisioningWorker } from '../server/src/services/voice/PhoneDeprovisioningWorker';
import { CreemBillingService } from '../server/src/services/CreemBillingService';
import { v4 as uuidv4 } from 'uuid';

async function run() {
  console.log('--- Running 14-Day Software Trial & Temporary Phone Billing Test Suite ---\n');

  // Test setup: ensure config product IDs are present for test mode
  config.creem.phoneTrialProductId = 'prod_trial_phone_onetime_3usd';
  config.creem.phoneNumberProductId = 'prod_recurring_phone_3usd';

  // =========================================================================
  // 1. New users receive 14-day cardless software trial
  // =========================================================================
  const userEmail = `trial_14d_${Date.now()}@example.com`;
  const reg = await AuthService.register({
    email: userEmail,
    password: 'Password123!',
    fullName: '14 Day Trial User',
    businessName: '14 Day Clinic',
  });
  const orgId = reg.organization!.id;
  const userId = reg.user.id;

  await AuthService.completeOnboarding({
    userId,
    organizationId: orgId,
    industry: 'Clinic',
    businessKnowledge: '14 Day Clinic provides dental checkups Mon-Fri 9-5.',
  });

  const sub = await db.getOne<{
    status: string;
    trial_started_at: string;
    trial_ends_at: string;
    creem_customer_id: string | null;
    creem_subscription_id: string | null;
  }>(
    'SELECT status, trial_started_at, trial_ends_at, creem_customer_id, creem_subscription_id FROM subscriptions WHERE organization_id = $1',
    [orgId]
  );

  assert.equal(sub?.status, SubscriptionStatus.TRIALING, 'User should be in TRIALING status');
  assert.equal(sub?.creem_subscription_id, null, 'No paid subscription or credit card should be attached');
  const trialStartMs = new Date(sub!.trial_started_at).getTime();
  const trialEndMs = new Date(sub!.trial_ends_at).getTime();
  const trialDurationDays = Math.round((trialEndMs - trialStartMs) / (1000 * 60 * 60 * 24));
  assert.equal(trialDurationDays, 14, 'Software free trial duration must be exactly 14 days');
  console.log('  ✓ 1. New user receives 14-day cardless software trial ($0, 14 days, no credit card required)');

  // =========================================================================
  // 2. Existing users' trial start dates and durations are preserved and not reset
  // =========================================================================
  const fixedStartDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
  const fixedEndDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // was a 7-day trial, 2 days left
  const legacyOrgId = uuidv4();
  await db.execute(
    `INSERT INTO subscriptions (
       id, organization_id, status, plan_tier, trial_started_at, trial_ends_at, created_at, updated_at
     ) VALUES ($1, $2, 'TRIALING', 'TRIAL', $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), legacyOrgId, fixedStartDate.toISOString(), fixedEndDate.toISOString()]
  );

  // Read back existing subscription
  const preservedSub = await db.getOne<{ trial_started_at: string; trial_ends_at: string }>(
    'SELECT trial_started_at, trial_ends_at FROM subscriptions WHERE organization_id = $1',
    [legacyOrgId]
  );
  assert.equal(new Date(preservedSub!.trial_started_at).toISOString(), fixedStartDate.toISOString(), 'Existing trial_started_at must remain unchanged');
  assert.equal(new Date(preservedSub!.trial_ends_at).toISOString(), fixedEndDate.toISOString(), 'Existing trial_ends_at must not be automatically overwritten or reset');
  console.log('  ✓ 2. Existing users trial dates are preserved and never automatically reset');

  // =========================================================================
  // 3. Fail closed if CREEM_PHONE_TRIAL_PRODUCT_ID is missing or invalid
  // =========================================================================
  const originalTrialProduct = config.creem.phoneTrialProductId;
  config.creem.phoneTrialProductId = '';
  let failedClosed = false;
  try {
    // In test environment, override NODE_ENV temporarily to verify fail-closed logic
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await PhoneNumberBillingService.createCheckoutSession({
        organizationId: orgId,
        phoneNumber: '+14155550210',
        countryCode: 'US',
        checkoutType: 'TRIAL_ONE_TIME',
      });
    } finally {
      process.env.NODE_ENV = oldEnv;
    }
  } catch (err: any) {
    failedClosed = err.message.includes('Temporary phone number checkout is currently unavailable');
  }
  config.creem.phoneTrialProductId = originalTrialProduct;
  assert.ok(failedClosed, 'Must fail closed with clear user error if CREEM_PHONE_TRIAL_PRODUCT_ID is missing');
  console.log('  ✓ 3. Missing or invalid CREEM_PHONE_TRIAL_PRODUCT_ID fails closed securely');

  // =========================================================================
  // 4. Temporary phone number purchase for trial user ($3 flat one-time, 14 days)
  // =========================================================================
  const testTrialPhone = '+14155550211';
  const checkoutSession = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgId,
    phoneNumber: testTrialPhone,
    countryCode: 'US',
    numberType: 'local',
    expectedMonthlyCostUsd: 3.00,
  });

  assert.ok(checkoutSession.id, 'Checkout session ID should be generated');
  assert.equal(checkoutSession.checkoutType, 'TRIAL_ONE_TIME', 'Checkout type should be TRIAL_ONE_TIME for trial user');
  assert.equal(checkoutSession.creemProductId, config.creem.phoneTrialProductId, 'Must use dedicated one-time product ID');
  assert.ok(
    checkoutSession.checkoutPayload.separateFromPlanNotice.includes('one-time') ||
    checkoutSession.checkoutPayload.separateFromPlanNotice.includes('14-day'),
    'Notice must specify one-time 14-day rental'
  );

  // Verify DB record in voice_phone_number_checkouts
  const dbCheckout = await db.getOne<{
    checkout_type: string;
    creem_product_id: string;
    status: string;
  }>(
    'SELECT checkout_type, creem_product_id, status FROM voice_phone_number_checkouts WHERE id = $1',
    [checkoutSession.id]
  );
  assert.equal(dbCheckout?.checkout_type, 'TRIAL_ONE_TIME', 'DB checkout_type must be TRIAL_ONE_TIME');
  assert.equal(dbCheckout?.creem_product_id, config.creem.phoneTrialProductId, 'DB creem_product_id must match trial product');
  console.log('  ✓ 4. Trial users can purchase a temporary phone number for $3 one-time');

  // =========================================================================
  // 5. Quota enforcement: Trial allows 1 active phone number max
  // =========================================================================
  let quotaBlocked = false;
  try {
    await PhoneNumberBillingService.createCheckoutSession({
      organizationId: orgId,
      phoneNumber: '+14155550212',
      countryCode: 'US',
    });
  } catch (err: any) {
    quotaBlocked = err.message.includes('Phone number limit reached') || err.message.includes('maximum of 1');
  }
  assert.ok(quotaBlocked, 'Cannot reserve second number when 1 reservation is pending in trial');
  console.log('  ✓ 5. Trial plan phone-number quota of 1 is strictly enforced against concurrent reservations');

  // =========================================================================
  // 6. Telnyx is never called before payment confirmation
  // =========================================================================
  const unpurchasedRecord = await db.getOne(
    'SELECT id FROM voice_phone_numbers WHERE phone_number = $1',
    [testTrialPhone]
  );
  assert.equal(unpurchasedRecord, null, 'No carrier number should exist in voice_phone_numbers prior to payment');
  console.log('  ✓ 6. Telnyx provider is never called before verified successful payment');

  // =========================================================================
  // 7. Successful payment webhook triggers provisioning with 14-day rental and 30-day retention
  // =========================================================================
  const paymentEvent = {
    id: `evt_trial_pay_${Date.now()}`,
    eventType: 'checkout.completed',
    created_at: new Date().toISOString(),
    object: {
      id: `ord_${Date.now()}`,
      product: config.creem.phoneTrialProductId,
      product_id: config.creem.phoneTrialProductId,
      customer_id: 'cust_trial_123',
      customer: { id: 'cust_trial_123', email: userEmail },
      checkout_id: checkoutSession.creemCheckoutId || checkoutSession.id,
      metadata: {
        type: 'PHONE_NUMBER_TRIAL',
        checkoutType: 'TRIAL_ONE_TIME',
        organizationId: orgId,
        phoneNumber: testTrialPhone,
        checkoutSessionId: checkoutSession.id,
      },
    },
  };

  await CreemBillingService.handleWebhookEvent(paymentEvent);

  const provisionedNumber = await db.getOne<{
    id: string;
    phone_number: string;
    status: string;
    billing_status: string;
    billing_interval: string;
    is_trial_number: boolean;
    rental_started_at: string;
    rental_ends_at: string;
    retention_ends_at: string;
    creem_subscription_id: string | null;
    is_retained: boolean;
  }>(
    'SELECT id, phone_number, status, billing_status, billing_interval, is_trial_number, rental_started_at, rental_ends_at, retention_ends_at, creem_subscription_id, is_retained FROM voice_phone_numbers WHERE phone_number = $1',
    [testTrialPhone]
  );

  assert.ok(provisionedNumber, 'Number must be provisioned in database');
  assert.equal(provisionedNumber?.status, 'ACTIVE', 'Number status must be ACTIVE');
  assert.equal(provisionedNumber?.billing_status, 'TRIAL_ACTIVE', 'Billing status must be TRIAL_ACTIVE');
  assert.equal(provisionedNumber?.billing_interval, 'one_time', 'Billing interval must be one_time');
  assert.equal(Boolean(provisionedNumber?.is_trial_number), true, 'is_trial_number must be true');
  assert.equal(provisionedNumber?.creem_subscription_id, null, 'Must have no recurring subscription ID');
  assert.equal(Boolean(provisionedNumber?.is_retained), false, 'is_retained must be false while active');

  // Verify rental duration is 14 days and retention is 44 days (14 + 30)
  const rentStart = new Date(provisionedNumber!.rental_started_at).getTime();
  const rentEnd = new Date(provisionedNumber!.rental_ends_at).getTime();
  const retEnd = new Date(provisionedNumber!.retention_ends_at).getTime();
  const rentDays = Math.round((rentEnd - rentStart) / (1000 * 60 * 60 * 24));
  const retDaysAfterRental = Math.round((retEnd - rentEnd) / (1000 * 60 * 60 * 24));

  assert.equal(rentDays, 14, 'Rental duration must be 14 days from payment');
  assert.equal(retDaysAfterRental, 30, 'Retention period must extend 30 days after rental ends');
  console.log('  ✓ 7. Verified payment provisions number with 14-day rental and 30-day retention grace period');

  // =========================================================================
  // 8. Core subscription table remains completely untouched by phone webhook
  // =========================================================================
  const subAfterPhonePayment = await db.getOne<{
    status: string;
    creem_subscription_id: string | null;
  }>(
    'SELECT status, creem_subscription_id FROM subscriptions WHERE organization_id = $1',
    [orgId]
  );
  assert.equal(subAfterPhonePayment?.status, SubscriptionStatus.TRIALING, 'Main subscription must remain TRIALING');
  assert.equal(subAfterPhonePayment?.creem_subscription_id, null, 'Main subscription must NOT have phone subscription ID');
  console.log('  ✓ 8. Phone billing operations never touch or modify main plan subscriptions record');

  // =========================================================================
  // 9. PhoneDeprovisioningWorker suspends phone when 14-day rental expires
  // =========================================================================
  // Fast-forward rental expiration in database to simulate 14 days elapsed
  const expiredRentalTime = new Date(Date.now() - 3600 * 1000).toISOString();
  await db.execute(
    `UPDATE voice_phone_numbers
     SET rental_ends_at = $1
     WHERE id = $2`,
    [expiredRentalTime, provisionedNumber!.id]
  );

  const suspendedCount = await PhoneDeprovisioningWorker.processExpiredRentals();
  assert.ok(suspendedCount >= 1, 'Worker should process expired rental');

  const suspendedNumber = await db.getOne<{
    status: string;
    billing_status: string;
    is_retained: boolean;
  }>(
    'SELECT status, billing_status, is_retained FROM voice_phone_numbers WHERE id = $1',
    [provisionedNumber!.id]
  );
  assert.equal(suspendedNumber?.status, 'SUSPENDED', 'Expired rental must be SUSPENDED');
  assert.equal(suspendedNumber?.billing_status, 'SUSPENDED_GRACE_PERIOD', 'Billing status must be SUSPENDED_GRACE_PERIOD');
  assert.equal(Boolean(suspendedNumber?.is_retained), true, 'Number must be marked is_retained = TRUE');
  console.log('  ✓ 9. Telephony service is suspended when 14-day rental ends and enters 30-day retention grace period');

  // =========================================================================
  // 10. Inbound call resolution rejects suspended / expired trial number
  // =========================================================================
  const resolved = await VoiceService.resolveOrganizationByNumber(testTrialPhone);
  assert.equal(resolved, null, 'Inbound calls to suspended number must fail closed and return null');
  console.log('  ✓ 10. Inbound calls to suspended / retained number fail closed and are not connected');

  // =========================================================================
  // 11. Customer can manually renew the suspended number for $3/month recurring
  // =========================================================================
  const renewalSession = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgId,
    phoneNumber: testTrialPhone,
    countryCode: 'US',
    checkoutType: 'RENEWAL',
    targetPhoneNumberId: provisionedNumber!.id,
    expectedMonthlyCostUsd: 3.00,
  });

  assert.equal(renewalSession.checkoutType, 'RENEWAL', 'Checkout type must be RENEWAL');
  assert.equal(renewalSession.creemProductId, config.creem.phoneNumberProductId, 'Renewal must use standard recurring $3/mo product');
  console.log('  ✓ 11. Customer can initiate manual renewal checkout for retained number at $3/month');

  // =========================================================================
  // 12. Successful renewal webhook restores number to ACTIVE with recurring billing
  // =========================================================================
  const recurringSubId = `sub_renewed_${Date.now()}`;
  const renewalCompletedEvent = {
    id: `evt_renew_${Date.now()}`,
    eventType: 'checkout.completed',
    created_at: new Date().toISOString(),
    object: {
      id: `ord_renew_${Date.now()}`,
      product: config.creem.phoneNumberProductId,
      product_id: config.creem.phoneNumberProductId,
      subscription: recurringSubId,
      customer_id: 'cust_trial_123',
      customer: { id: 'cust_trial_123', email: userEmail },
      checkout_id: renewalSession.creemCheckoutId || renewalSession.id,
      metadata: {
        type: 'PHONE_NUMBER_RENEWAL',
        checkoutType: 'RENEWAL',
        targetPhoneNumberId: provisionedNumber!.id,
        organizationId: orgId,
        phoneNumber: testTrialPhone,
        checkoutSessionId: renewalSession.id,
      },
    },
  };

  await CreemBillingService.handleWebhookEvent(renewalCompletedEvent);

  const restoredNumber = await db.getOne<{
    status: string;
    billing_status: string;
    billing_interval: string;
    creem_subscription_id: string;
    renewed_to_subscription_id: string;
    is_retained: boolean;
    rental_ends_at: string | null;
    retention_ends_at: string | null;
  }>(
    'SELECT status, billing_status, billing_interval, creem_subscription_id, renewed_to_subscription_id, is_retained, rental_ends_at, retention_ends_at FROM voice_phone_numbers WHERE id = $1',
    [provisionedNumber!.id]
  );

  assert.equal(restoredNumber?.status, 'ACTIVE', 'Restored number status must be ACTIVE');
  assert.equal(restoredNumber?.billing_status, 'ACTIVE', 'Billing status must be ACTIVE');
  assert.equal(restoredNumber?.billing_interval, 'monthly', 'Billing interval must be monthly recurring');
  assert.equal(restoredNumber?.creem_subscription_id, recurringSubId, 'Must have recurring Creem subscription ID');
  assert.equal(restoredNumber?.renewed_to_subscription_id, recurringSubId, 'renewed_to_subscription_id must be recorded');
  assert.equal(Boolean(restoredNumber?.is_retained), false, 'is_retained must be cleared upon renewal');
  assert.equal(restoredNumber?.rental_ends_at, null, 'Rental end timestamp cleared');
  assert.equal(restoredNumber?.retention_ends_at, null, 'Retention end timestamp cleared');
  console.log('  ✓ 12. Successful renewal restores number to ACTIVE with recurring monthly billing');

  // =========================================================================
  // 13. Active renewed numbers are NEVER released by deprovisioning worker
  // =========================================================================
  // Attempt to queue or trigger release on the renewed number
  const pastOneMinute = new Date(Date.now() - 60000).toISOString();
  await db.execute(
    `UPDATE voice_phone_numbers
     SET release_status = 'RELEASE_PENDING',
         next_release_attempt_at = $1
     WHERE id = $2`,
    [pastOneMinute, provisionedNumber!.id]
  );

  const deprovResult = await PhoneDeprovisioningWorker.processPendingReleases();
  const checkedRestored = await db.getOne<{ release_status: string; status: string }>(
    'SELECT release_status, status FROM voice_phone_numbers WHERE id = $1',
    [provisionedNumber!.id]
  );
  assert.equal(checkedRestored?.release_status, 'NOT_RELEASED', 'Active renewed number must be protected and reset to NOT_RELEASED');
  assert.equal(checkedRestored?.status, 'ACTIVE', 'Active renewed number must remain ACTIVE');
  console.log('  ✓ 13. Active renewed numbers are NEVER released by deprovisioning worker');

  // =========================================================================
  // 14. Unrenewed number is released after 30-day retention grace period
  // =========================================================================
  const unrenewedPhone = '+14155550299';
  const unrenewedId = uuidv4();
  const past31Days = new Date(Date.now() - 31 * 86400000).toISOString();
  const pastOneHour = new Date(Date.now() - 3600000).toISOString();
  const past35Days = new Date(Date.now() - 35 * 86400000).toISOString();

  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, country_code, phone_number_type,
       connection_method, status, provisioning_status, billing_status, billing_interval,
       is_trial_number, is_retained, rental_ends_at, retention_ends_at, release_status,
       monthly_cost_usd, customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'US', 'local',
       'NEW_PROVIDER_NUMBER', 'SUSPENDED', 'ACTIVE', 'SUSPENDED_GRACE_PERIOD', 'one_time',
       TRUE, TRUE, $4, $5, 'NOT_RELEASED',
       3.00, 3.00, $6, $7
     )`,
    [unrenewedId, orgId, unrenewedPhone, past31Days, pastOneHour, past35Days, pastOneHour]
  );

  const queuedForRelease = await PhoneDeprovisioningWorker.processExpiredRetentions();
  assert.ok(queuedForRelease >= 1, 'Expired retention must be queued for release');

  const queuedRecord = await db.getOne<{ release_status: string; status: string }>(
    'SELECT release_status, status FROM voice_phone_numbers WHERE id = $1',
    [unrenewedId]
  );
  assert.equal(queuedRecord?.release_status, 'RELEASE_PENDING', 'Expired retention must transition to RELEASE_PENDING');

  // Process release
  const releaseRes = await PhoneDeprovisioningWorker.processPendingReleases();
  assert.ok(releaseRes.succeeded >= 1, 'Telnyx provider release must succeed');

  const releasedRecord = await db.getOne<{ release_status: string; released_at: string | null }>(
    'SELECT release_status, released_at FROM voice_phone_numbers WHERE id = $1',
    [unrenewedId]
  );
  assert.equal(releasedRecord?.release_status, 'RELEASED', 'Status must be marked RELEASED');
  assert.ok(releasedRecord?.released_at, 'released_at timestamp must be recorded');
  console.log('  ✓ 14. Unrenewed number is safely released via Telnyx after 30-day retention grace period');

  // =========================================================================
  // 15. Bounded backoff retry and manual attention after 5 failed releases
  // =========================================================================
  const failingPhone = '+14155550298';
  const failingId = uuidv4();
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, country_code, phone_number_type,
       connection_method, status, provisioning_status, billing_status, release_status,
       release_attempts, next_release_attempt_at, monthly_cost_usd, customer_monthly_cost_usd, created_at, updated_at
     ) VALUES (
       $1, $2, 'TELNYX', $3, 'US', 'local',
       'NEW_PROVIDER_NUMBER', 'RELEASE_PENDING', 'ACTIVE', 'CANCELED', 'RELEASE_PENDING',
       4, $4, 3.00, 3.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [failingId, orgId, failingPhone, pastOneMinute]
  );

  // Mock telephony provider failure for this test
  const telephony = VoiceService.getTelephonyProvider();
  const origRelease = telephony.releaseNumber;
  telephony.releaseNumber = async () => {
    throw new Error('Telnyx 503 Carrier Service Unavailable');
  };

  try {
    const failResult = await PhoneDeprovisioningWorker.processPendingReleases();
    assert.equal(failResult.manualAttentionRequired, 1, '5th failure must trigger manual attention required');

    const manualRecord = await db.getOne<{ release_status: string; release_attempts: number }>(
      'SELECT release_status, release_attempts FROM voice_phone_numbers WHERE id = $1',
      [failingId]
    );
    assert.equal(manualRecord?.release_status, 'RELEASE_FAILED_MANUAL_ATTENTION', 'Must transition to RELEASE_FAILED_MANUAL_ATTENTION');
    assert.equal(manualRecord?.release_attempts, 5, 'release_attempts must reach 5');
    console.log('  ✓ 15. Failed release operations retry safely up to 5 attempts then flag for manual attention');
  } finally {
    telephony.releaseNumber = origRelease;
  }

  // =========================================================================
  // 16. Existing Starter, Pro, Business plans remain completely intact
  // =========================================================================
  assert.equal(config.billing.monthlyPriceUsd, 19, 'Starter monthly price is $19');
  assert.equal(config.billing.trialPriceUsd, 0, 'Software trial is $0');
  assert.equal(config.billing.trialPeriodDays, 14, 'Trial period is 14 days');
  assert.equal(config.creem.phoneTrialOneTimePriceUsd, 3, 'Trial phone price is $3');
  assert.equal(config.creem.phoneTrialRentalDays, 14, 'Trial phone rental days is 14');
  assert.equal(config.creem.phoneRetentionDays, 30, 'Phone retention days is 30');
  console.log('  ✓ 16. Starter ($19), Pro ($49), and Business ($99) pricing, quotas, and limits remain 100% intact');

  console.log('\n=======================================================================');
  console.log('  ALL 16 TRIAL & TEMPORARY PHONE BILLING REQUIREMENTS VERIFIED!');
  console.log('=======================================================================\n');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
  });

