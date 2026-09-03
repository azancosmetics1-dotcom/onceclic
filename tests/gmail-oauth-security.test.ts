import assert from 'assert';
import jwt from 'jsonwebtoken';
import { db } from '../server/src/db';
import { config } from '../server/src/config';
import { AuthService } from '../server/src/services/AuthService';
import { IntegrationService } from '../server/src/services/IntegrationService';
import { EmailService } from '../server/src/services/EmailService';
import { encrypt, decrypt, isEncrypted } from '../server/src/utils/crypto';
import { IntegrationStatus } from '@onceclic/shared';
import { v4 as uuidv4 } from 'uuid';

export async function runGmailOAuthSecurityTests() {
  console.log('--- Running Gmail OAuth, Token Encryption & Security Hardening Tests ---');

  // 1. Setup Test User and Organizations (Org A & Org B for Tenant Isolation)
  const testEmailA = `gmail_sec_a_${Date.now()}@example.com`;
  const regA = await AuthService.register({
    email: testEmailA,
    password: 'Password123!',
    fullName: 'Alice Tenant A',
    businessName: 'Tenant A Salon',
  });
  const orgAId = regA.organization!.id;
  const userAId = regA.user.id;

  const testEmailB = `gmail_sec_b_${Date.now()}@example.com`;
  const regB = await AuthService.register({
    email: testEmailB,
    password: 'Password123!',
    fullName: 'Bob Tenant B',
    businessName: 'Tenant B Garage',
  });
  const orgBId = regB.organization!.id;
  const userBId = regB.user.id;

  // 2. Test AES-256-GCM Token Encryption & Decryption
  const rawSecretToken = 'ya29.a0AfH6SMD_SampleGoogleOAuthAccessToken_VerySensitiveSecret_12345';
  const encrypted = encrypt(rawSecretToken);

  assert.ok(isEncrypted(encrypted), 'Token format identified as encrypted iv:tag:data');
  assert.notStrictEqual(encrypted, rawSecretToken, 'Encrypted token is not plaintext');
  assert.strictEqual(encrypted.includes(rawSecretToken), false, 'Encrypted token does not leak secret');

  const decrypted = decrypt(encrypted);
  assert.strictEqual(decrypted, rawSecretToken, 'Decrypted token matches original secret');

  // Test Tamper-proofing (altering auth tag or ciphertext throws)
  const parts = encrypted.split(':');
  const tamperedCipher = `${parts[0]}:${parts[1]}:${parts[2].slice(0, -2)}99`;
  assert.throws(() => {
    decrypt(tamperedCipher);
  }, 'Tampered ciphertext fails AES-GCM authentication tag check');
  console.log('  ✓ AES-256-GCM encryption, decryption, and tamper-proofing verified');

  // 3. Test OAuth State Generation & Persistence in oauth_states
  const prevClientId = config.google.clientId;
  const prevClientSecret = config.google.clientSecret;
  config.google.clientId = config.google.clientId || 'mock_google_client_id.apps.googleusercontent.com';
  config.google.clientSecret = config.google.clientSecret || 'mock_google_client_secret_xyz';

  const authUrlRes = await IntegrationService.getGoogleEmailAuthUrl(orgAId, userAId, '/app/integrations');
  assert.ok(authUrlRes.url.includes('accounts.google.com'), 'Auth URL points to Google');
  assert.ok(authUrlRes.url.includes('gmail.readonly'), 'Auth URL contains gmail.readonly scope');
  assert.ok(authUrlRes.url.includes('gmail.send'), 'Auth URL contains gmail.send scope');
  assert.ok(authUrlRes.state, 'Auth URL contains signed state token');

  const decodedState = jwt.verify(authUrlRes.state, config.jwtSecret) as any;
  assert.strictEqual(decodedState.organizationId, orgAId, 'OAuth state bound to Org A');
  assert.strictEqual(decodedState.userId, userAId, 'OAuth state bound to User A');

  const dbState = await db.getOne<{
    id: string;
    state_hash: string;
    organization_id: string;
    user_id: string;
    consumed_at: string | null;
  }>('SELECT * FROM oauth_states WHERE state_hash = $1', [decodedState.stateHash]);

  assert.ok(dbState, 'State record successfully inserted into oauth_states table');
  assert.strictEqual(dbState!.organization_id, orgAId, 'DB state matches organization ID');
  assert.strictEqual(dbState!.user_id, userAId, 'DB state matches initiating user ID');
  assert.strictEqual(dbState!.consumed_at, null, 'State is unconsumed on generation');
  console.log('  ✓ OAuth state securely generated, bound to User+Org, and persisted');

  // 4. Test One-Time-Use & Replay Protection
  // Simulate mock token exchange & capability test callback
  const mockGmailAddress = `salon_${Date.now()}@tenant-a.com`;
  const mockCode = 'mock_google_auth_code_123';
  const originalFetch = global.fetch;

  // Mock Google token exchange and Gmail profile API responses
  global.fetch = async (url: any, init?: any) => {
    const urlStr = String(url);
    if (urlStr.includes('oauth2.googleapis.com/token')) {
      return {
        ok: true,
        json: async () => ({
          access_token: 'mock_access_token_abc',
          refresh_token: 'mock_refresh_token_xyz',
          expires_in: 3600,
        }),
      } as any;
    }
    if (urlStr.includes('gmail.googleapis.com/gmail/v1/users/me/profile')) {
      return {
        ok: true,
        json: async () => ({
          emailAddress: mockGmailAddress,
          messagesTotal: 10,
        }),
      } as any;
    }
    return originalFetch(url, init);
  };

  const callbackRes = await IntegrationService.handleGoogleEmailCallback(
    mockCode,
    authUrlRes.state,
    userAId
  );
  assert.strictEqual(callbackRes.organizationId, orgAId);
  assert.strictEqual(callbackRes.connectedEmail, mockGmailAddress);

  // Verify tokens are stored ENCRYPTED in DB
  const storedConn = await db.getOne<{
    access_token: string;
    refresh_token: string;
    status: string;
    is_active: boolean;
  }>('SELECT access_token, refresh_token, status, is_active FROM email_connections WHERE organization_id = $1', [
    orgAId,
  ]);

  assert.strictEqual(storedConn?.status, 'CONNECTED', 'Connection status is CONNECTED');
  assert.strictEqual(storedConn?.is_active, true, 'Connection is_active is true');
  assert.ok(isEncrypted(storedConn?.access_token!), 'Stored access token is encrypted');
  assert.ok(isEncrypted(storedConn?.refresh_token!), 'Stored refresh token is encrypted');

  // Replay Attack Test: Attempting to call callback again with same state must fail
  let replayError = false;
  try {
    await IntegrationService.handleGoogleEmailCallback(mockCode, authUrlRes.state, userAId);
  } catch (err: any) {
    replayError = true;
    assert.ok(err.message.includes('already been consumed'), 'Replay error message matches');
  }
  assert.strictEqual(replayError, true, 'Replaying consumed OAuth state was rejected');
  console.log('  ✓ OAuth state one-time consumption & replay attack protection verified');

  // 5. Test Expired State Rejection
  const expiredAuth = await IntegrationService.getGoogleEmailAuthUrl(orgAId, userAId);
  const expiredDecoded = jwt.verify(expiredAuth.state, config.jwtSecret) as any;
  await db.execute('UPDATE oauth_states SET expires_at = $1 WHERE state_hash = $2', [
    new Date(Date.now() - 60000).toISOString(),
    expiredDecoded.stateHash,
  ]);

  let expiredBlocked = false;
  try {
    await IntegrationService.handleGoogleEmailCallback(mockCode, expiredAuth.state, userAId);
  } catch (err: any) {
    expiredBlocked = true;
    assert.ok(err.message.includes('expired'), 'Expired state error detected');
  }
  assert.strictEqual(expiredBlocked, true, 'Expired OAuth state was rejected');
  console.log('  ✓ Expired OAuth state rejection verified');

  // 6. Test Tenant & User Mismatch Rejection
  const tenantAuth = await IntegrationService.getGoogleEmailAuthUrl(orgAId, userAId);

  let userMismatchBlocked = false;
  try {
    // Calling with userBId who did not initiate the auth
    await IntegrationService.handleGoogleEmailCallback(mockCode, tenantAuth.state, userBId);
  } catch (err: any) {
    userMismatchBlocked = true;
    assert.ok(err.message.includes('mismatch'), 'User mismatch detected');
  }
  assert.strictEqual(userMismatchBlocked, true, 'Cross-user callback attempt blocked');
  console.log('  ✓ User & Tenant isolation on OAuth state verified');

  // 7. Test Inbound Email Pipeline Guardrails (Self-reply & Daemon prevention)
  // A. Self-reply prevention (Email from connected email)
  const selfReplyRes = await EmailService.processInboundEmail({
    fromEmail: mockGmailAddress,
    toEmail: mockGmailAddress,
    subject: 'Confirmation',
    textBody: 'Hello this is our own message',
  });
  assert.strictEqual(selfReplyRes.success, true);
  assert.strictEqual(selfReplyRes.aiReplySent, undefined, 'Self-reply prevented from triggering AI reply loop');

  // B. Daemon prevention
  const daemonRes = await EmailService.processInboundEmail({
    fromEmail: 'mailer-daemon@googlemail.com',
    toEmail: mockGmailAddress,
    subject: 'Delivery Status Notification',
    textBody: 'Message delivery failed',
  });
  assert.strictEqual(daemonRes.success, true);
  assert.strictEqual(daemonRes.aiReplySent, undefined, 'Mailer daemon notification skipped');

  // C. Inbound customer inquiry
  const customerEmail = 'customer.jane@example.com';
  const customerInbound = await EmailService.processInboundEmail({
    fromEmail: customerEmail,
    fromName: 'Jane Customer',
    toEmail: mockGmailAddress,
    subject: 'Do you offer hair coloring?',
    textBody: 'Hi, I would like to know if you offer hair coloring and when you are open.',
    messageId: '<msg_jane_001@example.com>',
  });

  assert.strictEqual(customerInbound.success, true);
  assert.strictEqual(customerInbound.organizationId, orgAId, 'Message mapped to Tenant A');
  assert.ok(customerInbound.conversationId, 'Conversation created for customer inquiry');
  console.log('  ✓ Inbound email processed with anti-looping, tenant routing & AI response');

  // Restore fetch and clientId
  global.fetch = originalFetch;
  config.google.clientId = prevClientId;
  config.google.clientSecret = prevClientSecret;

  console.log('  ✓ All Gmail OAuth Security, Token Encryption & Pipeline Tests Passed!');
}
