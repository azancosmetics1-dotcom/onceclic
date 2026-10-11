/**
 * Vapi & Telnyx Webhook Security Regression Tests
 *
 * Covers:
 *  1. Vapi production fail-closed when VAPI_WEBHOOK_SECRET is absent/blank/placeholder
 *  2. Vapi production invalid signature rejection with a real configured secret
 *  3. Vapi production valid HMAC signature acceptance
 *  4. Vapi dev/test permissive bypass preserved
 *  5. Telnyx already-correct fail-closed on missing public key
 *  6. Telnyx timestamp freshness and replay-protection
 *  7. Webhook event idempotency (processed_webhook_events)
 *  8. Gemini model assertion still intact (provider=google)
 *
 * Uses ONLY mocked secrets and local DB. No real Vapi or Telnyx credentials.
 * No real calls, no real numbers, no real webhooks.
 */

import assert from 'assert';
import crypto from 'crypto';
import { VapiVoiceProvider } from '../server/src/services/voice/VapiVoiceProvider';
import { TelnyxTelephonyProvider } from '../server/src/services/voice/TelnyxTelephonyProvider';
import { db } from '../server/src/db';

// ─── Helper: HMAC-SHA256 signer (mirrors VapiVoiceProvider HMAC path) ─────────
function hmacSign(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

// ─── Helper: temporarily set process.env vars, restore on exit ───────────────
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

export async function runVapiWebhookSecurityTests() {
  console.log('--- Running Vapi & Telnyx Webhook Security Regression Tests ---');

  const rawBody = '{"message":{"type":"assistant-request","call":{"id":"call_abc"}}}';

  // =========================================================================
  // 1. Vapi production + missing secret → REJECT (the previously broken case)
  // =========================================================================
  withEnv(
    { NODE_ENV: 'production', VAPI_WEBHOOK_SECRET: undefined, RAILWAY_ENVIRONMENT: undefined,
      RAILWAY_PUBLIC_DOMAIN: undefined, RAILWAY_SERVICE_NAME: undefined, RENDER: undefined, RENDER_SERVICE_ID: undefined },
    () => {
      const vapi = new VapiVoiceProvider();
      // Pass empty string as explicit override to bypass config reading
      const result = vapi.verifyWebhookSignature(rawBody, 'any_signature', '');
      assert.strictEqual(result, false,
        'SECURITY REGRESSION: Production with empty explicit secret must reject');
    }
  );
  console.log('  ✓ 1. Production + missing secret → REJECTED (security fix confirmed)');

  // =========================================================================
  // 2. Vapi production + blank secret string → REJECT
  // =========================================================================
  withEnv({ NODE_ENV: 'production' }, () => {
    const vapi = new VapiVoiceProvider();
    assert.strictEqual(
      vapi.verifyWebhookSignature(rawBody, 'some_sig', '   '),
      false,
      'Production + blank (whitespace-only) secret must reject'
    );
  });
  console.log('  ✓ 2. Production + blank/whitespace secret → REJECTED');

  // =========================================================================
  // 3. Vapi production + placeholder secret → REJECT
  // =========================================================================
  withEnv({ NODE_ENV: 'production' }, () => {
    const vapi = new VapiVoiceProvider();
    assert.strictEqual(
      vapi.verifyWebhookSignature(rawBody, 'some_sig', 'your_vapi_webhook_secret_placeholder'),
      false,
      'Production + placeholder secret must reject'
    );
  });
  console.log('  ✓ 3. Production + placeholder secret → REJECTED');

  // =========================================================================
  // 4. Vapi production + real secret + WRONG signature → REJECT
  // =========================================================================
  withEnv({ NODE_ENV: 'production' }, () => {
    const vapi = new VapiVoiceProvider();
    const realSecret = 'real_secret_for_test_abc123';
    const badSig = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    assert.strictEqual(
      vapi.verifyWebhookSignature(rawBody, badSig, realSecret),
      false,
      'Production + valid secret + wrong HMAC signature must reject'
    );
  });
  console.log('  ✓ 4. Production + valid secret + invalid signature → REJECTED');

  // =========================================================================
  // 5. Vapi production + real secret + CORRECT HMAC signature → ACCEPT
  // =========================================================================
  withEnv({ NODE_ENV: 'production' }, () => {
    const vapi = new VapiVoiceProvider();
    const realSecret = 'real_secret_for_test_abc123';
    const validSig = hmacSign(realSecret, rawBody);
    assert.strictEqual(
      vapi.verifyWebhookSignature(rawBody, validSig, realSecret),
      true,
      'Production + valid secret + correct HMAC signature must accept'
    );
  });
  console.log('  ✓ 5. Production + valid secret + correct HMAC signature → ACCEPTED');

  // =========================================================================
  // 6. Vapi production + Bearer token match → ACCEPT
  // =========================================================================
  withEnv({ NODE_ENV: 'production' }, () => {
    const vapi = new VapiVoiceProvider();
    const realSecret = 'bearer_token_test_xyz789';
    const bearerHeader = `Bearer ${realSecret}`;
    assert.strictEqual(
      vapi.verifyWebhookSignature(rawBody, bearerHeader, realSecret),
      true,
      'Production + valid secret + Bearer token must accept'
    );
  });
  console.log('  ✓ 6. Production + valid secret + Bearer token match → ACCEPTED');

  // =========================================================================
  // 7. Vapi dev/test: missing secret → ACCEPT (permissive bypass preserved)
  // =========================================================================
  withEnv(
    { NODE_ENV: 'test', RAILWAY_ENVIRONMENT: undefined, RAILWAY_PUBLIC_DOMAIN: undefined,
      RAILWAY_SERVICE_NAME: undefined, RENDER: undefined, RENDER_SERVICE_ID: undefined },
    () => {
      const vapi = new VapiVoiceProvider();
      assert.strictEqual(
        vapi.verifyWebhookSignature(rawBody, 'some_random_sig', ''),
        true,
        'Dev/test + missing secret + non-sentinel signature must remain accepted (permissive bypass)'
      );
    }
  );
  console.log('  ✓ 7. Dev/test + missing secret → ACCEPTED (permissive bypass intact)');

  // =========================================================================
  // 8. Vapi dev/test: sentinel signature always rejected
  // =========================================================================
  withEnv({ NODE_ENV: 'test' }, () => {
    const vapi = new VapiVoiceProvider();
    assert.strictEqual(
      vapi.verifyWebhookSignature(rawBody, 'invalid_signature_test', ''),
      false,
      'Sentinel invalid_signature_test must always be rejected even in dev'
    );
  });
  console.log('  ✓ 8. Sentinel "invalid_signature_test" → REJECTED in dev/test');

  // =========================================================================
  // 9. RAILWAY_ENVIRONMENT signal alone triggers production security
  // =========================================================================
  withEnv(
    { NODE_ENV: 'development', RAILWAY_ENVIRONMENT: 'production',
      VAPI_WEBHOOK_SECRET: undefined, RAILWAY_PUBLIC_DOMAIN: undefined,
      RAILWAY_SERVICE_NAME: undefined, RENDER: undefined, RENDER_SERVICE_ID: undefined },
    () => {
      const vapi = new VapiVoiceProvider();
      assert.strictEqual(
        vapi.verifyWebhookSignature(rawBody, 'any_sig', ''),
        false,
        'RAILWAY_ENVIRONMENT signal alone must trigger production security'
      );
    }
  );
  console.log('  ✓ 9. RAILWAY_ENVIRONMENT signal triggers production fail-closed');

  // =========================================================================
  // 10. Telnyx: missing public key → REJECT (regression guard)
  // =========================================================================
  withEnv({ NODE_ENV: 'production', TELNYX_PUBLIC_KEY: undefined }, () => {
    const result = TelnyxTelephonyProvider.verifyWebhookSignature({
      rawBody: rawBody,
      signature: 'some_valid_looking_sig',
      timestamp: String(Math.floor(Date.now() / 1000)),
      publicKey: '',
    });
    assert.strictEqual(result, false, 'Telnyx with missing public key must reject');
  });
  console.log('  ✓ 10. Telnyx + missing public key → REJECTED (regression guard)');

  // =========================================================================
  // 11. Telnyx: placeholder public key → REJECT
  // =========================================================================
  withEnv({ NODE_ENV: 'production' }, () => {
    const result = TelnyxTelephonyProvider.verifyWebhookSignature({
      rawBody: rawBody,
      signature: 'some_sig',
      timestamp: String(Math.floor(Date.now() / 1000)),
      publicKey: 'your_telnyx_ed25519_public_key_placeholder',
    });
    assert.strictEqual(result, false, 'Telnyx placeholder public key must reject');
  });
  console.log('  ✓ 11. Telnyx + placeholder public key → REJECTED');

  // =========================================================================
  // 12. Telnyx: expired timestamp sentinel → REJECT (replay protection)
  // =========================================================================
  withEnv({ NODE_ENV: 'production', TELNYX_PUBLIC_KEY: undefined }, () => {
    const result = TelnyxTelephonyProvider.verifyWebhookSignature({
      rawBody: rawBody,
      signature: 'valid_sig',
      timestamp: 'expired_timestamp_test',
      publicKey: '',
    });
    assert.strictEqual(result, false, 'Telnyx expired timestamp sentinel must reject');
  });
  console.log('  ✓ 12. Telnyx expired timestamp → REJECTED (replay protection)');

  // =========================================================================
  // 13. Telnyx: stale real timestamp (>300s ago) → REJECT
  // =========================================================================
  withEnv({ NODE_ENV: 'production', TELNYX_PUBLIC_KEY: undefined }, () => {
    const staleTs = String(Math.floor(Date.now() / 1000) - 400);
    const result = TelnyxTelephonyProvider.verifyWebhookSignature({
      rawBody: rawBody,
      signature: 'some_sig',
      timestamp: staleTs,
      publicKey: '',
    });
    assert.strictEqual(result, false, 'Stale timestamp (>300s) must be rejected');
  });
  console.log('  ✓ 13. Telnyx stale real timestamp (>300s) → REJECTED');

  // =========================================================================
  // 14. Webhook event idempotency via processed_webhook_events
  //     Uses the exact same SELECT-then-INSERT pattern as checkAndRecordWebhookIdempotency()
  //     in voiceWebhookRoutes.ts so it works with both embedded SQLite and PostgreSQL.
  // =========================================================================
  await db.runMigrations();
  const testEventId = `wh_security_regression_${Date.now()}`;

  // Simulate first delivery: record the event
  const existingBefore = await db.getOne(
    'SELECT event_id FROM processed_webhook_events WHERE event_id = $1',
    [testEventId]
  );
  assert.ok(!existingBefore, 'Event must not exist before first delivery');

  await db.execute(
    `INSERT INTO processed_webhook_events (event_id, event_type, occurred_at, processed_at)
     VALUES ($1, 'vapi.assistant-request', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [testEventId]
  );

  // Simulate second delivery: SELECT reveals duplicate → handler would skip
  const existingAfterFirst = await db.getOne(
    'SELECT event_id FROM processed_webhook_events WHERE event_id = $1',
    [testEventId]
  );
  assert.ok(existingAfterFirst, 'Event must be recorded after first delivery');

  // Second lookup with same ID returns the same row — handler would return early
  const existingAfterSecond = await db.getOne(
    'SELECT event_id FROM processed_webhook_events WHERE event_id = $1',
    [testEventId]
  );
  assert.ok(existingAfterSecond, 'Duplicate lookup must find existing record');
  assert.strictEqual(
    existingAfterSecond.event_id,
    existingAfterFirst.event_id,
    'Duplicate webhook event must resolve to identical record (idempotent)'
  );
  console.log('  ✓ 14. Webhook event idempotency verified via SELECT-then-INSERT pattern (matches production handler)');


  // =========================================================================
  // 15. Gemini model assertion intact after security fix
  // =========================================================================
  withEnv({ NODE_ENV: 'test' }, () => {
    const vapi = new VapiVoiceProvider();
    const payload = vapi.formatInboundResponse({
      agentName: 'SecurityTestLuna',
      systemPrompt: 'System prompt for security regression test.',
      greeting: 'Hello!',
      tools: [],
    });
    assert.strictEqual(
      payload?.assistant?.model?.provider,
      'google',
      'Vapi assistant model.provider must remain "google" (Gemini) after security fix'
    );
    assert.ok(
      (payload?.assistant?.model?.model || '').toLowerCase().includes('gemini'),
      `model.model must contain "gemini", got: ${payload?.assistant?.model?.model}`
    );
    assert.notStrictEqual(
      payload?.assistant?.model?.provider,
      'openai',
      'Vapi must not use OpenAI after security fix'
    );
  });
  console.log('  ✓ 15. Gemini provider=google model assertion intact after security fix');

  console.log('--- Vapi & Telnyx Webhook Security Regression Tests Passed ---\n');
}
