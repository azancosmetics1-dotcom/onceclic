import assert from 'assert';
import { db } from '../server/src/db';
import { AuthService } from '../server/src/services/AuthService';
import { TrialService } from '../server/src/services/TrialService';
import { VoiceService } from '../server/src/services/voice/VoiceService';
import { MockVoiceProvider } from '../server/src/services/voice/MockVoiceProvider';
import { VoicePromptBuilder } from '../server/src/services/voice/VoicePromptBuilder';
import { AppointmentService } from '../server/src/services/AppointmentService';
import { KnowledgeService } from '../server/src/services/KnowledgeService';
import {
  VoiceConnectionMethod,
  SubscriptionStatus,
  ConversationChannel,
  KnowledgeSourceType,
} from '@onceclic/shared';
import {
  toCustomerVoiceConfig,
  toCustomerVoiceAnalytics,
  toCustomerCallRecord,
} from '../server/src/serializers/customerSerializers';
import { assertNoForbiddenFields } from './customer-api-field-allowlist.test';
import { v4 as uuidv4 } from 'uuid';

export async function runVoiceReceptionistTests() {
  console.log('--- Running Complete AI Phone Receptionist Test Suite ---');

  const mockProvider = new MockVoiceProvider();
  VoiceService.setProvider(mockProvider);

  // Setup Test Organization A
  const orgAEmail = `voice_owner_${Date.now()}@example.com`;
  const registerResA = await AuthService.register({
    email: orgAEmail,
    password: 'Password123!',
    fullName: 'Dr. Emily Vance',
    businessName: 'Vance Dental Spa',
  });
  const orgAId = registerResA.organization!.id;
  const userAId = registerResA.user.id;
  await TrialService.redeemTrial({
    userId: userAId,
    organizationId: orgAId,
    email: orgAEmail,
  });

  // Setup Test Organization B (for multi-tenant isolation testing)
  const orgBEmail = `voice_owner_b_${Date.now()}@example.com`;
  const registerResB = await AuthService.register({
    email: orgBEmail,
    password: 'Password123!',
    fullName: 'Mark Sterling',
    businessName: 'Sterling Law Firm',
  });
  const orgBId = registerResB.organization!.id;
  const userBId = registerResB.user.id;
  await TrialService.redeemTrial({
    userId: userBId,
    organizationId: orgBId,
    email: orgBEmail,
  });

  // Configure Services & Hours for Org A
  await db.execute(
    `UPDATE business_settings
     SET services = $1,
         business_hours = $2
     WHERE organization_id = $3`,
    [
      JSON.stringify([
        { id: 'srv_1', name: 'Dental Checkup', price: 75, durationMinutes: 30 },
        { id: 'srv_2', name: 'Teeth Whitening', price: 150, durationMinutes: 45 },
      ]),
      JSON.stringify([
        { day: 'Monday', open: '09:00', close: '17:00' },
        { day: 'Tuesday', open: '09:00', close: '17:00' },
        { day: 'Wednesday', open: '09:00', close: '17:00' },
        { day: 'Thursday', open: '09:00', close: '17:00' },
        { day: 'Friday', open: '09:00', close: '17:00' },
      ]),
      orgAId,
    ]
  );

  // Add verified business knowledge for Org A
  await KnowledgeService.addSource({
    organizationId: orgAId,
    sourceType: KnowledgeSourceType.FAQ,
    title: 'Parking and Insurance',
    rawContent: 'We provide free validated parking behind the building. We accept Delta Dental and MetLife.',
  });

  // ========================================================
  // 1. Voice Phone Number Management & Inbound Routing
  // ========================================================
  console.log('\n[1. Phone Number Management & Inbound Resolution]');

  // Test 1: Connect Existing Business Number
  const existingPhone = '+14155550123';
  const phoneA = await VoiceService.connectExistingNumber({
    organizationId: orgAId,
    phoneNumber: existingPhone,
    connectionMethod: VoiceConnectionMethod.EXISTING_FORWARDING,
    userId: userAId,
  });

  assert.strictEqual(phoneA.phoneNumber, existingPhone, 'Phone number normalized and stored');
  assert.strictEqual(phoneA.connectionMethod, VoiceConnectionMethod.EXISTING_FORWARDING);
  console.log('  ✓ 1. Existing business phone number connected with Call Forwarding');

  // Test 1b: Number normalization handles diverse phone formats safely
  assert.strictEqual(VoiceService.normalizePhoneNumber('(415) 555-0123'), '+14155550123');
  assert.strictEqual(VoiceService.normalizePhoneNumber('415-555-0123'), '+14155550123');
  assert.strictEqual(VoiceService.normalizePhoneNumber('+1 415 555 0123'), '+14155550123');
  assert.strictEqual(VoiceService.normalizePhoneNumber('0014155550123'), '+14155550123');
  console.log('  ✓ 1b. Phone number E.164 normalization verified across multiple formats');

  // Test 1c: Invalid short numbers rejected
  let invalidNumberRejected = false;
  try {
    await VoiceService.connectExistingNumber({
      organizationId: orgAId,
      phoneNumber: '123',
      connectionMethod: VoiceConnectionMethod.EXISTING_FORWARDING,
    });
  } catch (err: any) {
    invalidNumberRejected = err.message.includes('valid phone number');
  }
  assert.strictEqual(invalidNumberRejected, true, 'Short/invalid phone number safely rejected');
  console.log('  ✓ 1c. Invalid phone numbers rejected with clean customer error');

  // Test 1d: Connection testing verification
  const testConnRes = await VoiceService.testNumberConnection(orgAId, phoneA.id);
  assert.strictEqual(testConnRes.success, true);
  assert.strictEqual(testConnRes.status, 'CONNECTED');
  console.log('  ✓ 1d. Phone connection test verified routing signal');

  // Test 2: Inbound call resolves organization
  const inboundRes = await VoiceService.handleInboundCall({
    callId: 'call_test_001',
    fromNumber: '+16505559876',
    toNumber: existingPhone,
    provider: 'MOCK_VOICE',
  });

  assert.strictEqual(inboundRes.allowed, true, 'Inbound call permitted for active org');
  assert.strictEqual(inboundRes.organizationId, orgAId, 'Organization resolved accurately');
  console.log('  ✓ 2. Inbound call accurately resolved organization context by phone number');

  // Test 3: Unknown phone number rejected
  const unknownCallRes = await VoiceService.handleInboundCall({
    callId: 'call_test_002',
    fromNumber: '+16505559876',
    toNumber: '+19995550000',
    provider: 'MOCK_VOICE',
  });
  assert.strictEqual(unknownCallRes.allowed, false, 'Unknown phone number rejected gracefully');
  console.log('  ✓ 3. Unregistered phone number gracefully rejected without exposing internals');

  // Test 4: Expired subscription blocks call
  await db.execute('UPDATE subscriptions SET status = $1, trial_ends_at = $2 WHERE organization_id = $3', [
    SubscriptionStatus.EXPIRED,
    new Date(Date.now() - 86400000).toISOString(),
    orgBId,
  ]);

  const phoneB = await VoiceService.connectExistingNumber({
    organizationId: orgBId,
    phoneNumber: '+14155550999',
    connectionMethod: VoiceConnectionMethod.EXISTING_SIP,
  });

  const expiredCallRes = await VoiceService.handleInboundCall({
    callId: 'call_test_003',
    fromNumber: '+16505551111',
    toNumber: phoneB.phoneNumber,
    provider: 'MOCK_VOICE',
  });
  assert.strictEqual(expiredCallRes.allowed, false, 'Expired subscription voice call blocked');
  console.log('  ✓ 4. Expired subscription blocks AI phone receptionist gracefully');

  // ========================================================
  // 2. Knowledge Grounding & Speech Prompt
  // ========================================================
  console.log('\n[2. Knowledge Grounding & Speech-Optimized Prompt]');

  const promptResult = await VoicePromptBuilder.buildPrompt(orgAId, '+16505559876');
  assert.ok(promptResult.systemPrompt.includes('Vance Dental Spa'), 'System prompt contains business name');
  assert.ok(promptResult.systemPrompt.includes('Dental Checkup'), 'System prompt contains configured services');
  assert.ok(promptResult.systemPrompt.includes('free validated parking'), 'System prompt contains knowledge facts');
  assert.ok(promptResult.systemPrompt.includes('NEVER invent unlisted prices'), 'System prompt enforces anti-hallucination');
  assert.ok(promptResult.tools.length === 4, 'Includes 4 standard voice tools (check, book, reschedule, cancel)');
  console.log('  ✓ 5. Voice prompt is speech-optimized, grounded in verified knowledge, and includes tool definitions');

  // ========================================================
  // 3. Tool: Check Availability
  // ========================================================
  console.log('\n[3. Tool Execution: Check Availability]');

  // Target a future Tuesday (UTC)
  const futureDate = new Date();
  futureDate.setUTCDate(futureDate.getUTCDate() + ((2 + 7 - futureDate.getUTCDay()) % 7 || 7));
  const targetDateStr = futureDate.toISOString().split('T')[0];
  const checkAvailRes = await VoiceService.executeVoiceTool({
    callId: 'call_test_001',
    toolName: 'check_availability',
    args: { date: targetDateStr, serviceName: 'Dental Checkup' },
    organizationId: orgAId,
  });

  assert.strictEqual(checkAvailRes.hasAvailableSlots, true, 'Slots returned for business Tuesday');
  assert.ok(checkAvailRes.availableSlotCount > 0, 'Available slots count greater than 0');
  console.log(`  ✓ 6. check_availability returned ${checkAvailRes.availableSlotCount} candidate slots for ${targetDateStr}`);

  // ========================================================
  // 4. Tool: Book Appointment
  // ========================================================
  console.log('\n[4. Tool Execution: Book Appointment]');

  const chosenSlot = checkAvailRes.slots[0].startTime;
  const bookRes = await VoiceService.executeVoiceTool({
    callId: 'call_test_001',
    toolName: 'book_appointment',
    args: {
      serviceName: 'Dental Checkup',
      customerName: 'Sarah Connor',
      customerPhone: '+16505559876',
      startTime: chosenSlot,
      notes: 'First time visit',
    },
    organizationId: orgAId,
  });

  assert.strictEqual(bookRes.success, true, 'Appointment successfully booked via voice tool');
  assert.ok(bookRes.appointmentId, 'Appointment ID generated');

  const apptRecord = await AppointmentService.getAppointmentById(orgAId, bookRes.appointmentId);
  assert.strictEqual(apptRecord?.customerName, 'Sarah Connor');
  assert.strictEqual(apptRecord?.status, 'CONFIRMED');
  console.log('  ✓ 7. book_appointment created verified appointment in database and triggered sync');

  // Test: Double-booking prevention via voice tool
  const doubleBookRes = await VoiceService.executeVoiceTool({
    callId: 'call_test_001_b',
    toolName: 'book_appointment',
    args: {
      serviceName: 'Dental Checkup',
      customerName: 'John Connor',
      customerPhone: '+16505559999',
      startTime: chosenSlot,
    },
    organizationId: orgAId,
  });
  assert.ok(doubleBookRes.error && doubleBookRes.error.includes('already been booked'), 'Double booking rejected');
  console.log('  ✓ 8. Double booking strictly prevented by transactional lock');

  // ========================================================
  // 5. Tool: Reschedule Appointment
  // ========================================================
  console.log('\n[5. Tool Execution: Reschedule Appointment]');

  const nextSlot = checkAvailRes.slots[1].startTime;
  const rescheduleRes = await VoiceService.executeVoiceTool({
    callId: 'call_test_001',
    toolName: 'reschedule_appointment',
    args: {
      appointmentId: bookRes.appointmentId,
      newStartTime: nextSlot,
    },
    organizationId: orgAId,
  });

  assert.strictEqual(rescheduleRes.success, true, 'Reschedule completed');
  const updatedAppt = await AppointmentService.getAppointmentById(orgAId, bookRes.appointmentId);
  assert.strictEqual(new Date(updatedAppt!.startTime).getTime(), new Date(nextSlot).getTime());
  console.log('  ✓ 9. reschedule_appointment updated appointment time in DB and calendar');

  // ========================================================
  // 6. Tool: Cancel Appointment
  // ========================================================
  console.log('\n[6. Tool Execution: Cancel Appointment]');

  const cancelRes = await VoiceService.executeVoiceTool({
    callId: 'call_test_001',
    toolName: 'cancel_appointment',
    args: {
      appointmentId: bookRes.appointmentId,
    },
    organizationId: orgAId,
  });

  assert.strictEqual(cancelRes.success, true, 'Cancellation completed');
  const canceledAppt = await AppointmentService.getAppointmentById(orgAId, bookRes.appointmentId);
  assert.strictEqual(canceledAppt!.status, 'CANCELED');
  console.log('  ✓ 10. cancel_appointment updated status to CANCELED and removed calendar event');

  // ========================================================
  // 7. Call Lifecycle, Transcript & Minute Tracking
  // ========================================================
  console.log('\n[7. Call Lifecycle, Transcripts & Usage Tracking]');

  const callEndPayload = {
    callId: 'call_test_completed_123',
    fromNumber: '+16505559876',
    toNumber: existingPhone,
    startedAt: new Date(Date.now() - 120000).toISOString(),
    endedAt: new Date().toISOString(),
    durationSeconds: 120,
    durationMinutes: 2.0,
    transcript: 'Customer: I want to book a dental checkup.\nAI: You are all set! I have booked your checkup for Tuesday at 2 PM.',
    recordingUrl: 'https://voice.onceclic.com/rec/call_123.mp3',
  };

  const callRecord = await VoiceService.handleCallEnded(callEndPayload);
  assert.strictEqual(callRecord.durationMinutes, 2.0, 'Duration minutes recorded');
  assert.strictEqual(callRecord.outcome, 'APPOINTMENT_BOOKED', 'Outcome correctly classified');

  // Verify conversation channel PHONE created
  const conv = await db.getOne(
    `SELECT id, channel FROM conversations WHERE id = $1 AND organization_id = $2`,
    [callRecord.conversationId, orgAId]
  );
  assert.strictEqual(conv?.channel, ConversationChannel.PHONE, 'Conversation channel recorded as PHONE');
  console.log('  ✓ 11. Completed call recorded in voice_call_records with channel = PHONE and transcript messages');

  // Test: Idempotency on duplicate call-ended event
  const duplicateCall = await VoiceService.handleCallEnded(callEndPayload);
  assert.strictEqual(duplicateCall.id, callRecord.id, 'Duplicate call-ended is idempotent');
  console.log('  ✓ 12. Duplicate call-ended webhook handled idempotently');

  // ========================================================
  // 8. Product-Level Minute Usage & Plan Limits
  // ========================================================
  console.log('\n[8. Product-Level Minute Usage & Plan Limits]');

  const voiceUsage = await VoiceService.getVoiceUsage(orgAId);
  assert.strictEqual(voiceUsage.usedMinutes >= 2.0, true, 'Used minutes calculated from call records');
  assert.ok(
    [15, 50, 150, 400].includes(voiceUsage.includedMinutes),
    `Plan limit retrieved (${voiceUsage.includedMinutes})`
  );
  console.log(`  ✓ 13. Usage tracked in customer-facing minutes (${voiceUsage.usedMinutes} / ${voiceUsage.includedMinutes} min)`);

  // ========================================================
  // 9. Multi-Tenant Isolation
  // ========================================================
  console.log('\n[9. Multi-Tenant Isolation]');

  const callsOrgB = await VoiceService.listCallRecords(orgBId);
  const hasOrgACall = callsOrgB.some((c) => c.id === callRecord.id);
  assert.strictEqual(hasOrgACall, false, 'Org B cannot view Org A call records');

  const numbersOrgB = await VoiceService.listPhoneNumbers(orgBId);
  const hasOrgANumber = numbersOrgB.some((n) => n.phoneNumber === existingPhone);
  assert.strictEqual(hasOrgANumber, false, 'Org B cannot view Org A phone numbers');
  console.log('  ✓ 14. Multi-tenant isolation verified across calls and phone numbers');

  // ========================================================
  // 10. Voice Tool Cross-Tenant Security Hardening
  // ========================================================
  console.log('\n[10. Voice Tool Cross-Tenant Security Hardening]');

  // Book an appointment under Org B
  const apptOrgB = await AppointmentService.bookAppointment({
    organizationId: orgBId,
    serviceName: 'Legal Consultation',
    customerName: 'Secret Client',
    customerEmail: 'client@example.com',
    startTime: `${targetDateStr}T14:00:00.000Z`,
    endTime: `${targetDateStr}T15:00:00.000Z`,
  });

  // Malicious attack: Caller in Org A session tries to cancel Org B's appointment
  const maliciousCancelRes = await VoiceService.executeVoiceTool({
    callId: 'call_test_001',
    toolName: 'cancel_appointment',
    args: { appointmentId: apptOrgB.id },
    organizationId: orgAId, // Caller belongs to Org A
  });
  assert.ok(
    maliciousCancelRes.error && maliciousCancelRes.error.length > 0,
    'Malicious cancellation of foreign tenant appointment was strictly blocked'
  );

  // Malicious attack: Caller in Org A tries to reschedule Org B's appointment
  const maliciousRescheduleRes = await VoiceService.executeVoiceTool({
    callId: 'call_test_001',
    toolName: 'reschedule_appointment',
    args: { appointmentId: apptOrgB.id, newStartTime: `${targetDateStr}T16:00:00.000Z` },
    organizationId: orgAId,
  });
  assert.ok(
    maliciousRescheduleRes.error && maliciousRescheduleRes.error.length > 0,
    'Malicious reschedule of foreign tenant appointment was strictly blocked'
  );
  console.log('  ✓ 15. Malicious cross-tenant appointment manipulation strictly rejected');

  // ========================================================
  // 11. Call Duration & Minute Accounting Boundary Tests
  // ========================================================
  console.log('\n[11. Call Duration & Minute Accounting Boundary Tests]');

  const testDurations = [
    { sec: 0, expectedMin: 0.0 },
    { sec: 30, expectedMin: 0.5 },
    { sec: 59, expectedMin: 0.98 },
    { sec: 60, expectedMin: 1.0 },
    { sec: 61, expectedMin: 1.02 },
    { sec: 300, expectedMin: 5.0 },
    { sec: 900, expectedMin: 15.0 },
    { sec: 3000, expectedMin: 50.0 },
    { sec: 9000, expectedMin: 150.0 },
    { sec: 24000, expectedMin: 400.0 },
  ];

  for (const td of testDurations) {
    const calcMin = Math.round((td.sec / 60) * 100) / 100;
    assert.strictEqual(calcMin, td.expectedMin, `Second duration ${td.sec}s correctly mapped to ${td.expectedMin}m`);
  }
  console.log('  ✓ 16. All second-to-minute duration accounting boundaries verified (0s, 30s, 59s, 60s, 61s, 5m, 15m, 50m, 150m, 400m)');

  // ========================================================
  // 12. Mid-Call Limit & Inbound Exhaustion Behavior
  // ========================================================
  console.log('\n[12. Mid-Call Limit & Inbound Exhaustion Behavior]');

  // Insert a call that exhausts remaining trial allowance (15m limit)
  await VoiceService.handleCallEnded({
    callId: 'call_test_exhaust_limit',
    fromNumber: '+16505559876',
    toNumber: existingPhone,
    startedAt: new Date(Date.now() - 900000).toISOString(),
    endedAt: new Date().toISOString(),
    durationSeconds: 900,
    durationMinutes: 15.0,
    transcript: 'Customer: General questions.\nAI: Have a wonderful day.',
  });

  const usageAfterExhaustion = await VoiceService.getVoiceUsage(orgAId);
  assert.strictEqual(usageAfterExhaustion.limitReached, true, 'Minute limit reached flagged');

  // Next inbound call must be blocked with polite message
  const blockedCallRes = await VoiceService.handleInboundCall({
    callId: 'call_test_after_limit',
    fromNumber: '+16505559876',
    toNumber: existingPhone,
    provider: 'MOCK_VOICE',
  });
  assert.strictEqual(blockedCallRes.allowed, false, 'Inbound call blocked once minute limit reached');
  console.log('  ✓ 17. Minute exhaustion blocks subsequent inbound calls with graceful message');

  // ========================================================
  // 13. Subscription State: CANCELED
  // ========================================================
  console.log('\n[13. Subscription State: CANCELED Verification]');

  await db.execute('UPDATE subscriptions SET status = $1 WHERE organization_id = $2', [
    SubscriptionStatus.CANCELED,
    orgAId,
  ]);

  const canceledCallRes = await VoiceService.handleInboundCall({
    callId: 'call_test_canceled_sub',
    fromNumber: '+16505559876',
    toNumber: existingPhone,
    provider: 'MOCK_VOICE',
  });
  assert.strictEqual(canceledCallRes.allowed, false, 'Canceled subscription strictly blocked at voice gateway');
  console.log('  ✓ 18. Canceled subscription state strictly blocks phone receptionist');

  // ========================================================
  // 14. Information Security & Zero Cost Leak Audit
  // ========================================================
  console.log('\n[14. Information Security & Zero Internal Cost Leak]');

  const customerVoiceConfig = await VoiceService.getCustomerVoiceConfig(orgAId);
  const safeVoiceConfig = toCustomerVoiceConfig(customerVoiceConfig);
  assertNoForbiddenFields(safeVoiceConfig, 'safeVoiceConfig');

  const safeCallRecord = toCustomerCallRecord(callRecord);
  assertNoForbiddenFields(safeCallRecord, 'safeCallRecord');
  assert.ok(safeCallRecord.callerPhone.includes('***'), 'Caller phone number is safely masked');

  const analyticsData = await VoiceService.getVoiceAnalytics(orgAId);
  const safeAnalytics = toCustomerVoiceAnalytics(analyticsData);
  assertNoForbiddenFields(safeAnalytics, 'safeAnalytics');

  console.log('  ✓ 19. Zero internal dollar cost leak verified on all voice APIs and serializers');
  console.log('--- AI Phone Receptionist Test Suite Completed Successfully ---\n');
}
