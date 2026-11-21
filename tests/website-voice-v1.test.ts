import assert from 'assert';
import { getDatabase } from '../server/src/db';
import {
  DEFAULT_VOICE_PLAN_LIMITS,
  SUBSCRIPTION_PLANS,
} from '@onceclic/shared';
import { VoiceService } from '../server/src/services/voice/VoiceService';
import { VapiVoiceProvider } from '../server/src/services/voice/VapiVoiceProvider';
import { AppointmentService } from '../server/src/services/AppointmentService';
import { VoiceAssistantProvisioningService } from '../server/src/services/voice/VoiceAssistantProvisioningService';
import { config } from '../server/src/config';

export async function runWebsiteVoiceV1Tests() {
  console.log('--- Starting Website Voice V1 & Phone Coming Soon Tests ---');
  const db = getDatabase();

  // Test 1: Plan Pricing and AI Voice Minutes Allowance Verification
  console.log('Test 1: Plan Pricing and AI Voice Minutes Allowance Verification');
  assert.strictEqual(DEFAULT_VOICE_PLAN_LIMITS.STARTER, 50, 'Starter plan must have 50 AI voice minutes');
  assert.strictEqual(DEFAULT_VOICE_PLAN_LIMITS.PRO, 200, 'Pro plan must have 200 AI voice minutes');
  assert.strictEqual(DEFAULT_VOICE_PLAN_LIMITS.BUSINESS, 500, 'Business plan must have 500 AI voice minutes');

  const starterPlan = (SUBSCRIPTION_PLANS as any).STARTER;
  const proPlan = (SUBSCRIPTION_PLANS as any).PRO;
  const businessPlan = (SUBSCRIPTION_PLANS as any).BUSINESS;

  assert.strictEqual(starterPlan?.priceMonthlyUsd ?? starterPlan?.priceUsd, 19, 'Starter must be $19/mo');
  assert.strictEqual(proPlan?.priceMonthlyUsd ?? proPlan?.priceUsd, 49, 'Pro must be $49/mo');
  assert.strictEqual(businessPlan?.priceMonthlyUsd ?? businessPlan?.priceUsd, 99, 'Business must be $99/mo');
  assert.strictEqual(proPlan?.voiceMinutes, 200, 'Pro must have 200 voice minutes in SUBSCRIPTION_PLANS');
  assert.strictEqual(businessPlan?.voiceMinutes, 500, 'Business must have 500 voice minutes in SUBSCRIPTION_PLANS');
  console.log('✓ Plan Pricing and AI Voice Minutes verified');

  // Test 2: Vapi Voice Provider Configuration (Gemini 2.5 Flash-Lite & Clara)
  console.log('Test 2: Vapi Voice Provider Configuration (Gemini 2.5 Flash-Lite & Clara)');
  const vapiProvider = new VapiVoiceProvider();
  assert.strictEqual(vapiProvider.providerName, 'VAPI');

  // Verify default assistant payload built by Vapi provider
  const inboundResp = vapiProvider.formatInboundResponse({
    agentName: 'Test Voice Assistant',
    systemPrompt: 'You are an AI receptionist.',
    tools: [
      {
        name: 'check_calendar_availability',
        description: 'Check available appointment slots',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'create_appointment',
        description: 'Book a confirmed appointment',
        parameters: { type: 'object', properties: {} },
      },
    ],
  });

  const assistantPayload = inboundResp.assistant;

  assert.strictEqual(assistantPayload.model.provider, 'google');
  assert.strictEqual(assistantPayload.model.model, 'gemini-2.5-flash-lite');
  assert.strictEqual(assistantPayload.voice.provider, 'vapi');
  assert.strictEqual(assistantPayload.voice.voiceId, 'Clara');
  assert.strictEqual(assistantPayload.transcriber.provider, 'deepgram');
  assert.strictEqual(assistantPayload.transcriber.model, 'nova-2');
  assert.strictEqual(assistantPayload.transcriber.language, 'multi');
  assert(Array.isArray(assistantPayload.model.tools), 'Assistant must have model tools attached');
  assert.strictEqual(assistantPayload.model.tools.length, 2, 'Tools must be passed to assistant payload');
  console.log('✓ Vapi Gemini 2.5 Flash-Lite and Clara voice configuration verified');

  // Test 3: Dedicated Assistant Lookup & Browser Voice Session Starting
  console.log('Test 3: Dedicated Assistant Lookup & Browser Voice Session Starting');
  const orgId = `org_v1_test_${Date.now()}`;
  await db.execute(
    `INSERT INTO organizations (id, name, slug, business_type, is_active, created_at, updated_at)
     VALUES ($1, 'V1 Clinic Test', $2, 'clinic', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [orgId, `slug-${orgId}`]
  );

  // Add subscription with Pro plan
  const periodEndIso = new Date(Date.now() + 30 * 86400000).toISOString();
  await db.execute(
    `INSERT INTO subscriptions (id, organization_id, tier, status, current_period_end, created_at, updated_at)
     VALUES ($1, $2, 'PRO', 'ACTIVE', $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [`sub_${orgId}`, orgId, periodEndIso]
  );

  // Add dedicated assistant record
  const mockAssistantId = `asst_${Date.now()}`;
  await db.execute(
    `INSERT INTO organization_voice_assistants (id, organization_id, vapi_assistant_id, provisioning_status, created_at, updated_at)
     VALUES ($1, $2, $3, 'READY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [`ova_${Date.now()}`, orgId, mockAssistantId]
  );

  const voiceConfig = await VoiceService.getCustomerVoiceConfig(orgId);
  assert.strictEqual(voiceConfig.isVoiceReceptionistReady, true, 'Receptionist must be ready');
  assert.strictEqual(voiceConfig.assistantId, mockAssistantId, 'Assistant ID must match organization assistant');
  assert(voiceConfig.embedSnippet, 'Embed snippet must exist');
  assert(voiceConfig.embedSnippet.includes(`window.ONCECLIC_CONFIG = { orgSlug:`), 'Embed snippet must be present');

  const session = await VoiceService.startBrowserVoiceSession(orgId);
  assert.strictEqual(session.allowed, true, 'Browser voice session must be allowed');
  assert.strictEqual(session.assistantId, mockAssistantId, 'Session must return correct assistant ID');
  assert(session.remainingMinutes !== undefined && session.remainingMinutes > 0, 'Must have remaining minutes');
  console.log('✓ Browser voice session starting and dedicated assistant verified');

  // Test 4: Real Calendar Tool Execution with Double-Booking Prevention
  console.log('Test 4: Real Calendar Tool Execution with Double-Booking Prevention');
  // Configure business hours for the organization
  const businessHours = [
    { dayOfWeek: 1, openTime: '09:00', closeTime: '17:00', isOpen: true },
    { dayOfWeek: 2, openTime: '09:00', closeTime: '17:00', isOpen: true },
    { dayOfWeek: 3, openTime: '09:00', closeTime: '17:00', isOpen: true },
    { dayOfWeek: 4, openTime: '09:00', closeTime: '17:00', isOpen: true },
    { dayOfWeek: 5, openTime: '09:00', closeTime: '17:00', isOpen: true },
  ];

  await db.execute(
    `INSERT INTO business_settings (id, organization_id, business_hours, created_at, updated_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [`bs_${orgId}`, orgId, JSON.stringify(businessHours)]
  );

  // Test check_calendar_availability tool
  const availResult = await VoiceService.executeVoiceTool({
    callId: `call_test_${Date.now()}`,
    organizationId: orgId,
    toolName: 'check_calendar_availability',
    args: {
      date: '2026-12-01',
      durationMinutes: 30,
    },
  });
  assert(availResult.success !== false, 'check_calendar_availability should succeed');

  // Test create_appointment tool
  const bookResult = await VoiceService.executeVoiceTool({
    callId: `call_test_${Date.now()}`,
    organizationId: orgId,
    toolName: 'create_appointment',
    args: {
      customerName: 'Sarah Jenkins',
      customerPhone: '+14155552671',
      customerEmail: 'sarah@example.com',
      startTime: '2026-12-01T10:00:00Z',
      endTime: '2026-12-01T10:30:00Z',
      serviceName: 'Consultation',
    },
  });
  assert.strictEqual(bookResult.success, true, 'Appointment creation must succeed');
  assert(bookResult.appointmentId, 'Must return confirmed appointmentId');

  // Test get_appointment tool
  const getResult = await VoiceService.executeVoiceTool({
    callId: `call_test_${Date.now()}`,
    organizationId: orgId,
    toolName: 'get_appointment',
    args: {
      appointmentId: bookResult.appointmentId,
    },
  });
  assert.strictEqual(getResult.success, true, 'get_appointment must find confirmed appointment');
  assert.strictEqual(getResult.appointment.customerName, 'Sarah Jenkins');

  // Attempt double booking at the same exact time
  const doubleBookResult = await VoiceService.executeVoiceTool({
    callId: `call_test_${Date.now()}`,
    organizationId: orgId,
    toolName: 'create_appointment',
    args: {
      customerName: 'Another Visitor',
      customerPhone: '+14155559999',
      startTime: '2026-12-01T10:00:00Z',
      endTime: '2026-12-01T10:30:00Z',
      serviceName: 'Consultation',
    },
  });
  assert.strictEqual(doubleBookResult.success, false, 'Double booking must be strictly blocked');

  // Verify appointment appears in salon dashboard / appointments table
  const salonDashboardAppts = await db.query(
    `SELECT id, customer_name, start_time, status FROM appointments WHERE organization_id = $1`,
    [orgId]
  );
  assert.strictEqual(salonDashboardAppts.rows.length, 1, 'Exactly one appointment must exist in salon dashboard');
  assert.strictEqual(salonDashboardAppts.rows[0].customer_name, 'Sarah Jenkins');
  assert.strictEqual(salonDashboardAppts.rows[0].status, 'CONFIRMED');

  // Test Reschedule Appointment
  const rescheduleResult = await VoiceService.executeVoiceTool({
    callId: `call_test_${Date.now()}`,
    organizationId: orgId,
    toolName: 'reschedule_appointment',
    args: {
      appointmentId: bookResult.appointmentId,
      newStartTime: '2026-12-01T14:00:00Z',
    },
  });
  assert.strictEqual(rescheduleResult.success, true, 'Reschedule must succeed');

  // Test Cancellation
  const cancelResult = await VoiceService.executeVoiceTool({
    callId: `call_test_${Date.now()}`,
    organizationId: orgId,
    toolName: 'cancel_appointment',
    args: {
      appointmentId: bookResult.appointmentId,
    },
  });
  assert.strictEqual(cancelResult.success, true, 'Cancellation must succeed');

  const canceledAppt = await db.getOne<{ status: string }>(
    `SELECT status FROM appointments WHERE id = $1`,
    [bookResult.appointmentId]
  );
  assert.strictEqual(canceledAppt?.status, 'CANCELED', 'Appointment status must be CANCELED in DB');

  // Test Invalid start time format rejection
  const invalidTimeResult = await VoiceService.executeVoiceTool({
    callId: `call_test_${Date.now()}`,
    organizationId: orgId,
    toolName: 'create_appointment',
    args: {
      customerName: 'Bad Format',
      customerPhone: '+14155551234',
      startTime: 'not-a-valid-date',
      serviceName: 'Consultation',
    },
  });
  assert.strictEqual(invalidTimeResult.success, false, 'Invalid start time must be rejected');

  // Test sequential and overlapping booking prevention
  const newApptResult = await VoiceService.executeVoiceTool({
    callId: `call_test_${Date.now()}`,
    organizationId: orgId,
    toolName: 'create_appointment',
    args: {
      customerName: 'Customer A',
      customerPhone: '+14155551111',
      startTime: '2026-12-02T11:00:00Z',
      endTime: '2026-12-02T11:30:00Z',
      serviceName: 'Consultation',
    },
  });
  assert.strictEqual(newApptResult.success, true, 'New slot booking must succeed');

  const conflictingApptResult = await VoiceService.executeVoiceTool({
    callId: `call_test_${Date.now()}`,
    organizationId: orgId,
    toolName: 'create_appointment',
    args: {
      customerName: 'Customer B',
      customerPhone: '+14155552222',
      startTime: '2026-12-02T11:15:00Z',
      endTime: '2026-12-02T11:45:00Z',
      serviceName: 'Consultation',
    },
  });
  assert.strictEqual(conflictingApptResult.success, false, 'Overlapping appointment slot must be strictly blocked');
  console.log('✓ Calendar verification, rescheduling, cancellation, and double-booking prevention verified');

  // Test 5: Call Ended Webhook Handling for Browser Voice Calls (channel = WEB)
  console.log('Test 5: Call Ended Webhook Handling for Browser Voice Calls');
  const webCallId = `vapi_web_call_${Date.now()}`;
  const callEndResult1 = await VoiceService.handleCallEnded({
    callId: webCallId,
    durationSeconds: 125,
    metadata: {
      assistantId: mockAssistantId,
      organizationId: orgId,
    },
  });
  assert(callEndResult1 && callEndResult1.id, 'Browser voice session must be recorded');

  // Duplicate webhook delivery test (Idempotency)
  const callEndResult2 = await VoiceService.handleCallEnded({
    callId: webCallId,
    durationSeconds: 125,
    metadata: {
      assistantId: mockAssistantId,
      organizationId: orgId,
    },
  });
  assert.strictEqual(callEndResult1.id, callEndResult2.id, 'Duplicate webhook must return identical call record idempotently');

  const recordedCallCount = await db.query(
    `SELECT id FROM voice_call_records WHERE provider_call_id = $1`,
    [webCallId]
  );
  assert.strictEqual(recordedCallCount.rows.length, 1, 'Duplicate webhook delivery must not create duplicate DB records');
  const recordedCall = await db.getOne<{ duration_seconds: number; provider: string }>(
    `SELECT duration_seconds, provider FROM voice_call_records WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [orgId]
  );
  assert(recordedCall, 'Voice call record must exist in DB');
  assert.strictEqual(recordedCall.duration_seconds, 125, 'Duration must match 125s');
  console.log('✓ Browser voice call tracking verified');

  console.log('--- Website Voice V1 & Phone Coming Soon Tests Passed! ---\n');
}

if (process.env.RUN_STANDALONE === 'true') {
  const db = getDatabase();
  db.runMigrations()
    .then(() => runWebsiteVoiceV1Tests())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Test failed:', err);
      process.exit(1);
    });
}
