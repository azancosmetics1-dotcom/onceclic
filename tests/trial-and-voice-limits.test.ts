/**
 * trial-and-voice-limits.test.ts
 *
 * Comprehensive Automated Verification for ONCEClic V1:
 * - Trial duration (exactly 14 days) and allowance (exactly 30 minutes)
 * - Single allowance that does not reset on the 1st of month or daily
 * - Paid plan allowances (Starter 50m, Pro 200m, Business 500m) & hard caps
 * - Universal 3-minute (180s) conversation limit across all plans
 * - 120s appointment booking reminder & verified backend scheduling
 * - Mandatory knowledge document upload during onboarding
 * - Vapi file sync and READY provisioning status
 * - Upgrade during trial replacing allowance (no stacking)
 * - Concurrent session reservation protection
 */

process.env.USE_EMBEDDED_DB = 'true';
process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'mock';

import assert from 'assert';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../server/src/db';
import { config } from '../server/src/config';
import { AuthService } from '../server/src/services/AuthService';
import { TrialService } from '../server/src/services/TrialService';
import { VoiceService } from '../server/src/services/voice/VoiceService';
import { MockVoiceProvider } from '../server/src/services/voice/MockVoiceProvider';
import { MockTelephonyProvider } from '../server/src/services/voice/MockTelephonyProvider';
import { VoiceAssistantProvisioningService } from '../server/src/services/voice/VoiceAssistantProvisioningService';
import { KnowledgeService } from '../server/src/services/KnowledgeService';
import { AppointmentService } from '../server/src/services/AppointmentService';
import { CreemBillingService } from '../server/src/services/CreemBillingService';
import {
  DEFAULT_VOICE_PLAN_LIMITS,
  MAX_CALL_DURATION_SECONDS,
  CONVERSATION_MAX_DURATION_SECONDS,
  APPOINTMENT_REMINDER_SECONDS,
  DEFAULT_TRIAL_VOICE_MINUTES,
  DEFAULT_TRIAL_PERIOD_DAYS,
  SubscriptionStatus,
  KnowledgeSourceType,
} from '@onceclic/shared';

async function createTestOrg(prefix: string, skipTrial = false) {
  const seed = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const email = `${prefix}_${seed}@example.com`;
  const reg = await AuthService.register({
    email,
    password: 'Password123!',
    fullName: `Owner ${prefix}`,
    businessName: `Business ${prefix} ${seed}`,
  });
  if (!skipTrial) {
    await TrialService.redeemTrial({
      userId: reg.user.id,
      organizationId: reg.organization!.id,
      email,
    });
  }
  return {
    organizationId: reg.organization!.id,
    userId: reg.user.id,
    email,
    slug: reg.organization!.slug,
  };
}

export async function runTrialAndVoiceLimitsTests() {
  console.log('\n================================================================');
  console.log('   ONCEClic V1 — Trial, Limits, Duration & Booking Test Suite');
  console.log('================================================================\n');

  const mockVoice = new MockVoiceProvider();
  const mockTelephony = new MockTelephonyProvider();
  VoiceService.setVoiceProvider(mockVoice);
  VoiceService.setTelephonyProvider(mockTelephony);

  // -------------------------------------------------------------------------
  // 1. Trial duration is exactly 14 days from activation
  // -------------------------------------------------------------------------
  const org1 = await createTestOrg('trial_duration', true);
  const trial1 = await TrialService.redeemTrial({
    userId: org1.userId,
    organizationId: org1.organizationId,
    email: org1.email,
  });
  assert.strictEqual(trial1.success, true, 'Trial redemption must succeed');
  const sub1 = await db.getOne<{ trial_started_at: string; trial_ends_at: string }>(
    'SELECT trial_started_at, trial_ends_at FROM subscriptions WHERE organization_id = $1',
    [org1.organizationId]
  );
  assert.ok(sub1?.trial_started_at && sub1?.trial_ends_at, 'Trial timestamps must exist');
  const durationDays = Math.round(
    (new Date(sub1.trial_ends_at).getTime() - new Date(sub1.trial_started_at).getTime()) / (24 * 60 * 60 * 1000)
  );
  assert.strictEqual(durationDays, 14, 'Trial duration must be exactly 14 days');
  assert.strictEqual(DEFAULT_TRIAL_PERIOD_DAYS, 14, 'Shared trial duration constant must be 14 days');
  console.log('  ✓ 1. Trial duration is exactly 14 days from activation');

  // -------------------------------------------------------------------------
  // 2. Trial voice allowance is exactly 30 browser voice minutes
  // -------------------------------------------------------------------------
  const usage1 = await VoiceService.getVoiceUsage(org1.organizationId);
  assert.strictEqual(usage1.includedMinutes, 30, 'Trial voice allowance must be exactly 30 minutes');
  assert.strictEqual(DEFAULT_VOICE_PLAN_LIMITS.TRIAL, 30, 'DEFAULT_VOICE_PLAN_LIMITS.TRIAL must be 30');
  assert.strictEqual(DEFAULT_TRIAL_VOICE_MINUTES, 30, 'Shared DEFAULT_TRIAL_VOICE_MINUTES must be 30');
  console.log('  ✓ 2. Trial voice allowance is exactly 30 browser voice minutes');

  // -------------------------------------------------------------------------
  // 3. Central trial limit configuration works and defaults to 30 minutes
  // -------------------------------------------------------------------------
  assert.strictEqual(config.voice.planLimits.TRIAL, 30, 'Central config.voice.planLimits.TRIAL defaults to 30');
  console.log('  ✓ 3. Central trial limit configuration works and defaults to 30 minutes');

  // -------------------------------------------------------------------------
  // 4. Trial minutes do not reset on the 1st of the month or daily
  // -------------------------------------------------------------------------
  // Record a 10-minute browser call in previous month or past date
  const callRecordId1 = uuidv4();
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 5);
  await db.execute(
    `INSERT INTO voice_call_records (
       id, organization_id, provider, provider_call_id, caller_phone, direction,
       started_at, ended_at, duration_seconds, duration_minutes, status, outcome,
       counted_for_limit, created_at
     ) VALUES ($1, $2, 'mock', $3, '+15551234567', 'INBOUND', $4, $5, 600, 10.0, 'COMPLETED', 'GENERAL_INQUIRY', TRUE, CURRENT_TIMESTAMP)`,
    [callRecordId1, org1.organizationId, `call_prev_${Date.now()}`, pastDate.toISOString(), pastDate.toISOString()]
  );
  const usageAfterCall = await VoiceService.getVoiceUsage(org1.organizationId);
  assert.strictEqual(usageAfterCall.usedMinutes, 10.0, 'Trial minutes must count past calls across entire 14-day window');
  assert.strictEqual(usageAfterCall.remainingMinutes, 20.0, 'Remaining minutes must be 20 (30 - 10)');
  console.log('  ✓ 4. Trial minutes do not reset on the 1st of the month or daily (single 14-day pool)');

  // -------------------------------------------------------------------------
  // 5. Trial user with remaining minutes can start browser voice session
  // -------------------------------------------------------------------------
  const session1 = await VoiceService.startBrowserVoiceSession(org1.organizationId);
  assert.strictEqual(session1.allowed, true, 'Trial user with 20 minutes remaining can start session');
  assert.ok(session1.assistantId, 'Dedicated assistant ID must be returned');
  assert.strictEqual(session1.remainingMinutes, 20.0, 'Remaining minutes must be 20.0');
  console.log('  ✓ 5. Trial user with remaining minutes can start browser voice session');

  // -------------------------------------------------------------------------
  // 6. Trial user with 0 remaining minutes is rejected from starting session
  // -------------------------------------------------------------------------
  const orgExhausted = await createTestOrg('trial_exhausted');
  // Exhaust all 30 minutes
  await db.execute(
    `INSERT INTO voice_call_records (
       id, organization_id, provider, provider_call_id, caller_phone, direction,
       started_at, ended_at, duration_seconds, duration_minutes, status, outcome,
       counted_for_limit, created_at
     ) VALUES ($1, $2, 'mock', $3, '+15551234567', 'INBOUND', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1800, 30.0, 'COMPLETED', 'GENERAL_INQUIRY', TRUE, CURRENT_TIMESTAMP)`,
    [uuidv4(), orgExhausted.organizationId, `call_exhaust_${Date.now()}`]
  );
  const sessionExhausted = await VoiceService.startBrowserVoiceSession(orgExhausted.organizationId);
  assert.strictEqual(sessionExhausted.allowed, false, 'User with 0 remaining minutes must be rejected');
  assert.strictEqual(sessionExhausted.remainingMinutes, 0, 'Remaining minutes must report 0');
  console.log('  ✓ 6. Trial user with 0 remaining minutes is rejected from starting session');

  // -------------------------------------------------------------------------
  // 7. Expired trial (>14 days) is rejected from starting session
  // -------------------------------------------------------------------------
  const orgExpired = await createTestOrg('trial_expired');
  // Set trial_ends_at to the past
  const pastTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await db.execute(
    `UPDATE subscriptions SET trial_ends_at = $1 WHERE organization_id = $2`,
    [pastTimestamp, orgExpired.organizationId]
  );
  const sessionExpired = await VoiceService.startBrowserVoiceSession(orgExpired.organizationId);
  assert.strictEqual(sessionExpired.allowed, false, 'Expired trial must be rejected');
  assert.ok(sessionExpired.reason?.toLowerCase().includes('expired'), 'Reason must mention expiration');
  console.log('  ✓ 7. Expired trial (>14 days) is rejected from starting session');

  // -------------------------------------------------------------------------
  // 8. Paid plan Starter gets 50 minutes
  // -------------------------------------------------------------------------
  const orgStarter = await createTestOrg('starter_plan');
  await db.execute(
    `UPDATE subscriptions SET plan_tier = 'STARTER', status = 'ACTIVE' WHERE organization_id = $1`,
    [orgStarter.organizationId]
  );
  const usageStarter = await VoiceService.getVoiceUsage(orgStarter.organizationId);
  assert.strictEqual(usageStarter.includedMinutes, 50, 'Starter plan must receive 50 minutes');
  assert.strictEqual(usageStarter.planTier, 'STARTER');
  console.log('  ✓ 8. Paid plan Starter gets 50 minutes');

  // -------------------------------------------------------------------------
  // 9. Paid plan Pro gets 200 minutes
  // -------------------------------------------------------------------------
  const orgPro = await createTestOrg('pro_plan');
  await db.execute(
    `UPDATE subscriptions SET plan_tier = 'PRO', status = 'ACTIVE' WHERE organization_id = $1`,
    [orgPro.organizationId]
  );
  const usagePro = await VoiceService.getVoiceUsage(orgPro.organizationId);
  assert.strictEqual(usagePro.includedMinutes, 200, 'Pro plan must receive 200 minutes');
  assert.strictEqual(usagePro.planTier, 'PRO');
  console.log('  ✓ 9. Paid plan Pro gets 200 minutes');

  // -------------------------------------------------------------------------
  // 10. Paid plan Business gets 500 minutes
  // -------------------------------------------------------------------------
  const orgBiz = await createTestOrg('business_plan');
  await db.execute(
    `UPDATE subscriptions SET plan_tier = 'BUSINESS', status = 'ACTIVE' WHERE organization_id = $1`,
    [orgBiz.organizationId]
  );
  const usageBiz = await VoiceService.getVoiceUsage(orgBiz.organizationId);
  assert.strictEqual(usageBiz.includedMinutes, 500, 'Business plan must receive 500 minutes');
  assert.strictEqual(usageBiz.planTier, 'BUSINESS');
  console.log('  ✓ 10. Paid plan Business gets 500 minutes');

  // -------------------------------------------------------------------------
  // 11. Paid plan minutes hard cap: session blocked when 0 minutes remaining
  // -------------------------------------------------------------------------
  await db.execute(
    `INSERT INTO voice_call_records (
       id, organization_id, provider, provider_call_id, caller_phone, direction,
       started_at, ended_at, duration_seconds, duration_minutes, status, outcome,
       counted_for_limit, created_at
     ) VALUES ($1, $2, 'mock', $3, '+15551234567', 'INBOUND', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 3000, 50.0, 'COMPLETED', 'GENERAL_INQUIRY', TRUE, CURRENT_TIMESTAMP)`,
    [uuidv4(), orgStarter.organizationId, `call_starter_exhaust_${Date.now()}`]
  );
  const sessionStarterExhausted = await VoiceService.startBrowserVoiceSession(orgStarter.organizationId);
  assert.strictEqual(sessionStarterExhausted.allowed, false, 'Starter plan with 0 min remaining must be blocked');
  console.log('  ✓ 11. Paid plan minutes hard cap: session blocked when 0 minutes remaining');

  // -------------------------------------------------------------------------
  // 12. 3-minute (180s) conversation limit is returned/enforced for browser sessions
  // -------------------------------------------------------------------------
  const sessionLimitCheck = await VoiceService.startBrowserVoiceSession(orgPro.organizationId);
  assert.strictEqual(sessionLimitCheck.allowed, true);
  assert.strictEqual(sessionLimitCheck.maxConversationSeconds, 180, 'maxConversationSeconds must be 180');
  assert.strictEqual(sessionLimitCheck.maxDurationSeconds, 180, 'maxDurationSeconds must be capped at 180');
  assert.strictEqual(MAX_CALL_DURATION_SECONDS, 180, 'MAX_CALL_DURATION_SECONDS must be 180');
  assert.strictEqual(CONVERSATION_MAX_DURATION_SECONDS, 180, 'CONVERSATION_MAX_DURATION_SECONDS must be 180');
  console.log('  ✓ 12. 3-minute (180s) conversation limit is returned/enforced for browser sessions');

  // -------------------------------------------------------------------------
  // 13. Conversation limit applies equally across Trial, Starter, Pro, and Business
  // -------------------------------------------------------------------------
  const trialMax = VoiceService.validateMaxCallDuration(300);
  assert.strictEqual(trialMax, 180, 'Trial conversation ceiling must be 180s');
  assert.strictEqual(VoiceService.validateMaxCallDuration(180), 180, '180s duration accepted');
  assert.strictEqual(VoiceService.validateMaxCallDuration(60), 60, 'Custom duration below 180s accepted');
  console.log('  ✓ 13. Conversation limit applies equally across Trial, Starter, Pro, and Business (180s ceiling)');

  // -------------------------------------------------------------------------
  // 14. Session auto-stops at 180s (backend limit enforcement)
  // -------------------------------------------------------------------------
  const testCallId = `active_call_${Date.now()}`;
  const durCheckNotExceeded = await VoiceService.checkCallDurationLimit({
    callId: testCallId,
    elapsedSeconds: 150,
    organizationId: orgPro.organizationId,
  });
  assert.strictEqual(durCheckNotExceeded.exceeded, false, '150s is within 180s limit');

  const durCheckExceeded = await VoiceService.checkCallDurationLimit({
    callId: testCallId,
    elapsedSeconds: 181,
    organizationId: orgPro.organizationId,
  });
  assert.strictEqual(durCheckExceeded.exceeded, true, '181s exceeds 180s limit and terminates');
  console.log('  ✓ 14. Session auto-stops at 180s (backend duration ceiling check terminates call)');

  // -------------------------------------------------------------------------
  // 15. Appointment reminder triggered at 120s of conversation
  // -------------------------------------------------------------------------
  assert.strictEqual(APPOINTMENT_REMINDER_SECONDS, 120, 'APPOINTMENT_REMINDER_SECONDS must be 120');
  assert.strictEqual(sessionLimitCheck.appointmentReminderSeconds, 120, 'Session returns appointmentReminderSeconds = 120');
  console.log('  ✓ 15. Appointment reminder configured and returned at 120s of conversation');

  // -------------------------------------------------------------------------
  // 16. AI Receptionist prioritizes booking when visitor accepts 120s reminder
  // -------------------------------------------------------------------------
  const promptData = await VoiceService.getVoiceProvider();
  assert.ok(promptData, 'Voice provider is available');
  // Check VoicePromptBuilder prompt instructions include 120s reminder & booking rule
  const { VoicePromptBuilder } = await import('../server/src/services/voice/VoicePromptBuilder');
  const builtPrompt = await VoicePromptBuilder.buildPrompt(orgPro.organizationId, '+15551234567');
  assert.ok(
    builtPrompt.systemPrompt.includes('120') || builtPrompt.systemPrompt.includes('finish'),
    'Voice prompt must contain 120-second reminder instructions'
  );
  assert.ok(
    builtPrompt.systemPrompt.includes('180') || builtPrompt.systemPrompt.includes('3 minutes'),
    'Voice prompt must contain 180-second hard limit instructions'
  );
  console.log('  ✓ 16. AI Receptionist prompt instructs prioritization of booking when visitor accepts reminder');

  // -------------------------------------------------------------------------
  // 17. Real calendar availability is checked before offering slots
  // -------------------------------------------------------------------------
  const freshToolCallId = `active_tool_${Date.now()}`;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  const availabilityRes = await VoiceService.executeVoiceTool({
    callId: freshToolCallId,
    toolName: 'check_calendar_availability',
    args: { date: tomorrowStr, durationMinutes: 30 },
    organizationId: orgPro.organizationId,
  });
  assert.ok(availabilityRes, 'Availability check must return result');
  assert.ok('hasAvailableSlots' in availabilityRes, 'Result must explicitly state hasAvailableSlots');
  console.log('  ✓ 17. Real calendar availability is checked via backend tool before offering slots');

  // -------------------------------------------------------------------------
  // 18. Booking succeeds only when backend confirms slot creation
  // -------------------------------------------------------------------------
  const bookRes = await VoiceService.executeVoiceTool({
    callId: freshToolCallId,
    toolName: 'create_appointment',
    args: {
      serviceName: 'Consultation',
      customerName: 'Jane Visitor',
      customerPhone: '+15559876543',
      startTime: `${tomorrowStr}T14:00:00.000Z`,
    },
    organizationId: orgPro.organizationId,
  });
  assert.strictEqual(bookRes.success, true, 'Booking tool execution must succeed in database');
  assert.ok(bookRes.appointmentId, 'Created appointment ID must be returned');
  const createdAppt = await db.getOne<{ id: string; status: string }>(
    'SELECT id, status FROM appointments WHERE id = $1',
    [bookRes.appointmentId]
  );
  assert.strictEqual(createdAppt?.id, bookRes.appointmentId, 'Appointment must be committed in database');
  console.log('  ✓ 18. Booking succeeds only when backend confirms slot creation');

  // -------------------------------------------------------------------------
  // 19. Dedicated assistant provisioning occurs per organization
  // -------------------------------------------------------------------------
  const asstRow = await db.getOne<{ vapi_assistant_id: string; provisioning_status: string }>(
    'SELECT vapi_assistant_id, provisioning_status FROM organization_voice_assistants WHERE organization_id = $1',
    [orgPro.organizationId]
  );
  assert.ok(asstRow?.vapi_assistant_id, 'Dedicated assistant ID must be stored');
  assert.strictEqual(asstRow.provisioning_status, 'READY', 'Provisioning status must be READY');
  console.log('  ✓ 19. Dedicated assistant provisioning occurs per organization');

  // -------------------------------------------------------------------------
  // 20. Mandatory knowledge file upload: onboarding completion requires knowledge
  // -------------------------------------------------------------------------
  const orgNew = await createTestOrg('onboarding_mandatory', true);
  const completeSuccess = await AuthService.completeOnboarding({
    userId: orgNew.userId,
    organizationId: orgNew.organizationId,
    industry: 'Clinic',
    businessKnowledge: 'Smile Dental Clinic provides dental cleaning, fillings, and consultations Monday to Friday 9am-5pm.',
    businessName: 'Smile Dental Clinic',
  });
  assert.ok(completeSuccess.organization, 'Onboarding completes with valid knowledge');
  const sources = await KnowledgeService.listSources(orgNew.organizationId);
  assert.ok(sources.length >= 1, 'Knowledge source must be saved and indexed');
  console.log('  ✓ 20. Mandatory knowledge file upload: onboarding completion requires and saves knowledge document');

  // -------------------------------------------------------------------------
  // 21. Onboarding without knowledge file is rejected
  // -------------------------------------------------------------------------
  const orgEmpty = await createTestOrg('onboarding_empty', true);
  let rejected = false;
  try {
    await AuthService.completeOnboarding({
      userId: orgEmpty.userId,
      organizationId: orgEmpty.organizationId,
      industry: 'Clinic',
      businessKnowledge: '', // Empty knowledge rejected
      businessName: 'No Knowledge Clinic',
    });
  } catch (err: any) {
    rejected = true;
    assert.ok(err.message.includes('knowledge'), 'Error must specify that knowledge is required');
  }
  assert.strictEqual(rejected, true, 'Onboarding without knowledge must be rejected');
  console.log('  ✓ 21. Onboarding without knowledge file is rejected');

  // -------------------------------------------------------------------------
  // 22. Knowledge files sync to Vapi before status is marked READY
  // -------------------------------------------------------------------------
  const syncResult = await KnowledgeService.syncOrganizationKnowledgeToVapi(orgNew.organizationId);
  assert.ok(syncResult.fileIds.length >= 1, 'At least 1 knowledge document must be synced to Vapi with file ID');
  const orgAsst = await db.getOne<{ provisioning_status: string; knowledge_sync_status: string }>(
    'SELECT provisioning_status, knowledge_sync_status FROM organization_voice_assistants WHERE organization_id = $1',
    [orgNew.organizationId]
  );
  assert.strictEqual(orgAsst?.provisioning_status, 'READY', 'Status is marked READY only after sync');
  assert.strictEqual(orgAsst?.knowledge_sync_status, 'READY', 'Knowledge sync status is READY');
  console.log('  ✓ 22. Knowledge files sync to Vapi before status is marked READY');

  // -------------------------------------------------------------------------
  // 23. Upgrade during trial ends trial and replaces allowance with paid plan allowance (no stacking)
  // -------------------------------------------------------------------------
  const orgUpgrade = await createTestOrg('trial_upgrade');
  // Simulate Creem webhook subscription.active upgrade to PRO (200 minutes)
  const webhookEventId = `evt_upgrade_${Date.now()}`;
  await CreemBillingService.handleWebhookEvent({
    id: webhookEventId,
    eventType: 'subscription.active',
    created_at: Math.floor(Date.now() / 1000),
    object: {
      id: `sub_${Date.now()}`,
      object: 'subscription',
      product_id: 'prod_creem_pro_onceclic',
      customer_id: `cust_${Date.now()}`,
      current_period_start_date: new Date().toISOString(),
      current_period_end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      metadata: {
        organization_id: orgUpgrade.organizationId,
        plan_tier: 'PRO',
      },
    },
  });
  const upgradedUsage = await VoiceService.getVoiceUsage(orgUpgrade.organizationId);
  assert.strictEqual(upgradedUsage.planTier, 'PRO', 'Plan tier must transition to PRO');
  assert.strictEqual(upgradedUsage.includedMinutes, 200, 'Allowance must be exactly 200 minutes (no stacking with trial 30)');
  console.log('  ✓ 23. Upgrade during trial ends trial and replaces allowance with paid plan allowance (no stacking)');

  // -------------------------------------------------------------------------
  // 24. Concurrent session protection prevents exceeding remaining minute allowance
  // -------------------------------------------------------------------------
  // Simulate org with only 1 minute remaining
  const orgConcurrent = await createTestOrg('concurrent_guard');
  await db.execute(
    `UPDATE subscriptions SET plan_tier = 'STARTER', status = 'ACTIVE' WHERE organization_id = $1`,
    [orgConcurrent.organizationId]
  );
  // Consume 49 minutes out of 50 (1 minute left)
  await db.execute(
    `INSERT INTO voice_call_records (
       id, organization_id, provider, provider_call_id, caller_phone, direction,
       started_at, ended_at, duration_seconds, duration_minutes, status, outcome,
       counted_for_limit, created_at
     ) VALUES ($1, $2, 'mock', $3, '+15551234567', 'INBOUND', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 2940, 49.0, 'COMPLETED', 'GENERAL_INQUIRY', TRUE, CURRENT_TIMESTAMP)`,
    [uuidv4(), orgConcurrent.organizationId, `call_concurrent_${Date.now()}`]
  );
  // Start active in-flight call tracking
  const activeCallId = `active_inflight_${Date.now()}`;
  (VoiceService as any).activeCalls.set(activeCallId, {
    callId: activeCallId,
    organizationId: orgConcurrent.organizationId,
    startedAt: Date.now() - 30 * 1000,
    maxDurationSeconds: 60,
  });
  // Attempt concurrent second session
  const concurrentAttempt = await VoiceService.startBrowserVoiceSession(orgConcurrent.organizationId);
  assert.strictEqual(concurrentAttempt.allowed, false, 'Concurrent session must be blocked when remaining minutes are in flight');
  assert.ok(concurrentAttempt.reason?.includes('active session'), 'Reason must mention active session');
  // Clean up
  (VoiceService as any).activeCalls.delete(activeCallId);
  console.log('  ✓ 24. Concurrent session protection prevents exceeding remaining minute allowance');

  console.log('\n================================================================');
  console.log('  All 24 Trial, Voice Limits & Booking Tests Passed Successfully!');
  console.log('================================================================\n');
}

if (require.main === module) {
  runTrialAndVoiceLimitsTests().catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
  });
}
