import assert from 'assert';
import { db } from '../server/src/db';
import { config } from '../server/src/config';
import { DEFAULT_VOICE_PLAN_LIMITS, SubscriptionStatus, VoiceConnectionMethod } from '../shared/src';
import { VoiceService } from '../server/src/services/voice/VoiceService';
import { PaddleBillingService } from '../server/src/services/PaddleBillingService';
import { toCustomerBillingConfig } from '../server/src/serializers/customerSerializers';
import { v4 as uuidv4 } from 'uuid';

export async function runMigrationAndPricingSafetyTests(): Promise<void> {
  console.log('\n--- Running Pre-Deployment Migration, Pricing & Safety Verification Tests ---');

  // ==========================================
  // 1. Fresh Database Migration Initialization
  // ==========================================
  console.log('\n[1. Fresh DB Migration Sequence]');
  await db.runMigrations();
  console.log('  ✓ 1. Initial migration sequence executed cleanly.');

  // ==========================================
  // 2. Existing Data Preservation Test
  // ==========================================
  console.log('\n[2. Existing Customer Data Preservation]');
  const testOrgId = uuidv4();
  const testUserId = uuidv4();
  const testSubId = uuidv4();
  const testApptId = uuidv4();
  const testConvId = uuidv4();

  await db.execute(
    `INSERT INTO organizations (id, name, slug, business_type, is_active, created_at, updated_at)
     VALUES ($1, 'Acme Clinic', 'acme-clinic', 'dental_clinic', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [testOrgId]
  );

  await db.execute(
    `INSERT INTO users (id, email, full_name, password_hash, is_email_verified, created_at, updated_at)
     VALUES ($1, 'doctor@acmeclinic.com', 'Dr. Acme', 'hashed_pw', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [testUserId]
  );

  await db.execute(
    `INSERT INTO organization_memberships (id, organization_id, user_id, role, created_at, updated_at)
     VALUES ($1, $2, $3, 'OWNER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), testOrgId, testUserId]
  );

  await db.execute(
    `INSERT INTO subscriptions (id, organization_id, status, trial_started_at, trial_ends_at, cancel_at_period_end, created_at, updated_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [testSubId, testOrgId, SubscriptionStatus.ACTIVE]
  );

  await db.execute(
    `INSERT INTO appointments (id, organization_id, customer_name, customer_email, service_name, start_time, end_time, status, created_at, updated_at)
     VALUES ($1, $2, 'Alice Smith', 'alice@example.com', 'Dental Checkup', '2026-10-15T10:00:00Z', '2026-10-15T10:30:00Z', 'CONFIRMED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [testApptId, testOrgId]
  );

  await db.execute(
    `INSERT INTO conversations (id, organization_id, channel, customer_name, status, created_at, updated_at)
     VALUES ($1, $2, 'WEB', 'Alice Visitor', 'OPEN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [testConvId, testOrgId]
  );

  // Now apply migration again to simulate deployment over existing data
  await db.runMigrations();

  // Verify all pre-existing records survive intact
  const orgCheck = await db.getOne<{ name: string }>('SELECT name FROM organizations WHERE id = $1', [testOrgId]);
  const userCheck = await db.getOne<{ email: string }>('SELECT email FROM users WHERE id = $1', [testUserId]);
  const subCheck = await db.getOne<{ status: string }>('SELECT status FROM subscriptions WHERE id = $1', [testSubId]);
  const apptCheck = await db.getOne<{ customer_name: string }>('SELECT customer_name FROM appointments WHERE id = $1', [testApptId]);
  const convCheck = await db.getOne<{ channel: string }>('SELECT channel FROM conversations WHERE id = $1', [testConvId]);

  assert.strictEqual(orgCheck?.name, 'Acme Clinic', 'Organization data preserved');
  assert.strictEqual(userCheck?.email, 'doctor@acmeclinic.com', 'User data preserved');
  assert.strictEqual(subCheck?.status, SubscriptionStatus.ACTIVE, 'Subscription status preserved');
  assert.strictEqual(apptCheck?.customer_name, 'Alice Smith', 'Appointment preserved');
  assert.strictEqual(convCheck?.channel, 'WEB', 'Conversation preserved');
  console.log('  ✓ 2. 100% of existing customer rows preserved after re-running migrations.');

  // ==========================================
  // 3. Migration 014 Specific Voice Operations
  // ==========================================
  console.log('\n[3. Migration 014 Schema & Foreign Key Operations]');
  const phone = await VoiceService.connectExistingNumber({
    organizationId: testOrgId,
    phoneNumber: '+14155552671',
    connectionMethod: VoiceConnectionMethod.EXISTING_FORWARDING,
    userId: testUserId,
  });
  assert.ok(phone.id, 'Voice phone number created in migration 014 schema');

  const callRecord = await VoiceService.handleCallEnded({
    callId: `call_safety_${Date.now()}`,
    toNumber: '+14155552671',
    fromNumber: '+14155559999',
    durationSeconds: 120,
    durationMinutes: 2.0,
    transcript: 'AI: Hello! How can I help?\nCustomer: I would like to book a dental checkup.',
  });
  assert.ok(callRecord.id, 'Call record stored in voice_call_records');
  assert.strictEqual(callRecord.durationMinutes, 2.0, '2 minutes recorded');
  console.log('  ✓ 3. Migration 014 voice tables and foreign keys fully operational.');

  // ==========================================
  // 4. Pricing & Plan Limit Consistency
  // ==========================================
  console.log('\n[4. Pricing & Voice Plan Limit Consistency]');
  assert.strictEqual(DEFAULT_VOICE_PLAN_LIMITS.TRIAL, 15, 'Trial voice limit is 15 minutes');
  assert.strictEqual(DEFAULT_VOICE_PLAN_LIMITS.STARTER, 50, 'Starter voice limit is 50 minutes');
  assert.strictEqual(DEFAULT_VOICE_PLAN_LIMITS.PRO, 150, 'Pro voice limit is 150 minutes');
  assert.strictEqual(DEFAULT_VOICE_PLAN_LIMITS.BUSINESS, 400, 'Business voice limit is 400 minutes');

  const customerBilling = toCustomerBillingConfig(config);
  assert.strictEqual(customerBilling.monthlyPriceUsd, 19, 'Core customer billing is $19/mo');
  assert.strictEqual(customerBilling.trialPeriodDays, 7, 'Trial period is 7 days');
  assert.strictEqual(customerBilling.trialPriceUsd, 0, 'Trial price is $0');
  assert.ok(!JSON.stringify(customerBilling).includes('0.50'), 'Internal AI budgets NOT leaked');
  assert.ok(!JSON.stringify(customerBilling).includes('10.00'), 'Internal Pro AI budgets NOT leaked');
  console.log('  ✓ 4. Plan limits and customer billing configurations are consistent.');

  console.log('\n--- Pre-Deployment Migration & Pricing Safety Tests Passed Successfully ---');
}
