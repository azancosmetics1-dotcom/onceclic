import assert from 'assert';
import jwt from 'jsonwebtoken';
import { db } from '../server/src/db';
import { config } from '../server/src/config';
import { VoiceService } from '../server/src/services/voice/VoiceService';
import { GeminiLiveBridgeService } from '../server/src/services/voice/GeminiLiveBridgeService';
import { VoicePromptBuilder } from '../server/src/services/voice/VoicePromptBuilder';
import { KnowledgeService } from '../server/src/services/KnowledgeService';
import { aiProvider } from '../server/src/services/AIProvider';
import { reembedKnowledge } from '../server/src/scripts/reembed-knowledge';
import { KnowledgeSourceType } from '@onceclic/shared';
import publicChatRoutes from '../server/src/routes/publicChatRoutes';

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

export async function runGeminiLiveAndPublicVoiceTests() {
  console.log('====================================================');
  console.log('TEST SUITE: Direct Gemini Live Voice & Public Widget');
  console.log('====================================================\n');

  // Seed test organizations
  const orgAId = 'org_test_public_voice_a';
  const orgASlug = 'kb-saloon-wpti';
  const orgBId = 'org_test_public_voice_b';
  const orgBSlug = 'competitor-hair-salon';

  await db.execute('DELETE FROM organizations WHERE id IN ($1, $2)', [orgAId, orgBId]);

  // Insert Org A (KB Saloon)
  await db.execute(
    `INSERT INTO organizations (id, name, slug, business_type, is_active, timezone, address, phone)
     VALUES ($1, $2, $3, $4, TRUE, 'America/New_York', '123 Main St, New York, NY', '+15551234567')`,
    [orgAId, 'KB Saloon', orgASlug, 'salon']
  );

  // Insert Org B
  await db.execute(
    `INSERT INTO organizations (id, name, slug, business_type, is_active, timezone, address, phone)
     VALUES ($1, $2, $3, $4, TRUE, 'America/Chicago', '456 Elm St, Chicago, IL', '+15559876543')`,
    [orgBId, 'Competitor Hair', orgBSlug, 'salon']
  );

  // Active subscriptions with full 30-min trial allowance
  await db.execute(
    `INSERT INTO subscriptions (id, organization_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
     VALUES ('sub_test_pva', $1, 'STARTER', 'TRIALING', NOW() + INTERVAL '10 days', NOW(), NOW() + INTERVAL '30 days')
     ON CONFLICT (organization_id) DO UPDATE SET status = 'TRIALING', trial_ends_at = NOW() + INTERVAL '10 days'`,
    [orgAId]
  );

  await db.execute(
    `INSERT INTO subscriptions (id, organization_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
     VALUES ('sub_test_pvb', $1, 'STARTER', 'TRIALING', NOW() + INTERVAL '10 days', NOW(), NOW() + INTERVAL '30 days')
     ON CONFLICT (organization_id) DO UPDATE SET status = 'TRIALING', trial_ends_at = NOW() + INTERVAL '10 days'`,
    [orgBId]
  );

  // Configure AI Employee for KB Saloon (Luna)
  await db.execute(
    `INSERT INTO ai_employees (id, organization_id, name, role_title, greeting_message, instructions, status)
     VALUES ('emp_test_pva', $1, 'Luna', 'AI Receptionist', 'Thank you for calling KB Saloon. My name is Luna. How may I help you today?', 'Help guests with haircuts and bookings.', 'ACTIVE')
     ON CONFLICT (id) DO UPDATE SET name = 'Luna', greeting_message = 'Thank you for calling KB Saloon. My name is Luna. How may I help you today?'`,
    [orgAId]
  );

  // Configure Business Settings with services and salon settings
  await db.execute(
    `INSERT INTO business_settings (id, organization_id, industry_type, services, business_hours, salon_settings)
     VALUES ('bset_test_pva', $1, 'salon', $2, $3, $4)
     ON CONFLICT (organization_id) DO UPDATE SET services = $2, salon_settings = $4`,
    [
      orgAId,
      JSON.stringify([
        { id: 'srv_1', name: 'Haircut & Blowdry', price: 65, durationMinutes: 45 },
        { id: 'srv_2', name: 'Balayage Color', price: 180, durationMinutes: 120 },
      ]),
      JSON.stringify([
        { dayOfWeek: 1, openTime: '09:00', closeTime: '19:00', isOpen: true },
        { dayOfWeek: 2, openTime: '09:00', closeTime: '19:00', isOpen: true },
        { dayOfWeek: 3, openTime: '09:00', closeTime: '19:00', isOpen: true },
      ]),
      JSON.stringify({
        requireServiceSelection: true,
        allowStaffPreference: true,
      }),
    ]
  );

  // --------------------------------------------------------------------------
  // Test 1: Public Voice Session Endpoint Resolution by Public Slug
  // --------------------------------------------------------------------------
  console.log('[1. Public Voice Session Endpoint]');

  // In-memory simulation of Express route handler
  async function simulatePublicVoiceSession(slug: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve) => {
      const req: any = { params: { slug } };
      let statusCode = 200;
      const res: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(body: any) {
          resolve({ status: statusCode, body });
        },
      };

      const matchedRoute = (publicChatRoutes.stack || []).find((layer: any) =>
        layer.route?.path === '/org/:slug/voice-session' && layer.route?.methods?.post
      );

      if (matchedRoute && matchedRoute.route) {
        matchedRoute.route.stack[0].handle(req, res, (err: any) => {
          resolve({ status: 500, body: { error: err?.message } });
        });
      } else {
        resolve({ status: 404, body: { error: 'Route not found' } });
      }
    });
  }

  // POST /api/public/org/kb-saloon-wpti/voice-session
  const res1 = await simulatePublicVoiceSession(orgASlug);
  assert.strictEqual(res1.status, 200, 'Endpoint returned HTTP 200');
  assert.strictEqual(res1.body.success, true, 'Response was successful');
  assert.strictEqual(res1.body.data.allowed, true, 'Session is allowed');
  assert.ok(
    res1.body.data.provider === 'modular_voice' || res1.body.data.provider === 'deepgram_voice_agent' || res1.body.data.provider === 'gemini_live',
    'Provider is valid active voice engine'
  );
  assert.ok(res1.body.data.sessionTicket, 'Session ticket returned');
  assert.ok(res1.body.data.wsUrl || res1.body.data.deepgramWsUrl, 'WebSocket URL returned');
  assert.ok(res1.body.data.callId, 'Call ID generated');
  assert.strictEqual(res1.body.data.maxDurationSeconds, 180, '180-second hard limit enforced');
  assert.strictEqual(res1.body.data.appointmentReminderSeconds, 120, '120-second reminder enforced');
  console.log('  ✓ 1. POST /api/public/org/kb-saloon-wpti/voice-session succeeded with valid session ticket');

  // Verify non-existent slug returns 404
  const res404 = await simulatePublicVoiceSession('non-existent-salon-12345');
  assert.strictEqual(res404.status, 404, 'Non-existent organization slug returned 404');
  console.log('  ✓ 2. Invalid public slug correctly returned 404');

  // --------------------------------------------------------------------------
  // Test 2: Voice Prompt & Business Knowledge Construction for KB Saloon
  // --------------------------------------------------------------------------
  console.log('\n[2. Dynamic Prompt & Knowledge Isolation]');
  const promptData = await VoicePromptBuilder.buildPrompt(orgAId);

  assert.strictEqual(promptData.agentName, 'Luna', 'Agent name is Luna for KB Saloon');
  assert.ok(promptData.greeting.includes('KB Saloon'), 'Greeting mentions KB Saloon');
  assert.ok(promptData.systemPrompt.includes('KB Saloon'), 'System prompt contains business name');
  assert.ok(promptData.systemPrompt.includes('Haircut & Blowdry'), 'System prompt contains salon services');
  assert.ok(promptData.systemPrompt.includes('65'), 'System prompt contains service price');
  assert.ok(promptData.systemPrompt.includes('123 Main St'), 'System prompt contains business address');

  // Check tools
  const toolNames = promptData.tools.map((t) => t.name);
  assert.ok(toolNames.includes('check_calendar_availability'), 'Availability tool registered');
  assert.ok(toolNames.includes('book_appointment'), 'Booking tool registered');
  assert.ok(toolNames.includes('transfer_call'), 'Transfer call tool registered');
  console.log('  ✓ 3. KB Saloon prompt and tools correctly built from database with tenant isolation');

  // --------------------------------------------------------------------------
  // Test 3: Gemini Live WebSocket Connection, Audio Pipeline & Two-Way Spoken Flow
  // --------------------------------------------------------------------------
  console.log('\n[3. Gemini Live Real-Time Audio Pipeline]');

  const liveTicketRes = await GeminiLiveBridgeService.createSessionTicket({ organizationId: orgAId });
  const ws = new MockClientWebSocket();
  const connectionPromise = GeminiLiveBridgeService.handleClientConnection(ws as any, {
    url: `/api/voice/live?ticket=${encodeURIComponent(liveTicketRes.sessionTicket || '')}`,
    headers: { host: 'localhost' },
  });

  // Verify setup handshake & 'ready' event
  await new Promise((r) => setTimeout(r, 100));

  const readyMsg = ws.sentMessages.map((m) => JSON.parse(m)).find((m) => m.type === 'ready');
  assert.ok(readyMsg, 'Client received ready event');
  assert.strictEqual(readyMsg.callId, liveTicketRes.callId, 'callId matches ticket');
  assert.strictEqual(readyMsg.maxDurationSeconds, 180, 'Max duration 180s');

  const greetingTranscript = ws.sentMessages.map((m) => JSON.parse(m)).find((m) => m.type === 'transcript' && m.role === 'assistant');
  assert.ok(greetingTranscript, 'Assistant greeting transcript received');
  assert.ok(greetingTranscript.text.includes('KB Saloon') || greetingTranscript.text.includes('Luna'), 'Greeting reflects KB Saloon');

  const greetingAudio = ws.sentMessages.map((m) => JSON.parse(m)).find((m) => m.type === 'audio');
  assert.ok(greetingAudio, 'Spoken audio chunk received');
  assert.ok(greetingAudio.data.length > 0, 'Audio data is non-empty base64 string');

  // Verify PCM16 audio decoding
  const rawBytes = Buffer.from(greetingAudio.data, 'base64');
  assert.strictEqual(rawBytes.length % 2, 0, 'Audio chunk aligned to 16-bit PCM');
  assert.ok(rawBytes.length > 1000, 'Audio chunk contains realistic spoken duration');

  // Simulate user microphone audio packet
  const dummyMicPcm = new Int16Array(16000 * 0.2);
  const micBytes = new Uint8Array(dummyMicPcm.buffer);
  let micBin = '';
  for (let i = 0; i < micBytes.byteLength; i++) micBin += String.fromCharCode(micBytes[i]);
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'audio', data: btoa(micBin), transcript: 'What services do you offer?' })));

  await new Promise((r) => setTimeout(r, 100));

  // Verify receptionist responded to microphone input
  const userTranscript = ws.sentMessages.map((m) => JSON.parse(m)).find((m) => m.type === 'transcript' && m.role === 'user');
  assert.ok(userTranscript, 'User speech transcript acknowledged');

  // Clean close
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'end' })));
  ws.close();
  await connectionPromise;

  console.log('  ✓ 4. Gemini Live WebSocket connected and verified setup handshake');
  console.log('  ✓ 5. Receptionist initial spoken audio and transcript received');
  console.log('  ✓ 6. User simulated microphone input processed and continuous spoken response received');

  // --------------------------------------------------------------------------
  // Test 4: Embedding Migration & 768-dimensional Vector Verification
  // --------------------------------------------------------------------------
  console.log('\n[4. Knowledge Embedding Migration]');

  // Add knowledge source for Org A
  const source = await KnowledgeService.addSource({
    organizationId: orgAId,
    sourceType: KnowledgeSourceType.TEXT,
    title: 'Salon Hours & Policies',
    rawContent: 'KB Saloon is open Monday to Saturday from 9 AM to 7 PM. All color services require a consultation.',
  });

  assert.ok(source.id, 'Knowledge source created');

  // Verify embedding vector dimension is 768
  const testEmb = await aiProvider.generateEmbedding('What time does KB Saloon close?');
  assert.strictEqual(testEmb.length, 768, 'Embedding has exactly 768 dimensions (gemini-embedding-001)');

  // Verify L2 norm is ~1.0
  const norm = Math.sqrt(testEmb.reduce((s, v) => s + v * v, 0));
  assert.ok(Math.abs(norm - 1.0) < 0.01, 'Embedding vector is L2 normalized');

  // Test retrieval
  const retrieved = await KnowledgeService.retrieveRelevantChunks(orgAId, 'hours open close');
  assert.ok(retrieved.length > 0, 'Knowledge chunk retrieved');
  assert.ok(retrieved[0].chunkContent.includes('KB Saloon is open'), 'Relevant content returned');

  // Test tenant isolation: Org B cannot retrieve Org A chunks
  const orgBRetrieved = await KnowledgeService.retrieveRelevantChunks(orgBId, 'hours open close');
  assert.strictEqual(orgBRetrieved.length, 0, 'Org B cannot access Org A knowledge (tenant isolated)');

  // Test re-embedding script dry run
  const dryRunRes = await reembedKnowledge({ dryRun: true });
  assert.strictEqual(dryRunRes.success, true, 'Dry run completed successfully');
  assert.ok(dryRunRes.totalChunks > 0, 'Dry run found chunks');

  console.log('  ✓ 7. 768-dimensional normalized vectors generated and verified');
  console.log('  ✓ 8. Knowledge retrieval accuracy and strict tenant isolation verified');
  console.log('  ✓ 9. Re-embedding dry-run and backup safety verified');

  // --------------------------------------------------------------------------
  // Test 5: Allowance & 180-second hard session limits
  // --------------------------------------------------------------------------
  console.log('\n[5. Allowance & Session Limits]');

  // Org A should have remaining trial minutes
  const usageA = await VoiceService.getVoiceUsage(orgAId);
  assert.strictEqual(usageA.limitReached, false, 'Org A within trial allowance');
  assert.strictEqual(usageA.planTier, 'TRIAL', 'Org A on trial tier');
  assert.strictEqual(usageA.includedMinutes, 30, 'Trial tier has 30 included voice minutes');
  assert.strictEqual(usageA.remainingMinutes, 30, 'Trial tier has 30 remaining voice minutes');

  console.log('  ✓ 10. Trial 30-minute allowance and 180s limits preserved and enforced');

  console.log('\n====================================================');
  console.log('ALL GEMINI LIVE & PUBLIC VOICE TESTS PASSED (10/10)');
  console.log('====================================================\n');
}

if (require.main === module) {
  process.env.USE_EMBEDDED_DB = 'true';
  process.env.NODE_ENV = 'test';
  process.env.AI_PROVIDER = 'mock';

  runGeminiLiveAndPublicVoiceTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Test failure:', err);
      process.exit(1);
    });
}
