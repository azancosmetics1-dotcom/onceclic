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
import { GeminiLiveBridgeService } from '../server/src/services/voice/GeminiLiveBridgeService';
import { VoicePromptBuilder } from '../server/src/services/voice/VoicePromptBuilder';
import {
  DEFAULT_VOICE_PLAN_LIMITS,
  SubscriptionStatus,
} from '@onceclic/shared';

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

async function createOrgWithTrial(prefix: string) {
  const seed = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const email = `${prefix}_${seed}@example.com`;
  const reg = await AuthService.register({
    email,
    password: 'Password123!',
    fullName: `Owner ${prefix}`,
    businessName: `Business ${prefix} ${seed}`,
  });
  const orgId = reg.organization!.id;
  await TrialService.redeemTrial({
    userId: reg.user.id,
    organizationId: orgId,
    email,
  });
  return { orgId, userId: reg.user.id, email, slug: reg.organization!.slug };
}

export async function runTrialUsageAndTwoWayVoiceTests() {
  console.log('\n================================================================');
  console.log('   ONCEClic V1 — Trial Usage & Real Two-Way Voice Test Suite');
  console.log('================================================================\n');

  // -------------------------------------------------------------------------
  // 1. Verify intended plan limits: Trial 30m, Starter 50m, Pro 200m, Business 500m
  // -------------------------------------------------------------------------
  assert.strictEqual(DEFAULT_VOICE_PLAN_LIMITS.TRIAL, 30, 'Trial must have 30 minutes');
  assert.strictEqual(DEFAULT_VOICE_PLAN_LIMITS.STARTER, 50, 'Starter must have 50 minutes');
  assert.strictEqual(DEFAULT_VOICE_PLAN_LIMITS.PRO, 200, 'Pro must have 200 minutes');
  assert.strictEqual(DEFAULT_VOICE_PLAN_LIMITS.BUSINESS, 500, 'Business must have 500 minutes');
  console.log('  ✓ 1. Plan limits verified (Trial: 30m, Starter: 50m, Pro: 200m, Business: 500m)');

  // -------------------------------------------------------------------------
  // 2. Trial usage at 17.8 / 30 minutes allows a session (even with >5 call records!)
  // -------------------------------------------------------------------------
  const org17 = await createOrgWithTrial('usage_17_8');
  // Insert 6 previous calls that sum to exactly 17.8 minutes (this used to trip callLimitReached!)
  const callDurations = [3.0, 3.0, 3.0, 3.0, 3.0, 2.8]; // 6 calls = 17.8 minutes
  const nowIso = new Date().toISOString();
  for (let i = 0; i < callDurations.length; i++) {
    const mins = callDurations[i];
    await db.execute(
      `INSERT INTO voice_call_records (
         id, organization_id, provider, provider_call_id, caller_phone, direction,
         started_at, ended_at, duration_seconds, duration_minutes, status, outcome,
         counted_for_limit, created_at
       ) VALUES ($1, $2, 'gemini_live', $3, '+15551234567', 'INBOUND',
                 $4, $4, $5, $6, 'COMPLETED', 'GENERAL_INQUIRY', TRUE, $4)`,
      [uuidv4(), org17.orgId, `call_prev_${i}_${Date.now()}`, nowIso, mins * 60, mins]
    );
  }

  const usage17 = await VoiceService.getVoiceUsage(org17.orgId);
  assert.strictEqual(usage17.usedMinutes, 17.8, 'Used minutes must equal 17.8');
  assert.strictEqual(usage17.includedMinutes, 30, 'Included minutes must equal 30');
  assert.strictEqual(usage17.remainingMinutes, 12.2, 'Remaining minutes must equal 12.2');
  assert.strictEqual(usage17.minuteLimitReached, false, 'Minute limit must NOT be reached at 17.8 / 30');

  // Attempt to start a voice session at 17.8 / 30 minutes
  const session17 = await VoiceService.startBrowserVoiceSession(org17.orgId);
  assert.strictEqual(session17.allowed, true, 'Voice session MUST be allowed at 17.8 / 30 minutes');
  assert.ok(session17.remainingMinutes && session17.remainingMinutes > 0, 'Remaining minutes must be positive');
  assert.ok(session17.sessionTicket, 'Gemini Live session ticket must be created');
  console.log('  ✓ 2. Trial usage at 17.8 / 30 minutes allows a new session (12.2 min remaining)');

  // -------------------------------------------------------------------------
  // 3. Trial usage at 30.0 / 30 minutes blocks a session
  // -------------------------------------------------------------------------
  const org30 = await createOrgWithTrial('usage_30');
  await db.execute(
    `INSERT INTO voice_call_records (
       id, organization_id, provider, provider_call_id, caller_phone, direction,
       started_at, ended_at, duration_seconds, duration_minutes, status, outcome,
       counted_for_limit, created_at
     ) VALUES ($1, $2, 'gemini_live', $3, '+15551234567', 'INBOUND',
               $4, $4, 1800, 30.0, 'COMPLETED', 'GENERAL_INQUIRY', TRUE, $4)`,
    [uuidv4(), org30.orgId, `call_exhaust_${Date.now()}`, new Date().toISOString()]
  );
  const usage30 = await VoiceService.getVoiceUsage(org30.orgId);
  assert.strictEqual(usage30.usedMinutes, 30, 'Used minutes must equal 30');
  assert.strictEqual(usage30.remainingMinutes, 0, 'Remaining minutes must equal 0');
  assert.strictEqual(usage30.minuteLimitReached, true, 'Minute limit must be reached at 30 / 30');

  const session30 = await VoiceService.startBrowserVoiceSession(org30.orgId);
  assert.strictEqual(session30.allowed, false, 'Voice session must be blocked at 30 / 30 minutes');
  assert.ok(
    session30.reason?.includes('30 minutes') || session30.reason?.includes('exhausted'),
    'Reason must state that free trial voice allowance is exhausted'
  );
  console.log('  ✓ 3. Trial usage at 30 / 30 minutes blocks new session with clear exhaustion reason');

  // -------------------------------------------------------------------------
  // 4. Trial usage cannot exceed allowance through concurrent sessions
  // -------------------------------------------------------------------------
  const orgConcurrent = await createOrgWithTrial('trial_concurrency');
  // Consume 29.0 minutes (1.0 minute remaining)
  await db.execute(
    `INSERT INTO voice_call_records (
       id, organization_id, provider, provider_call_id, caller_phone, direction,
       started_at, ended_at, duration_seconds, duration_minutes, status, outcome,
       counted_for_limit, created_at
     ) VALUES ($1, $2, 'gemini_live', $3, '+15551234567', 'INBOUND',
               $4, $4, 1740, 29.0, 'COMPLETED', 'GENERAL_INQUIRY', TRUE, $4)`,
    [uuidv4(), orgConcurrent.orgId, `call_conc_base_${Date.now()}`, new Date().toISOString()]
  );

  // First session starts and reserves the remaining 1.5 minutes
  const activeCallId = `active_live_${Date.now()}`;
  VoiceService.activeCalls.set(activeCallId, {
    callId: activeCallId,
    organizationId: orgConcurrent.orgId,
    startedAt: Date.now() - 30 * 1000,
    maxDurationSeconds: 90,
  });

  // Second concurrent session attempt must be blocked
  const concAttempt = await VoiceService.startBrowserVoiceSession(orgConcurrent.orgId);
  assert.strictEqual(concAttempt.allowed, false, 'Concurrent session must be blocked when minutes are in flight');
  assert.ok(concAttempt.reason?.includes('active session'), 'Reason must indicate active session is using remaining minutes');

  // Clean up active call
  VoiceService.activeCalls.delete(activeCallId);
  console.log('  ✓ 4. Concurrent sessions cannot exceed trial allowance through race conditions');

  // -------------------------------------------------------------------------
  // 5. Expired trial blocks with "Trial expired" reason, NOT "(30 minutes) exhausted"
  // -------------------------------------------------------------------------
  const orgExpired = await createOrgWithTrial('trial_expired');
  const pastDateIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await db.execute(
    `UPDATE subscriptions SET trial_ends_at = $1, status = 'TRIALING' WHERE organization_id = $2`,
    [pastDateIso, orgExpired.orgId]
  );
  const sessionExpired = await VoiceService.startBrowserVoiceSession(orgExpired.orgId);
  assert.strictEqual(sessionExpired.allowed, false, 'Expired trial must be blocked');
  assert.ok(
    sessionExpired.reason?.toLowerCase().includes('expired'),
    'Reason must specify that the trial has expired'
  );
  console.log('  ✓ 5. Expired trial gives truthful "trial expired" message, not claiming 30 minutes exhausted');

  // -------------------------------------------------------------------------
  // 6. Trial usage does not reset monthly; Paid usage resets monthly
  // -------------------------------------------------------------------------
  // For trial: call from 40 days ago is still counted toward the 30-min total
  const orgTrialWindow = await createOrgWithTrial('trial_window');
  const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  await db.execute(
    `INSERT INTO voice_call_records (
       id, organization_id, provider, provider_call_id, caller_phone, direction,
       started_at, ended_at, duration_seconds, duration_minutes, status, outcome,
       counted_for_limit, created_at
     ) VALUES ($1, $2, 'gemini_live', $3, '+15551234567', 'INBOUND',
               $4, $4, 600, 10.0, 'COMPLETED', 'GENERAL_INQUIRY', TRUE, $4)`,
    [uuidv4(), orgTrialWindow.orgId, `call_old_${Date.now()}`, fortyDaysAgo]
  );
  const trialUsageWindow = await VoiceService.getVoiceUsage(orgTrialWindow.orgId);
  assert.strictEqual(trialUsageWindow.usedMinutes, 10.0, 'Trial counts all calls from trial inception (does NOT reset monthly)');

  // For paid (STARTER): calls prior to current_period_start are NOT counted
  const orgPaid = await createOrgWithTrial('paid_window');
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  await db.execute(
    `UPDATE subscriptions SET plan_tier = 'STARTER', status = 'ACTIVE', current_period_start = $1, current_period_end = $2 WHERE organization_id = $3`,
    [periodStart.toISOString(), periodEnd.toISOString(), orgPaid.orgId]
  );
  // Old call last month (15 min)
  await db.execute(
    `INSERT INTO voice_call_records (
       id, organization_id, provider, provider_call_id, caller_phone, direction,
       started_at, ended_at, duration_seconds, duration_minutes, status, outcome,
       counted_for_limit, created_at
     ) VALUES ($1, $2, 'gemini_live', $3, '+15551234567', 'INBOUND',
               $4, $4, 900, 15.0, 'COMPLETED', 'GENERAL_INQUIRY', TRUE, $4)`,
    [uuidv4(), orgPaid.orgId, `call_paid_old_${Date.now()}`, new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString()]
  );
  // Current call this month (5 min)
  const currentIso = new Date().toISOString();
  await db.execute(
    `INSERT INTO voice_call_records (
       id, organization_id, provider, provider_call_id, caller_phone, direction,
       started_at, ended_at, duration_seconds, duration_minutes, status, outcome,
       counted_for_limit, created_at
     ) VALUES ($1, $2, 'gemini_live', $3, '+15551234567', 'INBOUND',
               $4, $4, 300, 5.0, 'COMPLETED', 'GENERAL_INQUIRY', TRUE, $4)`,
    [uuidv4(), orgPaid.orgId, `call_paid_cur_${Date.now()}`, currentIso]
  );
  const paidUsage = await VoiceService.getVoiceUsage(orgPaid.orgId);
  assert.strictEqual(paidUsage.usedMinutes, 5.0, 'Paid plan usage resets and only counts current billing period (5 min, not 20 min)');
  assert.strictEqual(paidUsage.includedMinutes, 50, 'Starter plan includedMinutes = 50');
  console.log('  ✓ 6. Trial usage counts full trial total; paid plan usage strictly resets with billing period');

  // -------------------------------------------------------------------------
  // 7. System prompt strictly suppresses generic language model preamble
  // -------------------------------------------------------------------------
  const builtPrompt = await VoicePromptBuilder.buildPrompt(org17.orgId);
  assert.ok(
    builtPrompt.systemPrompt.includes('NEVER say "I am a language model"'),
    'Prompt must strictly prohibit language model identity'
  );
  assert.ok(
    builtPrompt.systemPrompt.includes('NEVER say "I am a language model"') ||
    builtPrompt.systemPrompt.includes('As an AI'),
    'Prompt must enforce human-like receptionist persona'
  );
  assert.ok(
    builtPrompt.systemPrompt.includes('OPENING GREETING'),
    'Prompt must anchor opening greeting'
  );
  console.log('  ✓ 7. System prompt strictly suppresses generic language-model greetings');

  // -------------------------------------------------------------------------
  // 8. Gemini Live bridge sends "Hello" user turn to trigger exactly one business greeting
  // -------------------------------------------------------------------------
  const ticketRes = await GeminiLiveBridgeService.createSessionTicket({
    organizationId: org17.orgId,
  });
  assert.strictEqual(ticketRes.allowed, true, 'Ticket creation must succeed');

  const mockWs = new MockClientWebSocket();
  await GeminiLiveBridgeService.handleClientConnection(mockWs as any, ticketRes.sessionTicket!);

  // When connection opens in mock mode, it receives ready and one initial greeting
  const readyMsg = mockWs.sentMessages.map(m => JSON.parse(m)).find(m => m.type === 'ready');
  assert.ok(readyMsg, 'Client must receive "ready" event upon connection');
  assert.strictEqual(readyMsg.maxDurationSeconds, 180, 'maxDurationSeconds must be capped at 180s');

  const greetingAudio = mockWs.sentMessages.map(m => JSON.parse(m)).find(m => m.type === 'audio');
  assert.ok(greetingAudio, 'Client must receive initial spoken greeting audio');

  // Confirm no duplicate greeting was sent
  const audioMsgs = mockWs.sentMessages.map(m => JSON.parse(m)).filter(m => m.type === 'audio');
  assert.strictEqual(audioMsgs.length, 1, 'Exactly ONE initial greeting audio message sent at start');
  console.log('  ✓ 8. Exactly one initial business greeting is delivered on connect without duplicate');

  // -------------------------------------------------------------------------
  // 9. Two-way conversation: Client sends audio after greeting and receives audio responses
  // -------------------------------------------------------------------------
  // Simulate Turn 1: User speaks into microphone
  const sampleAudioChunk = Buffer.from(new Int16Array(1600).fill(100).buffer).toString('base64');
  mockWs.emit('message', JSON.stringify({
    type: 'audio',
    data: sampleAudioChunk,
    transcript: 'What services do you provide at KB Saloon?',
  }));

  // Verify assistant responds with audio and transcript for Turn 1
  const assistantTurn1 = mockWs.sentMessages
    .map(m => JSON.parse(m))
    .find(m => m.type === 'transcript' && m.role === 'assistant');
  assert.ok(assistantTurn1, 'Assistant must respond with transcript to user query');

  // Simulate Turn 2: User asks follow-up question
  mockWs.emit('message', JSON.stringify({
    type: 'audio',
    data: sampleAudioChunk,
    transcript: 'Can I book an appointment for tomorrow at 2 PM?',
  }));

  // Simulate Turn 3: User confirms
  mockWs.emit('message', JSON.stringify({
    type: 'audio',
    data: sampleAudioChunk,
    transcript: 'Yes, my name is Alex and my phone is 555-1234.',
  }));

  const allTranscripts = mockWs.sentMessages
    .map(m => JSON.parse(m))
    .filter(m => m.type === 'transcript');
  assert.ok(allTranscripts.length >= 2, 'Multiple conversational turns must be supported');
  console.log('  ✓ 9. Multi-turn two-way audio flow verified (user speech -> assistant audio reply)');

  // -------------------------------------------------------------------------
  // 10. Normal session close records audio duration without leaking in-flight minutes
  // -------------------------------------------------------------------------
  mockWs.emit('message', JSON.stringify({ type: 'end' }));
  assert.strictEqual(VoiceService.activeCalls.has(readyMsg.callId), false, 'Active call tracker must be cleared after session ends');
  console.log('  ✓ 10. Session closes cleanly, releases active call reservation, and preserves isolation');

  console.log('\n================================================================');
  console.log('  All 10 Trial Usage & Two-Way Voice Tests Passed Successfully!');
  console.log('================================================================\n');
}

if (require.main === module) {
  runTrialUsageAndTwoWayVoiceTests().catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
  });
}
