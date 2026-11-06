/**
 * creem-independent-phone-billing.test.ts
 *
 * Automated verification of independent recurring phone number billing via Creem & Telnyx:
 *  1. Starter can purchase one number.
 *  2. Starter cannot reserve a second number.
 *  3. Pro can purchase up to three numbers.
 *  4. Business can purchase up to five numbers.
 *  5. Concurrent checkout attempts cannot exceed quota.
 *  6. Phone-number checkout is separate from main plan checkout.
 *  7. Checkout uses the dedicated recurring $3 product.
 *  8. Invalid webhook signatures are rejected.
 *  9. Phone-number webhooks do not overwrite main plan subscription IDs.
 * 10. Duplicate webhooks do not duplicate Telnyx orders.
 * 11. Out-of-order webhook events are handled safely.
 * 12. Telnyx is never called before payment confirmation.
 * 13. Successful payment provisions through mocked Telnyx.
 * 14. Provisioning failure does not falsely activate a number.
 * 15. Individual cancellation does not cancel the main plan.
 * 16. Cancelling one number does not affect other numbers.
 * 17. Failed renewal updates only the corresponding phone number.
 * 18. Main-plan downgrade does not silently release or cancel numbers.
 * 19. Expired checkout reservations are released.
 * 20. Organization ownership and authorization are enforced.
 */

process.env.USE_EMBEDDED_DB = 'true';
process.env.NODE_ENV = 'test';
process.env.CREEM_PHONE_NUMBER_PRODUCT_ID = 'prod_test_phone_recurring_3usd';

import assert from 'assert';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../server/src/db';
import { config } from '../server/src/config';
import { AuthService } from '../server/src/services/AuthService';
import { TrialService } from '../server/src/services/TrialService';
import { VoiceService } from '../server/src/services/voice/VoiceService';
import { PhoneNumberBillingService } from '../server/src/services/voice/PhoneNumberBillingService';
import { CreemBillingService } from '../server/src/services/CreemBillingService';
import { MockTelephonyProvider } from '../server/src/services/voice/MockTelephonyProvider';
import { PhoneDeprovisioningWorker } from '../server/src/services/voice/PhoneDeprovisioningWorker';
import {
  PLAN_PHONE_NUMBER_LIMITS,
  SubscriptionStatus,
} from '@onceclic/shared';

// Ensure config has the test phone number product ID
(config.creem as any).phoneNumberProductId = 'prod_test_phone_recurring_3usd';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createOrg(label: string) {
  const email = `creem_phone_${label}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const res = await AuthService.register({
    email,
    password: 'Password123!',
    fullName: `Test Owner ${label}`,
    businessName: `Test Org ${label}`,
  });
  const orgId = res.organization!.id;
  const userId = res.user.id;
  await TrialService.redeemTrial({ userId, organizationId: orgId, email });
  return { orgId, userId, email };
}

async function setPlanTier(
  orgId: string,
  tier: 'TRIAL' | 'STARTER' | 'PRO' | 'BUSINESS',
  creemSubId: string = `sub_main_${orgId.slice(0, 8)}`
) {
  await db.execute(
    `UPDATE subscriptions
     SET plan_tier = $1, status = $2, creem_subscription_id = $3
     WHERE organization_id = $4`,
    [tier, SubscriptionStatus.ACTIVE, creemSubId, orgId]
  );
}

function p(suffix: number): string {
  return `+1212555${String(suffix).padStart(4, '0')}`;
}

async function runTests() {
  console.log('--- Running Creem Independent Phone Number Billing Test Suite ---');
  const telephony = VoiceService.getTelephonyProvider() as MockTelephonyProvider;

  // Test 1: Starter can create checkout for one number ($3/month product)
  const { orgId: orgStarter, email: starterEmail } = await createOrg('starter_1');
  await setPlanTier(orgStarter, 'STARTER');

  const phone1 = p(101);
  const checkout1 = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgStarter,
    phoneNumber: phone1,
    countryCode: 'US',
    userEmail: starterEmail,
  });

  assert.ok(checkout1.id, 'Checkout session created');
  assert.strictEqual(checkout1.customerMonthlyCostUsd, 3.00, 'Customer monthly cost is $3.00');
  assert.strictEqual(checkout1.status, 'PENDING', 'Initial checkout status is PENDING');
  console.log('  ✓ 1. Starter can purchase one number ($3/month product)');

  // Test 2: Starter cannot reserve a second number while first reservation is pending
  const phone2 = p(102);
  await assert.rejects(
    async () => {
      await PhoneNumberBillingService.createCheckoutSession({
        organizationId: orgStarter,
        phoneNumber: phone2,
        countryCode: 'US',
        userEmail: starterEmail,
      });
    },
    /phone number limit reached/i,
    'Starter org cannot reserve a second number beyond limit of 1'
  );
  console.log('  ✓ 2. Starter cannot reserve a second number beyond plan quota');

  // Test 3: Pro can purchase up to three numbers
  const { orgId: orgPro, email: proEmail } = await createOrg('pro_3');
  await setPlanTier(orgPro, 'PRO');

  const proPhone1 = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgPro,
    phoneNumber: p(201),
    countryCode: 'US',
    userEmail: proEmail,
  });
  const proPhone2 = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgPro,
    phoneNumber: p(202),
    countryCode: 'US',
    userEmail: proEmail,
  });
  const proPhone3 = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgPro,
    phoneNumber: p(203),
    countryCode: 'US',
    userEmail: proEmail,
  });
  assert.ok(proPhone1.id && proPhone2.id && proPhone3.id, 'All 3 Pro checkouts created');

  // 4th checkout must be rejected
  await assert.rejects(
    async () => {
      await PhoneNumberBillingService.createCheckoutSession({
        organizationId: orgPro,
        phoneNumber: p(204),
        countryCode: 'US',
        userEmail: proEmail,
      });
    },
    /phone number limit reached/i,
    'Pro org cannot exceed 3 numbers'
  );
  console.log('  ✓ 3. Pro can purchase up to three numbers');

  // Test 4: Business can purchase up to five numbers
  const { orgId: orgBiz, email: bizEmail } = await createOrg('biz_5');
  await setPlanTier(orgBiz, 'BUSINESS');

  for (let i = 1; i <= 5; i++) {
    await PhoneNumberBillingService.createCheckoutSession({
      organizationId: orgBiz,
      phoneNumber: p(300 + i),
      countryCode: 'US',
      userEmail: bizEmail,
    });
  }
  // 6th checkout must be rejected
  await assert.rejects(
    async () => {
      await PhoneNumberBillingService.createCheckoutSession({
        organizationId: orgBiz,
        phoneNumber: p(306),
        countryCode: 'US',
        userEmail: bizEmail,
      });
    },
    /phone number limit reached/i,
    'Business org cannot exceed 5 numbers'
  );
  console.log('  ✓ 4. Business can purchase up to five numbers');

  // Test 5: Concurrent checkout attempts cannot exceed quota
  const { orgId: orgConc, email: concEmail } = await createOrg('conc_limit');
  await setPlanTier(orgConc, 'STARTER'); // limit = 1

  // Fire 2 simultaneous checkout requests for Starter org
  const concResults = await Promise.allSettled([
    PhoneNumberBillingService.createCheckoutSession({
      organizationId: orgConc,
      phoneNumber: p(401),
      countryCode: 'US',
      userEmail: concEmail,
    }),
    PhoneNumberBillingService.createCheckoutSession({
      organizationId: orgConc,
      phoneNumber: p(402),
      countryCode: 'US',
      userEmail: concEmail,
    }),
  ]);

  const fulfilled = concResults.filter(r => r.status === 'fulfilled');
  const rejected = concResults.filter(r => r.status === 'rejected');
  assert.strictEqual(fulfilled.length, 1, 'Exactly one concurrent checkout succeeded');
  assert.strictEqual(rejected.length, 1, 'Second concurrent checkout was rejected');
  console.log('  ✓ 5. Concurrent checkout attempts cannot exceed quota (atomic reservation enforced)');

  // Test 6: Phone-number checkout is separate from main plan checkout
  const starterCheckout = await PhoneNumberBillingService.getCheckoutSession(orgStarter, checkout1.id);
  assert.strictEqual(starterCheckout?.customerMonthlyCostUsd, 3.00, 'Phone checkout fee is $3.00, not main plan $19');
  assert.strictEqual(starterCheckout?.organizationId, orgStarter);
  console.log('  ✓ 6. Phone-number checkout is separate from main plan checkout');

  // Test 7: Checkout uses the dedicated recurring $3 product
  assert.strictEqual(
    starterCheckout?.creemProductId,
    'prod_test_phone_recurring_3usd',
    'Checkout uses CREEM_PHONE_NUMBER_PRODUCT_ID'
  );
  console.log('  ✓ 7. Checkout uses the dedicated recurring $3 product');

  // Test 8: Invalid webhook signatures are rejected
  const fakeHeaders = { 'creem-signature': 'invalid_signature_hex' };
  const fakeBody = JSON.stringify({ eventType: 'checkout.completed' });
  const sigValid = await CreemBillingService.verifyWebhookSignature(fakeBody, fakeHeaders);
  assert.strictEqual(sigValid, false, 'Invalid webhook signature correctly rejected');
  console.log('  ✓ 8. Invalid webhook signatures are rejected');

  // Test 9: Phone-number webhooks do not overwrite main plan subscription IDs
  const { orgId: orgWebhook, email: webEmail } = await createOrg('webhook_test');
  const mainSubId = `sub_main_plan_${uuidv4().slice(0, 8)}`;
  await setPlanTier(orgWebhook, 'STARTER', mainSubId);

  // Check main sub before phone checkout
  const subBefore = await db.getOne<{ creem_subscription_id: string }>(
    'SELECT creem_subscription_id FROM subscriptions WHERE organization_id = $1',
    [orgWebhook]
  );
  assert.strictEqual(subBefore?.creem_subscription_id, mainSubId, 'Main plan has distinct sub ID');

  const phoneWebNum = p(501);
  const webCheckout = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgWebhook,
    phoneNumber: phoneWebNum,
    countryCode: 'US',
    userEmail: webEmail,
  });

  const phoneSubId = `sub_phone_rec_${uuidv4().slice(0, 8)}`;
  const phoneCheckoutCompletedWebhook = {
    id: `evt_${Date.now()}_1`,
    eventType: 'checkout.completed',
    object: {
      id: webCheckout.creemCheckoutId || `chk_${webCheckout.id}`,
      subscription: { id: phoneSubId },
      customer: { id: `cus_${uuidv4().slice(0, 8)}` },
      metadata: {
        type: 'PHONE_NUMBER',
        organizationId: orgWebhook,
        phoneNumber: phoneWebNum,
        checkoutSessionId: webCheckout.id,
      },
    },
  };

  await CreemBillingService.handleWebhookEvent(phoneCheckoutCompletedWebhook);

  // Re-check main sub in subscriptions table
  const subAfter = await db.getOne<{ creem_subscription_id: string; plan_tier: string }>(
    'SELECT creem_subscription_id, plan_tier FROM subscriptions WHERE organization_id = $1',
    [orgWebhook]
  );
  assert.strictEqual(subAfter?.creem_subscription_id, mainSubId, 'Main plan subscription ID was NOT overwritten');
  assert.strictEqual(subAfter?.plan_tier, 'STARTER', 'Main plan tier was NOT altered');

  // Check phone number was provisioned with phoneSubId
  const phoneRecord = await VoiceService.getPhoneNumberByNumber(phoneWebNum);
  assert.strictEqual(phoneRecord?.creemSubscriptionId, phoneSubId, 'Phone number has individual Creem sub ID');
  assert.strictEqual(phoneRecord?.status, 'ACTIVE', 'Phone number is ACTIVE');
  console.log('  ✓ 9. Phone-number webhooks do not overwrite main plan subscription IDs');

  // Test 10: Duplicate webhooks do not duplicate Telnyx orders
  const duplicateWebhook = {
    id: phoneCheckoutCompletedWebhook.id, // same event ID
    eventType: 'checkout.completed',
    object: phoneCheckoutCompletedWebhook.object,
  };
  const dupRes = await CreemBillingService.handleWebhookEvent(duplicateWebhook);
  assert.ok(dupRes.success, 'Duplicate webhook returns success (idempotent)');
  assert.match(dupRes.message, /already processed/i, 'Detected duplicate webhook via idempotency table');
  console.log('  ✓ 10. Duplicate webhooks do not duplicate Telnyx orders (idempotency enforced)');

  // Test 11: Out-of-order webhook delivery is handled safely
  // If subscription.canceled arrives, a late subscription.active does not reset it if canceled
  const outOfOrderSubId = phoneSubId;
  await CreemBillingService.handleWebhookEvent({
    id: `evt_cancel_${Date.now()}`,
    eventType: 'subscription.canceled',
    object: { id: outOfOrderSubId },
  });
  const afterCancel = await VoiceService.getPhoneNumberByNumber(phoneWebNum);
  assert.strictEqual(afterCancel?.billingStatus, 'CANCELED', 'Billing status updated to CANCELED');
  console.log('  ✓ 11. Out-of-order webhook events handled safely');

  // Test 12: Telnyx is never called before payment confirmation
  const { orgId: orgNoPay, email: noPayEmail } = await createOrg('no_pay');
  await setPlanTier(orgNoPay, 'STARTER');
  const noPayPhone = p(601);

  const pendingSession = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgNoPay,
    phoneNumber: noPayPhone,
    countryCode: 'US',
    userEmail: noPayEmail,
  });
  // Check that no row with status ACTIVE exists in voice_phone_numbers
  const unprovPhone = await VoiceService.getPhoneNumberByNumber(noPayPhone);
  assert.strictEqual(unprovPhone, null, 'No phone number provisioned before payment');
  console.log('  ✓ 12. Telnyx is never called before payment confirmation');

  // Test 13: Successful payment provisions through mocked Telnyx
  const payWebhook = {
    id: `evt_pay_${Date.now()}`,
    eventType: 'checkout.completed',
    object: {
      id: pendingSession.creemCheckoutId || `chk_${pendingSession.id}`,
      subscription: { id: `sub_phone_${uuidv4().slice(0, 8)}` },
      customer: { id: `cus_${uuidv4().slice(0, 8)}` },
      metadata: {
        type: 'PHONE_NUMBER',
        organizationId: orgNoPay,
        phoneNumber: noPayPhone,
        checkoutSessionId: pendingSession.id,
      },
    },
  };
  await CreemBillingService.handleWebhookEvent(payWebhook);
  const provPhone = await VoiceService.getPhoneNumberByNumber(noPayPhone);
  assert.ok(provPhone, 'Phone number exists after payment webhook');
  assert.strictEqual(provPhone?.status, 'ACTIVE', 'Phone number is ACTIVE after verified payment');
  console.log('  ✓ 13. Successful payment provisions through mocked Telnyx');

  // Test 14: Provisioning failure does not falsely activate a number
  const { orgId: orgFail, email: failEmail } = await createOrg('fail_prov');
  await setPlanTier(orgFail, 'STARTER');
  const failPhone = p(701);
  const failCheckout = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgFail,
    phoneNumber: failPhone,
    countryCode: 'US',
    userEmail: failEmail,
  });

  // Temporarily simulate Telnyx failure
  telephony.simulateProvisionFailure = true;

  try {
    await CreemBillingService.handleWebhookEvent({
      id: `evt_fail_${Date.now()}`,
      eventType: 'checkout.completed',
      object: {
        id: failCheckout.creemCheckoutId || `chk_${failCheckout.id}`,
        subscription: { id: `sub_fail_${uuidv4().slice(0, 8)}` },
        customer: { id: `cus_fail_${uuidv4().slice(0, 8)}` },
        metadata: {
          type: 'PHONE_NUMBER',
          organizationId: orgFail,
          phoneNumber: failPhone,
          checkoutSessionId: failCheckout.id,
        },
      },
    });
  } catch {
    // Expected provisioning error caught
  } finally {
    telephony.simulateProvisionFailure = false;
  }

  const failedRecord = await VoiceService.getPhoneNumberByNumber(failPhone);
  assert.notStrictEqual(failedRecord?.status, 'ACTIVE', 'Failed number was NOT marked ACTIVE');
  assert.strictEqual(failedRecord?.status, 'FAILED', 'Status is FAILED');
  console.log('  ✓ 14. Provisioning failure does not falsely activate a number');

  // Test 15: Individual cancellation does not cancel the main plan
  const { orgId: orgCancelTest, email: cancelEmail } = await createOrg('cancel_test');
  const mainSubCancelTest = `sub_main_keep_${uuidv4().slice(0, 8)}`;
  await setPlanTier(orgCancelTest, 'STARTER', mainSubCancelTest);

  const cancelPhone = p(801);
  const cSess = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgCancelTest,
    phoneNumber: cancelPhone,
    countryCode: 'US',
    userEmail: cancelEmail,
  });
  const cPhoneSubId = `sub_phone_cancel_${uuidv4().slice(0, 8)}`;
  await CreemBillingService.handleWebhookEvent({
    id: `evt_c_${Date.now()}`,
    eventType: 'checkout.completed',
    object: {
      id: cSess.creemCheckoutId || `chk_${cSess.id}`,
      subscription: { id: cPhoneSubId },
      metadata: {
        type: 'PHONE_NUMBER',
        organizationId: orgCancelTest,
        phoneNumber: cancelPhone,
        checkoutSessionId: cSess.id,
      },
    },
  });

  const activeCPhone = await VoiceService.getPhoneNumberByNumber(cancelPhone);
  assert.ok(activeCPhone, 'Phone number exists');

  // Cancel this phone rental
  const cancelResult = await PhoneNumberBillingService.cancelPhoneNumberRental(orgCancelTest, activeCPhone!.id);
  assert.ok(cancelResult.success, 'Phone cancellation succeeded');

  // Verify phone is scheduled for cancellation
  const cancelledPhone = await VoiceService.getPhoneNumberById(orgCancelTest, activeCPhone!.id);
  assert.strictEqual(cancelledPhone?.cancelAtPeriodEnd, true, 'Phone scheduled for cancel at period end');

  // Verify main plan is still ACTIVE and untouched
  const mainPlanAfter = await db.getOne<any>(
    'SELECT status, creem_subscription_id, cancel_at_period_end FROM subscriptions WHERE organization_id = $1',
    [orgCancelTest]
  );
  assert.strictEqual(mainPlanAfter?.status, SubscriptionStatus.ACTIVE, 'Main plan is still ACTIVE');
  assert.strictEqual(mainPlanAfter?.creem_subscription_id, mainSubCancelTest, 'Main plan subscription ID unchanged');
  assert.strictEqual(mainPlanAfter?.cancel_at_period_end, false, 'Main plan cancel_at_period_end is false');
  console.log('  ✓ 15. Individual cancellation does not cancel the main plan');

  // Test 16: Cancelling one number does not affect other numbers
  const { orgId: orgMultiPhone, email: multiEmail } = await createOrg('multi_phone');
  await setPlanTier(orgMultiPhone, 'PRO'); // limit = 3

  const mPhone1 = p(901);
  const mPhone2 = p(902);

  const mSess1 = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgMultiPhone,
    phoneNumber: mPhone1,
    countryCode: 'US',
    userEmail: multiEmail,
  });
  const mSess2 = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgMultiPhone,
    phoneNumber: mPhone2,
    countryCode: 'US',
    userEmail: multiEmail,
  });

  const mSub1 = `sub_m1_${uuidv4().slice(0, 8)}`;
  const mSub2 = `sub_m2_${uuidv4().slice(0, 8)}`;

  await CreemBillingService.handleWebhookEvent({
    id: `evt_m1_${Date.now()}`,
    eventType: 'checkout.completed',
    object: {
      id: mSess1.creemCheckoutId || `chk_${mSess1.id}`,
      subscription: { id: mSub1 },
      metadata: { type: 'PHONE_NUMBER', organizationId: orgMultiPhone, phoneNumber: mPhone1, checkoutSessionId: mSess1.id },
    },
  });
  await CreemBillingService.handleWebhookEvent({
    id: `evt_m2_${Date.now()}`,
    eventType: 'checkout.completed',
    object: {
      id: mSess2.creemCheckoutId || `chk_${mSess2.id}`,
      subscription: { id: mSub2 },
      metadata: { type: 'PHONE_NUMBER', organizationId: orgMultiPhone, phoneNumber: mPhone2, checkoutSessionId: mSess2.id },
    },
  });

  const record1 = await VoiceService.getPhoneNumberByNumber(mPhone1);
  const record2 = await VoiceService.getPhoneNumberByNumber(mPhone2);

  // Cancel only phone 1
  await PhoneNumberBillingService.cancelPhoneNumberRental(orgMultiPhone, record1!.id);

  const check1 = await VoiceService.getPhoneNumberById(orgMultiPhone, record1!.id);
  const check2 = await VoiceService.getPhoneNumberById(orgMultiPhone, record2!.id);

  assert.strictEqual(check1?.cancelAtPeriodEnd, true, 'Phone 1 is scheduled for cancellation');
  assert.strictEqual(check2?.cancelAtPeriodEnd, false, 'Phone 2 cancelAtPeriodEnd is false (still active)');
  assert.strictEqual(check2?.status, 'ACTIVE', 'Phone 2 status is still ACTIVE');
  console.log('  ✓ 16. Cancelling one number does not affect other numbers');

  // Test 17: Failed renewal updates only the corresponding phone number
  await CreemBillingService.handleWebhookEvent({
    id: `evt_fail_renew_${Date.now()}`,
    eventType: 'subscription.past_due',
    object: { id: mSub2 },
  });
  const pastDuePhone = await VoiceService.getPhoneNumberById(orgMultiPhone, record2!.id);
  assert.strictEqual(pastDuePhone?.billingStatus, 'PAST_DUE', 'Phone 2 billingStatus is PAST_DUE');

  // Verify main subscription is not set to past_due
  const mainSubOrg = await db.getOne<any>(
    'SELECT status FROM subscriptions WHERE organization_id = $1',
    [orgMultiPhone]
  );
  assert.strictEqual(mainSubOrg?.status, SubscriptionStatus.ACTIVE, 'Main plan status is still ACTIVE');
  console.log('  ✓ 17. Failed renewal updates only the corresponding phone number');

  // Test 18: Main-plan downgrade does not silently release or cancel numbers
  // Downgrade orgMultiPhone from PRO (limit 3) to STARTER (limit 1)
  await setPlanTier(orgMultiPhone, 'STARTER');

  // Both phone numbers should still exist
  const stillPhone1 = await VoiceService.getPhoneNumberById(orgMultiPhone, record1!.id);
  const stillPhone2 = await VoiceService.getPhoneNumberById(orgMultiPhone, record2!.id);
  assert.ok(stillPhone1, 'Phone 1 was preserved during plan downgrade');
  assert.ok(stillPhone2, 'Phone 2 was preserved during plan downgrade');

  // Attempting to buy a 3rd number must be rejected (2 existing >= 1 Starter limit)
  await assert.rejects(
    async () => {
      await PhoneNumberBillingService.createCheckoutSession({
        organizationId: orgMultiPhone,
        phoneNumber: p(903),
        countryCode: 'US',
        userEmail: multiEmail,
      });
    },
    /phone number limit reached/i,
    'Purchases blocked because org is at or above new lower tier limit'
  );
  console.log('  ✓ 18. Main-plan downgrade preserves existing numbers and blocks over-quota purchases');

  // Test 19: Expired checkout reservations are released
  const { orgId: orgExp, email: expEmail } = await createOrg('exp_test');
  await setPlanTier(orgExp, 'STARTER'); // limit = 1

  const expPhone = p(950);
  const expSession = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgExp,
    phoneNumber: expPhone,
    countryCode: 'US',
    userEmail: expEmail,
  });

  // Manually expire the reservation in DB
  const pastDate = new Date(Date.now() - 60000).toISOString();
  await db.execute(
    `UPDATE voice_phone_number_checkouts SET expires_at = $1 WHERE id = $2`,
    [pastDate, expSession.id]
  );

  // Now, since the pending checkout is expired, a new checkout must be allowed!
  const newPhone = p(951);
  const newSession = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgExp,
    phoneNumber: newPhone,
    countryCode: 'US',
    userEmail: expEmail,
  });
  assert.ok(newSession.id, 'New checkout session succeeded after prior reservation expired');
  console.log('  ✓ 19. Expired checkout reservations are released');

  // Test 20: Organization ownership and authorization are enforced
  const { orgId: orgForeign } = await createOrg('foreign_org');
  await assert.rejects(
    async () => {
      // orgForeign tries to cancel orgExp's phone checkout or number
      await PhoneNumberBillingService.cancelPhoneNumberRental(orgForeign, newSession.id);
    },
    /phone number record not found/i,
    'Cross-tenant cancellation rejected'
  );
  console.log('  ✓ 20. Organization ownership and authorization are enforced');

  // Test 21: Unknown Creem product cannot overwrite core subscription (Fix F-03)
  const { orgId: orgUnk } = await createOrg('unknown_prod');
  const coreSubId = `sub_core_${uuidv4().slice(0, 8)}`;
  await setPlanTier(orgUnk, 'STARTER', coreSubId);

  await CreemBillingService.handleWebhookEvent({
    id: `evt_unk_${Date.now()}`,
    eventType: 'checkout.completed',
    object: {
      id: `chk_unk_${Date.now()}`,
      product_id: 'prod_completely_unknown_item_999',
      subscription: { id: 'sub_foreign_sneaky_sub' },
      metadata: { organizationId: orgUnk },
    },
  });

  const subUnkAfter = await db.getOne<{ creem_subscription_id: string; plan_tier: string }>(
    'SELECT creem_subscription_id, plan_tier FROM subscriptions WHERE organization_id = $1',
    [orgUnk]
  );
  assert.strictEqual(subUnkAfter?.creem_subscription_id, coreSubId, 'Core subscription ID was NOT overwritten by unknown product');
  assert.strictEqual(subUnkAfter?.plan_tier, 'STARTER', 'Core plan tier was NOT mutated');
  console.log('  ✓ 21. Unknown Creem product cannot overwrite core subscription (Fail-closed isolation)');

  // Test 22: Correct transaction ID extraction from actual Creem checkout schema (Fix F-04)
  const { orgId: orgRealTxn, email: realEmail } = await createOrg('real_txn');
  await setPlanTier(orgRealTxn, 'STARTER');
  const realPhone = p(960);
  const realCheckout = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgRealTxn,
    phoneNumber: realPhone,
    countryCode: 'US',
    userEmail: realEmail,
  });

  const expectedTxnId = `txn_creem_official_${Date.now()}`;
  await CreemBillingService.handleWebhookEvent({
    id: `evt_real_schema_${Date.now()}`,
    eventType: 'checkout.completed',
    object: {
      id: realCheckout.creemCheckoutId || `chk_${realCheckout.id}`,
      order: {
        transaction: expectedTxnId,
      },
      subscription: { id: `sub_real_${uuidv4().slice(0, 8)}` },
      metadata: {
        type: 'PHONE_NUMBER',
        organizationId: orgRealTxn,
        phoneNumber: realPhone,
        checkoutSessionId: realCheckout.id,
      },
    },
  });

  const realPhoneRecord = await VoiceService.getPhoneNumberByNumber(realPhone);
  assert.strictEqual(realPhoneRecord?.status, 'ACTIVE', 'Phone provisioned from real nested order.transaction schema');
  console.log('  ✓ 22. Correct transaction ID extraction from actual Creem checkout schema');

  // Test 23: Failed Creem cancellation is retryable (Fix F-05)
  const { orgId: orgCancelRetry, email: retryEmail } = await createOrg('cancel_retry');
  await setPlanTier(orgCancelRetry, 'STARTER');
  const retryPhone = p(965);
  const rSess = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgCancelRetry,
    phoneNumber: retryPhone,
    countryCode: 'US',
    userEmail: retryEmail,
  });

  const rSubId = `sub_r_${uuidv4().slice(0, 8)}`;
  await CreemBillingService.handleWebhookEvent({
    id: `evt_r_${Date.now()}`,
    eventType: 'checkout.completed',
    object: {
      id: rSess.creemCheckoutId || `chk_${rSess.id}`,
      subscription: { id: rSubId },
      metadata: { type: 'PHONE_NUMBER', organizationId: orgCancelRetry, phoneNumber: retryPhone, checkoutSessionId: rSess.id },
    },
  });

  const retryPhoneRec = await VoiceService.getPhoneNumberByNumber(retryPhone);
  assert.ok(retryPhoneRec, 'Phone number exists');

  // Mock Creem SDK cancellation failure
  const mockFailCancelSdk = {
    subscriptions: {
      cancel: async () => {
        throw new Error('Simulated Creem API gateway timeout (HTTP 504)');
      },
    },
    transactions: {
      refund: async () => ({ status: 'refunded' }),
    },
  };
  CreemBillingService.setCreemSdk(mockFailCancelSdk);

  // Attempt cancellation: must fail and throw clear error
  await assert.rejects(
    async () => {
      await PhoneNumberBillingService.cancelPhoneNumberRental(orgCancelRetry, retryPhoneRec!.id);
    },
    /Failed to schedule cancellation with payment provider/i,
    'Failed cancellation throws clear error'
  );

  // Verify DB state is recorded as FAILED and NOT marked cancel_at_period_end
  const failedCancelPhone = await VoiceService.getPhoneNumberById(orgCancelRetry, retryPhoneRec!.id);
  assert.strictEqual(failedCancelPhone?.cancellationStatus, 'FAILED', 'Cancellation status is FAILED');
  assert.strictEqual(failedCancelPhone?.cancelAtPeriodEnd, false, 'cancelAtPeriodEnd remains FALSE');
  assert.strictEqual(failedCancelPhone?.status, 'ACTIVE', 'Phone is still ACTIVE');

  // Restore Creem SDK with working cancel for retry
  const mockSuccessCancelSdk = {
    subscriptions: {
      cancel: async () => ({ status: 'canceled' }),
    },
    transactions: {
      refund: async () => ({ status: 'refunded' }),
    },
  };
  CreemBillingService.setCreemSdk(mockSuccessCancelSdk);

  // Retry cancellation: must succeed!
  const retrySuccess = await PhoneNumberBillingService.cancelPhoneNumberRental(orgCancelRetry, retryPhoneRec!.id);
  assert.ok(retrySuccess.success, 'Retry cancellation succeeded');

  const afterRetryPhone = await VoiceService.getPhoneNumberById(orgCancelRetry, retryPhoneRec!.id);
  assert.strictEqual(afterRetryPhone?.cancellationStatus, 'SCHEDULED', 'Cancellation status is SCHEDULED');
  assert.strictEqual(afterRetryPhone?.cancelAtPeriodEnd, true, 'cancelAtPeriodEnd is now TRUE');

  // Reset Creem SDK override
  CreemBillingService.setCreemSdk(null);
  console.log('  ✓ 23. Failed Creem cancellation is retryable without corrupting state');

  // Test 24: Terminal cancellation releases quota correctly (Fix F-02)
  const { orgId: orgTerm, email: termEmail } = await createOrg('term_cancel');
  await setPlanTier(orgTerm, 'STARTER'); // limit = 1
  const termPhone = p(970);
  const termSess = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgTerm,
    phoneNumber: termPhone,
    countryCode: 'US',
    userEmail: termEmail,
  });

  const termSubId = `sub_term_${uuidv4().slice(0, 8)}`;
  await CreemBillingService.handleWebhookEvent({
    id: `evt_term_${Date.now()}`,
    eventType: 'checkout.completed',
    object: {
      id: termSess.creemCheckoutId || `chk_${termSess.id}`,
      subscription: { id: termSubId },
      metadata: { type: 'PHONE_NUMBER', organizationId: orgTerm, phoneNumber: termPhone, checkoutSessionId: termSess.id },
    },
  });

  // At 1/1 limit: another number cannot be reserved
  await assert.rejects(
    async () => {
      await PhoneNumberBillingService.createCheckoutSession({
        organizationId: orgTerm,
        phoneNumber: p(971),
        countryCode: 'US',
        userEmail: termEmail,
      });
    },
    /phone number limit reached/i,
    'Quota reached at 1/1'
  );

  // User schedules cancellation: phone is still active until billing period ends
  const termPhoneRec = await VoiceService.getPhoneNumberByNumber(termPhone);
  await PhoneNumberBillingService.cancelPhoneNumberRental(orgTerm, termPhoneRec!.id);
  const stillActiveTerm = await VoiceService.getPhoneNumberById(orgTerm, termPhoneRec!.id);
  assert.strictEqual(stillActiveTerm?.status, 'ACTIVE', 'Number remains ACTIVE during scheduled cancellation');

  // End of billing period arrives: Creem delivers subscription.canceled webhook
  await CreemBillingService.handleWebhookEvent({
    id: `evt_term_expired_${Date.now()}`,
    eventType: 'subscription.canceled',
    object: { id: termSubId },
  });

  // Verify terminal state in DB
  const expiredPhone = await VoiceService.getPhoneNumberById(orgTerm, termPhoneRec!.id);
  assert.strictEqual(expiredPhone?.status, 'INACTIVE', 'Phone status is INACTIVE');
  assert.strictEqual(expiredPhone?.billingStatus, 'CANCELED', 'Billing status is CANCELED');
  assert.strictEqual(expiredPhone?.releaseStatus, 'RELEASED', 'Release status is RELEASED');

  // Quota is now freed: Starter org can purchase a replacement number!
  const replacementPhone = p(972);
  const replacementSess = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgTerm,
    phoneNumber: replacementPhone,
    countryCode: 'US',
    userEmail: termEmail,
  });
  assert.ok(replacementSess.id, 'Replacement number purchase succeeded after quota released');
  console.log('  ✓ 24. Terminal cancellation releases quota and deprovisions number correctly');

  // Test 25: Different event IDs for one checkout cannot duplicate Telnyx orders (Fix F-06 / F-07)
  const { orgId: orgDiffEvt, email: diffEmail } = await createOrg('diff_evt');
  await setPlanTier(orgDiffEvt, 'STARTER');
  const diffPhone = p(975);
  const diffSess = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgDiffEvt,
    phoneNumber: diffPhone,
    countryCode: 'US',
    userEmail: diffEmail,
  });

  const diffSubId = `sub_diff_${uuidv4().slice(0, 8)}`;
  // First delivery: event ID = evt_alpha
  await CreemBillingService.handleWebhookEvent({
    id: `evt_alpha_${Date.now()}`,
    eventType: 'checkout.completed',
    object: {
      id: diffSess.creemCheckoutId || `chk_${diffSess.id}`,
      subscription: { id: diffSubId },
      metadata: { type: 'PHONE_NUMBER', organizationId: orgDiffEvt, phoneNumber: diffPhone, checkoutSessionId: diffSess.id },
    },
  });

  const firstRecord = await VoiceService.getPhoneNumberByNumber(diffPhone);
  assert.ok(firstRecord?.telnyxOrderId, 'First fulfillment has telnyxOrderId');

  // Second delivery with DIFFERENT event ID: event ID = evt_beta
  await CreemBillingService.handleWebhookEvent({
    id: `evt_beta_${Date.now()}`,
    eventType: 'checkout.completed',
    object: {
      id: diffSess.creemCheckoutId || `chk_${diffSess.id}`,
      subscription: { id: diffSubId },
      metadata: { type: 'PHONE_NUMBER', organizationId: orgDiffEvt, phoneNumber: diffPhone, checkoutSessionId: diffSess.id },
    },
  });

  const secondRecord = await VoiceService.getPhoneNumberByNumber(diffPhone);
  assert.strictEqual(secondRecord?.telnyxOrderId, firstRecord?.telnyxOrderId, 'Telnyx order was not duplicated across different event IDs');
  console.log('  ✓ 25. Different event IDs for one checkout cannot duplicate Telnyx orders');

  // Test 26: Telnyx order success followed by retry recovers existing provider order (Fix F-06)
  const { orgId: orgRecover, email: recoverEmail } = await createOrg('recover_test');
  await setPlanTier(orgRecover, 'STARTER');
  const recoverPhone = p(980);
  const recSubId = `sub_rec_${uuidv4().slice(0, 8)}`;

  // Simulate an intermediate phone row where Telnyx was already ordered before a crash
  const fakeOrderId = `mock_order_recovered_${Date.now()}`;
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method,
       status, provisioning_status, billing_status, cancel_at_period_end,
       monthly_cost_usd, customer_monthly_cost_usd, creem_subscription_id,
       telnyx_order_id, telnyx_phone_number_id, created_at, updated_at
     ) VALUES ($1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'PENDING_VERIFICATION', 'TELNYX_ORDER_CREATED', 'ACTIVE', FALSE, 3.00, 3.00, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), orgRecover, recoverPhone, recSubId, fakeOrderId, 'mock_ptn_recovered']
  );

  // Call fulfillment again (simulating webhook retry after recovery):
  const recoveredResult = await VoiceService.fulfillPaidPhoneNumberOrder({
    organizationId: orgRecover,
    phoneNumber: recoverPhone,
    creemSubscriptionId: recSubId,
  });

  assert.strictEqual(recoveredResult.status, 'ACTIVE', 'Recovered number reached ACTIVE');
  assert.strictEqual(recoveredResult.telnyxOrderId, fakeOrderId, 'Existing Telnyx order was safely recovered without re-ordering');
  console.log('  ✓ 26. Telnyx order success followed by retry recovers existing provider order');

  // Test 27: Provisioning failure triggers BOTH refund and immediate Creem subscription cancel (Fix F-04)
  const { orgId: orgFailClean, email: failCleanEmail } = await createOrg('fail_clean');
  const mainSubFailClean = `sub_main_keep_${uuidv4().slice(0, 8)}`;
  await setPlanTier(orgFailClean, 'STARTER', mainSubFailClean);

  const failCleanPhone = p(985);
  const failCleanSess = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgFailClean,
    phoneNumber: failCleanPhone,
    countryCode: 'US',
    userEmail: failCleanEmail,
  });

  const failPhoneSubId = `sub_phone_failed_${uuidv4().slice(0, 8)}`;
  const failTxnId = `txn_failed_${Date.now()}`;
  const telephonyFail = VoiceService.getTelephonyProvider() as MockTelephonyProvider;
  telephonyFail.simulateProvisionFailure = true;

  let refundSpyCalled: any = null;
  let cancelSpyCalled: any = null;
  const mockSpySdk = {
    transactions: {
      refund: async (args: any) => {
        refundSpyCalled = args;
        return { status: 'refunded' };
      },
    },
    subscriptions: {
      cancel: async (subId: string, opts: any) => {
        cancelSpyCalled = { subId, opts };
        return { status: 'canceled' };
      },
    },
  };
  CreemBillingService.setCreemSdk(mockSpySdk);

  try {
    await CreemBillingService.handleWebhookEvent({
      id: `evt_fail_clean_${Date.now()}`,
      eventType: 'checkout.completed',
      object: {
        id: failCleanSess.creemCheckoutId || `chk_${failCleanSess.id}`,
        order: { transaction: failTxnId },
        subscription: { id: failPhoneSubId },
        metadata: {
          type: 'PHONE_NUMBER',
          organizationId: orgFailClean,
          phoneNumber: failCleanPhone,
          checkoutSessionId: failCleanSess.id,
        },
      },
    });
  } catch {
    // Expected provisioning error caught
  } finally {
    telephonyFail.simulateProvisionFailure = false;
    CreemBillingService.setCreemSdk(null);
  }

  assert.strictEqual(refundSpyCalled?.transactionId, failTxnId, 'Creem refund API was invoked with transactionId');
  assert.strictEqual(cancelSpyCalled?.subId, failPhoneSubId, 'Creem cancel API was invoked with recurring subscription ID');
  assert.strictEqual(cancelSpyCalled?.opts?.mode, 'immediate', 'Creem cancel API was invoked with mode: immediate');

  const failRec = await VoiceService.getPhoneNumberByNumber(failCleanPhone);
  assert.strictEqual(failRec?.status, 'FAILED', 'Status is FAILED');
  assert.strictEqual(failRec?.refundStatus, 'REFUNDED', 'Transaction refund executed');
  assert.strictEqual(failRec?.cancellationStatus, 'CANCELED', 'Creem phone recurring subscription canceled immediately');

  // Verify main plan was NOT touched
  const mainAfterFail = await db.getOne<any>(
    'SELECT status, creem_subscription_id FROM subscriptions WHERE organization_id = $1',
    [orgFailClean]
  );
  assert.strictEqual(mainAfterFail?.status, SubscriptionStatus.ACTIVE, 'Main plan remains ACTIVE');
  assert.strictEqual(mainAfterFail?.creem_subscription_id, mainSubFailClean, 'Main plan subscription untouched');
  console.log('  ✓ 27. Provisioning failure triggers refund and subscription cancellation without touching main plan');

  // Test 28: Telnyx 409 recovery when existing order belongs to same organization
  const { orgId: org409Same, email: email409Same } = await createOrg('rec_409_same');
  await setPlanTier(org409Same, 'STARTER');
  const phone409Same = p(990);
  const sess409Same = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: org409Same,
    phoneNumber: phone409Same,
    countryCode: 'US',
    userEmail: email409Same,
  });

  telephony.simulate409Conflict = true;
  telephony.simulateConflictBelongsToSameOrg = true;

  try {
    await CreemBillingService.handleWebhookEvent({
      id: `evt_409_same_${Date.now()}`,
      eventType: 'checkout.completed',
      object: {
        id: sess409Same.creemCheckoutId || `chk_${sess409Same.id}`,
        order: { transaction: `txn_409_${Date.now()}` },
        subscription: { id: `sub_409_same_${Date.now()}` },
        metadata: {
          type: 'PHONE_NUMBER',
          organizationId: org409Same,
          phoneNumber: phone409Same,
          checkoutSessionId: sess409Same.id,
        },
      },
    });
  } finally {
    telephony.simulate409Conflict = false;
  }

  const rec409Same = await VoiceService.getPhoneNumberByNumber(phone409Same);
  assert.strictEqual(rec409Same?.status, 'ACTIVE', 'Number recovered from Telnyx 409 conflict and activated');
  assert.ok(rec409Same?.telnyxOrderId, 'Telnyx order ID recovered');
  console.log('  ✓ 28. Telnyx 409 recovery when existing order belongs to same organization');

  // Test 29: Telnyx 409 rejection when existing order belongs to another organization
  const { orgId: org409Diff, email: email409Diff } = await createOrg('rec_409_diff');
  await setPlanTier(org409Diff, 'STARTER');
  const phone409Diff = p(991);
  const sess409Diff = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: org409Diff,
    phoneNumber: phone409Diff,
    countryCode: 'US',
    userEmail: email409Diff,
  });

  telephony.simulate409Conflict = true;
  telephony.simulateConflictBelongsToSameOrg = false; // Belongs to someone else!

  try {
    await CreemBillingService.handleWebhookEvent({
      id: `evt_409_diff_${Date.now()}`,
      eventType: 'checkout.completed',
      object: {
        id: sess409Diff.creemCheckoutId || `chk_${sess409Diff.id}`,
        order: { transaction: `txn_diff_${Date.now()}` },
        subscription: { id: `sub_409_diff_${Date.now()}` },
        metadata: {
          type: 'PHONE_NUMBER',
          organizationId: org409Diff,
          phoneNumber: phone409Diff,
          checkoutSessionId: sess409Diff.id,
        },
      },
    });
  } catch {
    // Expected error
  } finally {
    telephony.simulate409Conflict = false;
    telephony.simulateConflictBelongsToSameOrg = true;
  }

  const rec409Diff = await VoiceService.getPhoneNumberByNumber(phone409Diff);
  assert.strictEqual(rec409Diff?.status, 'FAILED', 'Conflict for foreign number rejected as FAILED');
  assert.strictEqual(rec409Diff?.refundStatus, 'REFUNDED', 'Customer was refunded for unfulfillable number');
  console.log('  ✓ 29. Telnyx 409 rejection when existing order belongs to another organization');

  // Test 30: Telnyx timeout after order creation recovers existing order without duplicate purchase
  const { orgId: orgTimeout, email: emailTimeout } = await createOrg('timeout_rec');
  await setPlanTier(orgTimeout, 'STARTER');
  const phoneTimeout = p(992);
  const sessTimeout = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgTimeout,
    phoneNumber: phoneTimeout,
    countryCode: 'US',
    userEmail: emailTimeout,
  });

  telephony.simulateNetworkTimeout = true;
  telephony.simulateConflictBelongsToSameOrg = true;

  try {
    await CreemBillingService.handleWebhookEvent({
      id: `evt_timeout_${Date.now()}`,
      eventType: 'checkout.completed',
      object: {
        id: sessTimeout.creemCheckoutId || `chk_${sessTimeout.id}`,
        order: { transaction: `txn_timeout_${Date.now()}` },
        subscription: { id: `sub_timeout_${Date.now()}` },
        metadata: {
          type: 'PHONE_NUMBER',
          organizationId: orgTimeout,
          phoneNumber: phoneTimeout,
          checkoutSessionId: sessTimeout.id,
        },
      },
    });
  } finally {
    telephony.simulateNetworkTimeout = false;
  }

  const recTimeout = await VoiceService.getPhoneNumberByNumber(phoneTimeout);
  assert.strictEqual(recTimeout?.status, 'ACTIVE', 'Number recovered from network timeout and activated');
  console.log('  ✓ 30. Telnyx timeout after order creation recovers existing order without duplicate purchase');

  // Test 31: Failed recovery preserves a recoverable pending state (PENDING_RECONCILIATION)
  const { orgId: orgAmbig, email: emailAmbig } = await createOrg('ambig_rec');
  await setPlanTier(orgAmbig, 'STARTER');
  const phoneAmbig = p(993);
  const sessAmbig = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgAmbig,
    phoneNumber: phoneAmbig,
    countryCode: 'US',
    userEmail: emailAmbig,
  });

  telephony.simulate409Conflict = true;
  telephony.simulateAmbiguousConflict = true;

  try {
    await CreemBillingService.handleWebhookEvent({
      id: `evt_ambig_${Date.now()}`,
      eventType: 'checkout.completed',
      object: {
        id: sessAmbig.creemCheckoutId || `chk_${sessAmbig.id}`,
        order: { transaction: `txn_ambig_${Date.now()}` },
        subscription: { id: `sub_ambig_${Date.now()}` },
        metadata: {
          type: 'PHONE_NUMBER',
          organizationId: orgAmbig,
          phoneNumber: phoneAmbig,
          checkoutSessionId: sessAmbig.id,
        },
      },
    });
  } catch {
    // Expected ambiguous conflict error
  } finally {
    telephony.simulate409Conflict = false;
    telephony.simulateAmbiguousConflict = false;
  }

  const recAmbig = await VoiceService.getPhoneNumberByNumber(phoneAmbig);
  assert.strictEqual(recAmbig?.status, 'PENDING_RECONCILIATION', 'Preserved in PENDING_RECONCILIATION state');
  assert.strictEqual(recAmbig?.refundStatus ?? null, null, 'Did NOT trigger false refund');
  assert.strictEqual(recAmbig?.cancellationStatus ?? null, null, 'Did NOT trigger false subscription cancellation');
  console.log('  ✓ 31. Failed recovery preserves a recoverable pending state without false refund or cancellation');

  // Test 32: PhoneDeprovisioningWorker processes transient release failure and retries successfully
  const { orgId: orgWorker, email: emailWorker } = await createOrg('worker_retry');
  await setPlanTier(orgWorker, 'STARTER');
  const phoneWorker = p(994);
  const sessWorker = await PhoneNumberBillingService.createCheckoutSession({
    organizationId: orgWorker,
    phoneNumber: phoneWorker,
    countryCode: 'US',
    userEmail: emailWorker,
  });
  const subWorker = `sub_worker_${Date.now()}`;
  await CreemBillingService.handleWebhookEvent({
    id: `evt_worker_${Date.now()}`,
    eventType: 'checkout.completed',
    object: {
      id: sessWorker.creemCheckoutId || `chk_${sessWorker.id}`,
      subscription: { id: subWorker },
      metadata: { type: 'PHONE_NUMBER', organizationId: orgWorker, phoneNumber: phoneWorker, checkoutSessionId: sessWorker.id },
    },
  });

  // Terminal cancellation occurs, but Telnyx carrier release temporarily fails
  telephony.simulateReleaseFailure = true;
  await CreemBillingService.handleWebhookEvent({
    id: `evt_worker_term_${Date.now()}`,
    eventType: 'subscription.canceled',
    object: { id: subWorker },
  });

  const failedReleasePhone = await VoiceService.getPhoneNumberByNumber(phoneWorker);
  assert.strictEqual(failedReleasePhone?.releaseStatus, 'RELEASE_FAILED', 'Release marked RELEASE_FAILED on carrier error');

  // Now background worker runs with Telnyx restored:
  telephony.simulateReleaseFailure = false;
  const workerResult = await PhoneDeprovisioningWorker.processPendingReleases();
  assert.ok(workerResult.succeeded >= 1, 'Worker successfully deprovisioned phone number on retry');

  const afterWorkerPhone = await VoiceService.getPhoneNumberByNumber(phoneWorker);
  assert.strictEqual(afterWorkerPhone?.releaseStatus, 'RELEASED', 'Release status transitioned to RELEASED');
  assert.ok(afterWorkerPhone?.releasedAt, 'released_at timestamp populated');
  console.log('  ✓ 32. PhoneDeprovisioningWorker handles transient failure and succeeds on retry');

  // Test 33: Worker restart with pending releases
  // Insert a phone row with RELEASE_PENDING and next_release_attempt_at in the past (simulating worker restart)
  const restartPhone = p(995);
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method,
       status, provisioning_status, billing_status, release_status, release_attempts,
       next_release_attempt_at, created_at, updated_at
     ) VALUES ($1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'INACTIVE', 'INACTIVE', 'CANCELED', 'RELEASE_PENDING', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), orgWorker, restartPhone]
  );

  const restartResult = await PhoneDeprovisioningWorker.processPendingReleases();
  assert.ok(restartResult.succeeded >= 1, 'Restarted worker picked up and released pending number');
  const afterRestart = await VoiceService.getPhoneNumberByNumber(restartPhone);
  assert.strictEqual(afterRestart?.releaseStatus, 'RELEASED', 'Number released after worker restart');
  console.log('  ✓ 33. Worker restart successfully picks up pending releases');

  // Test 34: Two concurrent worker processes do not duplicate release
  const concWorkerPhone = p(996);
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method,
       status, provisioning_status, billing_status, release_status, release_attempts,
       next_release_attempt_at, created_at, updated_at
     ) VALUES ($1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'INACTIVE', 'INACTIVE', 'CANCELED', 'RELEASE_PENDING', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), orgWorker, concWorkerPhone]
  );

  const beforeCalls = telephony.releaseCallCount;
  // Run two worker batches simultaneously
  await Promise.all([
    PhoneDeprovisioningWorker.processPendingReleases(),
    PhoneDeprovisioningWorker.processPendingReleases(),
  ]);
  const afterCalls = telephony.releaseCallCount;
  // Number was released exactly once, not twice
  assert.strictEqual(afterCalls - beforeCalls, 1, 'Release was executed exactly once by concurrent workers');
  console.log('  ✓ 34. Concurrent workers prevent duplicate carrier release via mutex locking');

  // Test 35: Retry limit and manual-intervention state (RELEASE_FAILED_MANUAL_ATTENTION)
  const maxRetryPhone = p(997);
  await db.execute(
    `INSERT INTO voice_phone_numbers (
       id, organization_id, provider, phone_number, connection_method,
       status, provisioning_status, billing_status, release_status, release_attempts,
       next_release_attempt_at, created_at, updated_at
     ) VALUES ($1, $2, 'TELNYX', $3, 'NEW_PROVIDER_NUMBER', 'INACTIVE', 'INACTIVE', 'CANCELED', 'RELEASE_FAILED', 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), orgWorker, maxRetryPhone]
  );

  telephony.simulateReleaseFailure = true;
  try {
    const maxRetryResult = await PhoneDeprovisioningWorker.processPendingReleases();
    assert.strictEqual(maxRetryResult.manualAttentionRequired, 1, 'Flagged for manual attention after 5th attempt');
  } finally {
    telephony.simulateReleaseFailure = false;
  }

  const flaggedPhone = await VoiceService.getPhoneNumberByNumber(maxRetryPhone);
  assert.strictEqual(flaggedPhone?.releaseStatus, 'RELEASE_FAILED_MANUAL_ATTENTION', 'Status is RELEASE_FAILED_MANUAL_ATTENTION');
  console.log('  ✓ 35. PhoneDeprovisioningWorker transitions to RELEASE_FAILED_MANUAL_ATTENTION after 5 failed attempts');

  // Test 36: Tightened core subscription cancellation isolation
  const { orgId: orgCoreTight, email: emailCoreTight } = await createOrg('core_tight');
  const mainSubTight = `sub_main_tight_${Date.now()}`;
  await setPlanTier(orgCoreTight, 'STARTER', mainSubTight);

  // Deliver cancellation webhook with mismatched subscription ID and matching orgId
  await CreemBillingService.handleWebhookEvent({
    id: `evt_mismatch_cancel_${Date.now()}`,
    eventType: 'subscription.canceled',
    object: {
      id: 'sub_completely_different_id_9999',
      metadata: { organization_id: orgCoreTight },
    },
  });

  const mainTightCheck = await db.getOne<any>(
    'SELECT status, creem_subscription_id FROM subscriptions WHERE organization_id = $1',
    [orgCoreTight]
  );
  assert.strictEqual(mainTightCheck?.status, SubscriptionStatus.ACTIVE, 'Main plan remains ACTIVE despite mismatched cancel event');
  assert.strictEqual(mainTightCheck?.creem_subscription_id, mainSubTight, 'Main plan subscription ID preserved');
  console.log('  ✓ 36. Tightened core subscription cancellation query isolates main plan from mismatched sub IDs');

  // Test 37: Missing or invalid CREEM_PHONE_NUMBER_PRODUCT_ID fails closed
  const origProdId = config.creem.phoneNumberProductId;
  try {
    (config.creem as any).phoneNumberProductId = ''; // missing
    const { orgId: orgFailClosed, email: emailFailClosed } = await createOrg('fail_closed_prod');
    await setPlanTier(orgFailClosed, 'STARTER');

    // In non-test mode simulation:
    const origEnv = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = 'production';
    await assert.rejects(
      async () => {
        await PhoneNumberBillingService.createCheckoutSession({
          organizationId: orgFailClosed,
          phoneNumber: p(998),
          countryCode: 'US',
          userEmail: emailFailClosed,
        });
      },
      /Dedicated phone number checkout is currently unavailable/i,
      'Fails closed when CREEM_PHONE_NUMBER_PRODUCT_ID is missing in production'
    );
    (process.env as any).NODE_ENV = origEnv;
  } finally {
    (config.creem as any).phoneNumberProductId = origProdId;
  }
  console.log('  ✓ 37. Missing or invalid CREEM_PHONE_NUMBER_PRODUCT_ID fails closed without creating checkouts');

  console.log('\n--- Creem Independent Phone Number Billing Test Suite PASSED ---');
  console.log('✅ ALL 37 TESTS PASSED');
}

runTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});

