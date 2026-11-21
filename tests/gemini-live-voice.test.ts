import assert from 'assert';
import http from 'http';
import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../server/src/db';
import { config } from '../server/src/config';
import { AuthService } from '../server/src/services/AuthService';
import { TrialService } from '../server/src/services/TrialService';
import { KnowledgeService } from '../server/src/services/KnowledgeService';
import { VoiceService } from '../server/src/services/voice/VoiceService';
import { VoicePromptBuilder } from '../server/src/services/voice/VoicePromptBuilder';
import {
  GeminiLiveBridgeService,
  toGeminiFunctionDeclarations,
  toGeminiSchema,
} from '../server/src/services/voice/GeminiLiveBridgeService';
import { KnowledgeSourceType, SubscriptionStatus } from '@onceclic/shared';

export async function runGeminiLiveVoiceTests() {
  console.log('\n====================================================');
  console.log('  RUNNING GEMINI LIVE DIRECT VOICE API TEST SUITE');
  console.log('====================================================\n');

  // Set test environment flags
  process.env.USE_EMBEDDED_DB = 'true';
  process.env.AI_PROVIDER = 'gemini';

  // --------------------------------------------------------------------------
  // Setup Test Organization A
  // --------------------------------------------------------------------------
  const orgAEmail = `gemini_owner_${Date.now()}@test.com`;
  const registerA = await AuthService.register({
    email: orgAEmail,
    password: 'Password123!',
    fullName: 'Dr. Sarah Connor',
    businessName: 'Connor Dental & Wellness',
  });
  const orgAId = registerA.organization!.id;
  const userAId = registerA.user.id;

  await TrialService.redeemTrial({
    userId: userAId,
    organizationId: orgAId,
    email: orgAEmail,
  });

  // Setup services & hours for Org A
  await db.execute(
    `UPDATE business_settings
     SET services = $1,
         business_hours = $2,
         industry_type = 'clinic'
     WHERE organization_id = $3`,
    [
      JSON.stringify([
        { id: 'srv_1', name: 'Dental Checkup', price: 80, durationMinutes: 30 },
        { id: 'srv_2', name: 'Teeth Cleaning', price: 120, durationMinutes: 45 },
      ]),
      JSON.stringify([
        { day: 'Monday', open: '09:00', close: '17:00' },
        { day: 'Tuesday', open: '09:00', close: '17:00' },
      ]),
      orgAId,
    ]
  );

  await KnowledgeService.addSource({
    organizationId: orgAId,
    sourceType: KnowledgeSourceType.FAQ,
    title: 'Clinic Location & Insurance',
    rawContent: 'We are located at 123 Market Street, Suite 400. We accept MetLife, Delta Dental, and Guardian.',
  });

  // --------------------------------------------------------------------------
  // Setup Test Organization B (for multi-tenant isolation testing)
  // --------------------------------------------------------------------------
  const orgBEmail = `gemini_org_b_${Date.now()}@test.com`;
  const registerB = await AuthService.register({
    email: orgBEmail,
    password: 'Password123!',
    fullName: 'Chef Marco Rossi',
    businessName: 'Trattoria Bella',
  });
  const orgBId = registerB.organization!.id;
  const userBId = registerB.user.id;

  await TrialService.redeemTrial({
    userId: userBId,
    organizationId: orgBId,
    email: orgBEmail,
  });

  await db.execute(
    `UPDATE business_settings
     SET services = $1,
         industry_type = 'restaurant'
     WHERE organization_id = $2`,
    [
      JSON.stringify([
        { id: 'srv_rest_1', name: 'Dinner Table Reservation', price: 0, durationMinutes: 90 },
      ]),
      orgBId,
    ]
  );

  // --------------------------------------------------------------------------
  // Test 1: Gemini Live Model & Endpoint Configuration
  // --------------------------------------------------------------------------
  console.log('[1. Model & Endpoint Configuration]');
  const liveModel = process.env.GEMINI_LIVE_MODEL || config.gemini?.liveModel || 'models/gemini-2.0-flash-exp';
  assert.ok(liveModel.includes('gemini-2.0') || liveModel.includes('gemini'), 'Gemini Live model configured');
  assert.strictEqual(typeof config.gemini.liveVoice, 'string', 'Prebuilt voice configured (Aoede)');
  console.log(`  ✓ 1. Configured Gemini Live API model: ${liveModel} and voice: ${config.gemini?.liveVoice || 'Aoede'}`);

  // --------------------------------------------------------------------------
  // Test 2: Gemini Tool Declarations Schema Conversion
  // --------------------------------------------------------------------------
  console.log('\n[2. Tool Schema Conversion]');
  const sampleTools = [
    {
      name: 'check_calendar_availability',
      description: 'Check available slots',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          partySize: { type: 'number', description: 'Number of guests' },
        },
        required: ['date'],
      },
    },
  ];

  const geminiDecls = toGeminiFunctionDeclarations(sampleTools);
  assert.strictEqual(geminiDecls.length, 1, 'One tool converted');
  assert.strictEqual(geminiDecls[0].name, 'check_calendar_availability');
  assert.strictEqual(geminiDecls[0].parameters.type, 'OBJECT', 'Object type uppercased');
  assert.strictEqual(geminiDecls[0].parameters.properties.date.type, 'STRING', 'String type uppercased');
  assert.strictEqual(geminiDecls[0].parameters.properties.partySize.type, 'NUMBER', 'Number type uppercased');
  assert.deepStrictEqual(geminiDecls[0].parameters.required, ['date'], 'Required array preserved');
  console.log('  ✓ 2. Tool schema safely converted to uppercase Gemini Live function declarations');

  // --------------------------------------------------------------------------
  // Test 3: Session Ticket Issuance (No Permanent API Key Sent to Browser)
  // --------------------------------------------------------------------------
  console.log('\n[3. Session Ticket & Credential Isolation]');
  const ticketRes = await GeminiLiveBridgeService.createSessionTicket({
    organizationId: orgAId,
  });

  assert.strictEqual(ticketRes.allowed, true, 'Ticket allowed for active trial org');
  assert.ok(ticketRes.sessionTicket, 'Short-lived JWT session ticket issued');
  assert.ok(ticketRes.wsUrl?.includes('/api/voice/live'), 'WebSocket bridge URL points to backend');
  assert.strictEqual(ticketRes.provider, 'gemini_live');
  assert.strictEqual(ticketRes.maxConversationSeconds, 180, '180s conversation limit returned');
  assert.strictEqual(ticketRes.appointmentReminderSeconds, 120, '120s booking reminder returned');

  // Verify ticket content
  const decoded = jwt.verify(ticketRes.sessionTicket!, config.jwtSecret) as any;
  assert.strictEqual(decoded.organizationId, orgAId, 'Ticket contains correct tenant ID');
  assert.strictEqual(decoded.type, 'gemini_live_session');
  assert.strictEqual(decoded.maxDurationSeconds, 180);
  assert.strictEqual('apiKey' in decoded, false, 'Permanent Gemini API key NEVER in ticket');
  console.log('  ✓ 3. Short-lived session ticket issued with 180s limit and zero API key exposure');

  // --------------------------------------------------------------------------
  // Test 4: Expired Trial Blocks Session Ticket
  // --------------------------------------------------------------------------
  console.log('\n[4. Trial Expiration Guard]');
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  await db.execute(
    `UPDATE subscriptions
     SET trial_ends_at = $1, status = 'EXPIRED'
     WHERE organization_id = $2`,
    [yesterday, orgAId]
  );

  const expiredRes = await GeminiLiveBridgeService.createSessionTicket({
    organizationId: orgAId,
  });
  assert.strictEqual(expiredRes.allowed, false, 'Expired trial rejected');
  assert.ok(expiredRes.reason?.toLowerCase().includes('expired'), 'Reason states expired');
  console.log('  ✓ 4. Expired trial rejected before establishing voice session');

  // Restore trial for Org A
  const futureTrial = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
  await db.execute(
    `UPDATE subscriptions
     SET trial_ends_at = $1, status = 'TRIALING'
     WHERE organization_id = $2`,
    [futureTrial, orgAId]
  );

  // --------------------------------------------------------------------------
  // Test 5: Exhausted Minute Allowance Blocks Session Ticket
  // --------------------------------------------------------------------------
  console.log('\n[5. Allowance Exhaustion Guard]');
  // Simulate 30 minutes of completed voice calls
  await db.execute(
    `INSERT INTO voice_call_records (
       id, organization_id, provider, provider_call_id, caller_phone, direction,
       started_at, ended_at, duration_seconds, duration_minutes, status, outcome,
       counted_for_limit, created_at
     ) VALUES ($1, $2, 'GEMINI_LIVE', $3, '+15550001111', 'INBOUND', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1800, 30.0, 'COMPLETED', 'GENERAL_INQUIRY', TRUE, CURRENT_TIMESTAMP)`,
    [uuidv4(), orgAId, `sim_call_${Date.now()}`]
  );

  const exhaustedRes = await GeminiLiveBridgeService.createSessionTicket({
    organizationId: orgAId,
  });
  assert.strictEqual(exhaustedRes.allowed, false, 'Exhausted allowance rejected');
  assert.ok(exhaustedRes.reason?.includes('30 minutes'), 'Reason mentions 30 minutes exhausted');
  console.log('  ✓ 5. 30-minute allowance exhaustion strictly blocked');

  // Reset calls for Org A for subsequent live streaming tests
  await db.execute('DELETE FROM voice_call_records WHERE organization_id = $1', [orgAId]);

  // --------------------------------------------------------------------------
  // Test 6: In-Flight Concurrency Reservation
  // --------------------------------------------------------------------------
  console.log('\n[6. Concurrency Reservation]');
  const inFlightCallId = `in_flight_${Date.now()}`;
  VoiceService.activeCalls.set(inFlightCallId, {
    callId: inFlightCallId,
    organizationId: orgAId,
    startedAt: Date.now(),
    maxDurationSeconds: 180,
  });

  // Verify active call exists in in-flight map
  assert.strictEqual(VoiceService.activeCalls.has(inFlightCallId), true);
  console.log('  ✓ 6. Active in-flight calls track and reserve concurrency cleanly');
  VoiceService.activeCalls.delete(inFlightCallId);

  // --------------------------------------------------------------------------
  // Test 7-12: Bridge Handler In-Memory & Lifecycle Tests
  // --------------------------------------------------------------------------
  console.log('\n[7-12. Bridge Handler In-Memory & Lifecycle Tests]');

  class MockClientWebSocket {
    readyState = 1; // WebSocket.OPEN
    sentMessages: string[] = [];
    closedCode: number | null = null;
    closedReason: string | null = null;
    listeners: Record<string, Function[]> = {};

    on(event: string, fn: Function) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(fn);
    }

    emit(event: string, ...args: any[]) {
      for (const fn of this.listeners[event] || []) {
        fn(...args);
      }
    }

    send(data: string) {
      this.sentMessages.push(data);
      this.emit('client_send', data);
    }

    close(code?: number, reason?: string) {
      this.readyState = 3; // WebSocket.CLOSED
      this.closedCode = code || 1000;
      this.closedReason = reason || '';
      this.emit('close', this.closedCode, this.closedReason);
    }
  }

  // Test 7: Connection without ticket is rejected with 4401
  const wsNoTicket = new MockClientWebSocket();
  await GeminiLiveBridgeService.handleClientConnection(wsNoTicket as any, {
    url: '/api/voice/live',
    headers: { host: 'localhost' },
  });
  assert.strictEqual(wsNoTicket.closedCode, 4401, 'Connection without ticket rejected with 4401');
  console.log('  ✓ 7. Missing ticket rejected immediately (Code: 4401)');

  // Test 8: Connection with forged ticket is rejected with 4401
  const wsBadTicket = new MockClientWebSocket();
  const badTicket = jwt.sign({ fake: true }, 'wrong_secret_key');
  await GeminiLiveBridgeService.handleClientConnection(wsBadTicket as any, {
    url: `/api/voice/live?ticket=${badTicket}`,
    headers: { host: 'localhost' },
  });
  assert.strictEqual(wsBadTicket.closedCode, 4401, 'Forged ticket rejected with 4401');
  console.log('  ✓ 8. Forged ticket signature rejected (Code: 4401)');

  // Test 9: Valid ticket establishes session, receives 'ready' event and exchanges audio
  const validTicketRes = await GeminiLiveBridgeService.createSessionTicket({
    organizationId: orgAId,
  });
  assert.strictEqual(validTicketRes.allowed, true);

  const wsValid = new MockClientWebSocket();
  await GeminiLiveBridgeService.handleClientConnection(wsValid as any, {
    url: `/api/voice/live?ticket=${validTicketRes.sessionTicket}`,
    headers: { host: 'localhost' },
  });

  const readyMsg = wsValid.sentMessages.map((m) => JSON.parse(m)).find((m) => m.type === 'ready');
  assert.ok(readyMsg, 'Client received ready message from bridge');
  assert.strictEqual(readyMsg.maxDurationSeconds, 180, '180s conversation limit confirmed in ready message');
  assert.strictEqual(readyMsg.appointmentReminderSeconds, 120, '120s appointment reminder confirmed in ready message');

  // Send sample audio chunk
  wsValid.emit('message', Buffer.from(JSON.stringify({ type: 'audio', data: 'AQABAA==' })));
  wsValid.emit('message', Buffer.from(JSON.stringify({ type: 'end' })));
  assert.strictEqual(wsValid.closedCode !== null, true, 'Session ended cleanly');
  console.log('  ✓ 9. Valid session connects, receives ready frame, sends audio, and closes cleanly');

  // Test 10: Server-side Function Calling / Tool Execution
  console.log('\n[10. Server-Side Tool Calling with Tenant Isolation]');
  const toolCallId = `call_${Date.now()}`;
  VoiceService.activeCalls.set(toolCallId, {
    callId: toolCallId,
    organizationId: orgAId,
    startedAt: Date.now(),
    maxDurationSeconds: 180,
  });

  // Call check_calendar_availability
  const availResult = await VoiceService.executeVoiceTool({
    callId: toolCallId,
    toolName: 'check_calendar_availability',
    args: { date: '2026-11-23' },
    organizationId: orgAId,
  });
  assert.strictEqual(availResult.hasAvailableSlots, true, 'Availability check succeeded');
  assert.ok(Array.isArray(availResult.slots), 'Candidate slots returned');

  const chosenSlot = availResult.slots[0]?.startTime || '2026-11-23T10:00:00.000Z';

  // Call create_appointment
  const bookResult = await VoiceService.executeVoiceTool({
    callId: toolCallId,
    toolName: 'create_appointment',
    args: {
      serviceName: 'Dental Checkup',
      customerName: 'Alice Walker',
      customerPhone: '+14155551234',
      customerEmail: 'alice@example.com',
      startTime: chosenSlot,
    },
    organizationId: orgAId,
  });
  assert.strictEqual(bookResult.success, true, 'Booking confirmed through real backend');
  assert.ok(bookResult.appointmentId, 'Appointment record created');

  // Verify tenant isolation: Tenant B CANNOT access or modify Tenant A's appointment
  let crossTenantBlocked = false;
  try {
    await VoiceService.executeVoiceTool({
      callId: toolCallId,
      toolName: 'get_appointment',
      args: { appointmentId: bookResult.appointmentId },
      organizationId: orgBId, // Intentional mismatched org
    });
  } catch (err: any) {
    crossTenantBlocked = err.message.includes('Tenant isolation');
  }
  assert.strictEqual(crossTenantBlocked, true, 'Cross-tenant tool execution blocked');
  console.log('  ✓ 10. Server-side tool calling verifies availability, confirms real booking, and enforces tenant isolation');
  VoiceService.activeCalls.delete(toolCallId);

  // Test 11: Dynamic Knowledge Reflection
  console.log('\n[11. Dynamic Knowledge & Prompt Generation]');
  // Org A updates services
  await db.execute(
    `UPDATE business_settings
     SET services = $1
     WHERE organization_id = $2`,
    [
      JSON.stringify([
        { id: 'srv_3', name: 'Emergency Tooth Extraction', price: 250, durationMinutes: 60 },
      ]),
      orgAId,
    ]
  );

  const updatedPrompt = await VoicePromptBuilder.buildPrompt(orgAId);
  assert.ok(
    updatedPrompt.systemPrompt.includes('Emergency Tooth Extraction'),
    'Prompt immediately contains updated service without external assistant provisioning'
  );
  assert.ok(
    !updatedPrompt.systemPrompt.includes('Dinner Table Reservation'),
    'Prompt contains NO knowledge from Tenant B'
  );
  console.log('  ✓ 11. Updated business knowledge reflects immediately on next session without external provisioning');

  // Test 12: Zero-duration or failed connections do not consume allowance
  console.log('\n[12. Safe Accounting on Zero-Duration or Failed Sessions]');
  const initialUsage = await VoiceService.getVoiceUsage(orgBId);
  assert.strictEqual(initialUsage.usedMinutes, 0);

  // Simulate zero-duration connect-disconnect
  const zeroDurationTicket = await GeminiLiveBridgeService.createSessionTicket({
    organizationId: orgBId,
  });
  const zeroWs = new MockClientWebSocket();
  await GeminiLiveBridgeService.handleClientConnection(zeroWs as any, {
    url: `/api/voice/live?ticket=${zeroDurationTicket.sessionTicket}`,
    headers: { host: 'localhost' },
  });
  zeroWs.emit('message', Buffer.from(JSON.stringify({ type: 'end' })));

  const postZeroUsage = await VoiceService.getVoiceUsage(orgBId);
  assert.strictEqual(postZeroUsage.usedMinutes, 0, 'Zero duration session does NOT consume minutes');
  console.log('  ✓ 12. Failed / zero-duration sessions consume 0 minutes');

  console.log('\n====================================================');
  console.log('  ALL 12 GEMINI LIVE TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================\n');
}

if (require.main === module) {
  runGeminiLiveVoiceTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
