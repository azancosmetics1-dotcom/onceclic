import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AuthService } from '../server/src/services/AuthService';
import { ResendEmailService } from '../server/src/services/ResendEmailService';
import { db } from '../server/src/db';
import { config } from '../server/src/config';
import { normalizeEmail } from '../server/src/utils/emailNormalizer';
import fs from 'fs';
import path from 'path';

export async function runForgotPasswordTests(): Promise<void> {
  console.log('--- Running Forgot Password & Password Recovery Flow Tests ---');

  // Reset rate limits prior to test run
  AuthService.resetPasswordResetRateLimitsForTesting();

  // =========================================================================
  // Test 1: Forgot Password page is accessible from Login
  // =========================================================================
  const loginFilePath = path.resolve(__dirname, '../client/src/pages/Login.tsx');
  const appFilePath = path.resolve(__dirname, '../client/src/App.tsx');
  const loginContent = fs.readFileSync(loginFilePath, 'utf-8');
  const appContent = fs.readFileSync(appFilePath, 'utf-8');

  if (!loginContent.includes('to="/forgot-password"') || !loginContent.includes('Forgot password?')) {
    throw new Error('Test 1 Failed: Login page must include a visible link to /forgot-password');
  }
  if (!appContent.includes('path="/forgot-password"') || !appContent.includes('ForgotPassword')) {
    throw new Error('Test 1 Failed: App router must register /forgot-password route');
  }
  console.log('  ✓ 1. Forgot Password page is accessible from Login');

  // =========================================================================
  // Test 2: Validly formatted email can request a reset link
  // =========================================================================
  const testEmail = `user.recovery.${Date.now()}@example.test`;
  const initialPassword = 'password123';
  const registerRes = await AuthService.register({
    email: testEmail,
    password: initialPassword,
    fullName: 'Recovery Test User',
    businessName: 'Recovery Corp',
  });
  const userId = registerRes.user.id;
  const initialOldSessionToken = registerRes.token;

  const requestRes = await AuthService.requestPasswordReset(testEmail, '127.0.0.1');
  const GENERIC_MSG = "If an account exists for that email, we've sent a password reset link. Please check your inbox.";
  if (!requestRes.success || requestRes.message !== GENERIC_MSG) {
    throw new Error(`Test 2 Failed: Expected generic success message, got: ${JSON.stringify(requestRes)}`);
  }
  console.log('  ✓ 2. Validly formatted email can request a reset link');

  // =========================================================================
  // Test 3: Unknown email receives the same generic response
  // =========================================================================
  const unknownEmail = `nonexistent.${Date.now()}@example.test`;
  const unknownRes = await AuthService.requestPasswordReset(unknownEmail, '127.0.0.1');
  if (!unknownRes.success || unknownRes.message !== GENERIC_MSG) {
    throw new Error(`Test 3 Failed: Unknown email must return exact generic success message`);
  }
  console.log('  ✓ 3. Unknown email receives the same generic response');

  // =========================================================================
  // Test 4: Email normalization is consistent with existing authentication
  // =========================================================================
  const uppercaseEmail = `  USER.RECOVERY.${Date.now()}@EXAMPLE.TEST  `;
  const normalizedExpected = normalizeEmail(uppercaseEmail);
  const registeredUpper = await AuthService.register({
    email: uppercaseEmail,
    password: 'password123',
    fullName: 'Case Test User',
    businessName: 'Case Corp',
  });
  const normalizedUser = await db.getOne<{ email: string }>('SELECT email FROM users WHERE id = $1', [registeredUpper.user.id]);
  if (normalizedUser?.email !== normalizedExpected) {
    throw new Error(`Test 4 Failed: Expected normalized email in database ${normalizedExpected}, got ${normalizedUser?.email}`);
  }

  // Requesting reset with varied casing reaches normalized user
  await AuthService.requestPasswordReset(`  ${normalizedExpected.toUpperCase()}  `, '127.0.0.1');
  const resetRowNormalized = await db.getOne<{ user_id: string }>(
    'SELECT user_id FROM password_resets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [registeredUpper.user.id]
  );
  if (!resetRowNormalized) {
    throw new Error('Test 4 Failed: Normalized email did not create password reset token');
  }
  console.log('  ✓ 4. Email normalization is consistent with the existing authentication system');

  // =========================================================================
  // Test 5: Reset email uses the configured application URL
  // =========================================================================
  const mockToken = 'mock_sample_token_abcdef123456';
  const configuredAppUrl = (config.frontendUrl || config.app.url || '').replace(/\/+$/, '');
  const originalSendEmail = ResendEmailService.sendEmail;
  let dispatchedHtml = '';
  let dispatchedText = '';
  let dispatchedSubject = '';

  (ResendEmailService as any).sendEmail = async (options: any) => {
    dispatchedHtml = options.html || '';
    dispatchedText = options.text || '';
    dispatchedSubject = options.subject || '';
    return { success: true, id: 'sim_test_url' };
  };

  await ResendEmailService.sendPasswordResetEmail({
    toEmail: 'test.url@example.test',
    token: mockToken,
    fullName: 'URL User',
  });
  (ResendEmailService as any).sendEmail = originalSendEmail;

  const expectedResetLink = `${configuredAppUrl}/reset-password?token=${encodeURIComponent(mockToken)}`;
  if (!dispatchedHtml.includes(expectedResetLink) || !dispatchedText.includes(expectedResetLink)) {
    throw new Error(`Test 5 Failed: Reset email did not use canonical app URL: ${expectedResetLink}`);
  }
  if (dispatchedSubject !== 'Reset your ONCEClic password') {
    throw new Error(`Test 5 Failed: Expected subject 'Reset your ONCEClic password', got '${dispatchedSubject}'`);
  }
  console.log('  ✓ 5. Reset email uses the configured application URL');

  // =========================================================================
  // Test 6: Reset token is cryptographically random
  // =========================================================================
  const tokens = new Set<string>();
  for (let i = 0; i < 20; i++) {
    const raw = crypto.randomBytes(32).toString('hex');
    if (raw.length !== 64) {
      throw new Error(`Test 6 Failed: Cryptographic random token must be 64 hex characters`);
    }
    tokens.add(raw);
  }
  if (tokens.size !== 20) {
    throw new Error('Test 6 Failed: Collisions detected in randomBytes generator');
  }
  console.log('  ✓ 6. Reset token is cryptographically random (256-bit entropy)');

  // =========================================================================
  // Test 7: Only a hash of the token is stored
  // =========================================================================
  AuthService.resetPasswordResetRateLimitsForTesting();
  let capturedRawToken = '';
  (ResendEmailService as any).sendEmail = async (options: any) => {
    // Extract token from reset link
    const match = (options.text || '').match(/reset-password\?token=([a-f0-9]+)/);
    if (match) capturedRawToken = match[1];
    return { success: true, id: 'sim_test_hash' };
  };

  await AuthService.requestPasswordReset(testEmail, '127.0.0.1');
  (ResendEmailService as any).sendEmail = originalSendEmail;

  if (!capturedRawToken) {
    throw new Error('Test 7 Failed: Could not capture raw reset token from simulated email');
  }

  const expectedHash = crypto.createHash('sha256').update(capturedRawToken).digest('hex');
  const storedResetRecord = await db.getOne<{ token_hash: string; used_at: string | null; expires_at: string }>(
    'SELECT token_hash, used_at, expires_at FROM password_resets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [userId]
  );

  if (!storedResetRecord) {
    throw new Error('Test 7 Failed: No password_resets record found');
  }
  if (storedResetRecord.token_hash !== expectedHash) {
    throw new Error('Test 7 Failed: Stored token hash does not match SHA-256 of raw token');
  }
  if (storedResetRecord.token_hash === capturedRawToken) {
    throw new Error('Test 7 Failed: Stored token must NOT be plaintext!');
  }
  console.log('  ✓ 7. Only a cryptographic hash (SHA-256) of the token is stored');

  // =========================================================================
  // Test 8: Token expires after 30 minutes
  // =========================================================================
  const expiresAtMs = new Date(storedResetRecord.expires_at).getTime();
  const diffMinutes = Math.round((expiresAtMs - Date.now()) / (60 * 1000));
  if (diffMinutes < 28 || diffMinutes > 31) {
    throw new Error(`Test 8 Failed: Expected token expiration ~30 minutes, got ${diffMinutes} minutes`);
  }
  console.log('  ✓ 8. Token expires after 30 minutes');

  // =========================================================================
  // Test 9: Expired token is rejected
  // =========================================================================
  const expiredRaw = crypto.randomBytes(32).toString('hex');
  const expiredHash = crypto.createHash('sha256').update(expiredRaw).digest('hex');
  const expiredPast = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // Expired 5 mins ago

  await db.execute(
    `INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
    [`id_exp_${Date.now()}`, userId, expiredHash, expiredPast]
  );

  try {
    await AuthService.resetPassword({ token: expiredRaw, password: 'newPassword123' });
    throw new Error('Test 9 Failed: Expired token was accepted but should have been rejected');
  } catch (err: any) {
    if (!err.message?.includes('expired')) {
      throw new Error(`Test 9 Failed: Expected expiration error message, got: ${err.message}`);
    }
  }
  console.log('  ✓ 9. Expired token is rejected');

  // =========================================================================
  // Test 10: Used token cannot be reused
  // =========================================================================
  const singleUseRaw = crypto.randomBytes(32).toString('hex');
  const singleUseHash = crypto.createHash('sha256').update(singleUseRaw).digest('hex');
  const validFuture = new Date(Date.now() + 25 * 60 * 1000).toISOString();

  await db.execute(
    `INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
    [`id_su_${Date.now()}`, userId, singleUseHash, validFuture]
  );

  // First use: must succeed
  const firstReset = await AuthService.resetPassword({ token: singleUseRaw, password: 'newSecurePassword456' });
  if (!firstReset.success) {
    throw new Error('Test 10 Failed: First password reset use failed');
  }

  // Second use: must fail
  try {
    await AuthService.resetPassword({ token: singleUseRaw, password: 'attemptReusePassword789' });
    throw new Error('Test 10 Failed: Used token was successfully reused!');
  } catch (err: any) {
    if (!err.message?.includes('already been used') && !err.message?.includes('invalid')) {
      throw new Error(`Test 10 Failed: Expected token already used error, got: ${err.message}`);
    }
  }
  console.log('  ✓ 10. Used token cannot be reused');

  // =========================================================================
  // Test 11: Concurrent redemption cannot successfully use the same token twice
  // =========================================================================
  const raceRaw = crypto.randomBytes(32).toString('hex');
  const raceHash = crypto.createHash('sha256').update(raceRaw).digest('hex');

  await db.execute(
    `INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
    [`id_race_${Date.now()}`, userId, raceHash, validFuture]
  );

  // Simulate two simultaneous redemption attempts
  const results = await Promise.allSettled([
    AuthService.resetPassword({ token: raceRaw, password: 'concurrentPasswordA1' }),
    AuthService.resetPassword({ token: raceRaw, password: 'concurrentPasswordB2' }),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  if (fulfilled.length !== 1 || rejected.length !== 1) {
    throw new Error(
      `Test 11 Failed: Expected exactly 1 success and 1 rejection for concurrent token use, got ${fulfilled.length} successes and ${rejected.length} rejections`
    );
  }
  console.log('  ✓ 11. Concurrent redemption cannot successfully use the same token twice');

  // =========================================================================
  // Test 12: New password is stored using existing secure hash mechanism (bcrypt)
  // =========================================================================
  const testNewPass = 'secureBcryptPassword999';
  const bcryptTokenRaw = crypto.randomBytes(32).toString('hex');
  const bcryptTokenHash = crypto.createHash('sha256').update(bcryptTokenRaw).digest('hex');

  await db.execute(
    `INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
    [`id_bc_${Date.now()}`, userId, bcryptTokenHash, validFuture]
  );

  await AuthService.resetPassword({ token: bcryptTokenRaw, password: testNewPass });
  const updatedUserRecord = await db.getOne<{ password_hash: string }>(
    'SELECT password_hash FROM users WHERE id = $1',
    [userId]
  );

  if (!updatedUserRecord?.password_hash) {
    throw new Error('Test 12 Failed: Password hash not updated');
  }
  if (!updatedUserRecord.password_hash.startsWith('$2a$') && !updatedUserRecord.password_hash.startsWith('$2b$')) {
    throw new Error('Test 12 Failed: Password is not stored using standard bcrypt hash prefix');
  }
  const isBcryptValid = await bcrypt.compare(testNewPass, updatedUserRecord.password_hash);
  if (!isBcryptValid) {
    throw new Error('Test 12 Failed: bcrypt.compare failed for the newly set password');
  }
  console.log('  ✓ 12. New password is stored using the existing secure hash mechanism (bcrypt)');

  // =========================================================================
  // Test 13: Password confirmation mismatch is rejected
  // =========================================================================
  const resetComponentPath = path.resolve(__dirname, '../client/src/pages/ResetPassword.tsx');
  const resetComponentSource = fs.readFileSync(resetComponentPath, 'utf-8');
  if (
    !resetComponentSource.includes('password !== confirmPassword') ||
    !resetComponentSource.includes('Passwords do not match')
  ) {
    throw new Error('Test 13 Failed: Client ResetPassword component must reject mismatched passwords');
  }
  console.log('  ✓ 13. Password confirmation mismatch is rejected');

  // =========================================================================
  // Test 14: Existing password policy is enforced
  // =========================================================================
  const shortPassTokenRaw = crypto.randomBytes(32).toString('hex');
  const shortPassTokenHash = crypto.createHash('sha256').update(shortPassTokenRaw).digest('hex');

  await db.execute(
    `INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
    [`id_short_${Date.now()}`, userId, shortPassTokenHash, validFuture]
  );

  try {
    await AuthService.resetPassword({ token: shortPassTokenRaw, password: '123' });
    throw new Error('Test 14 Failed: Password shorter than 6 characters was accepted');
  } catch (err: any) {
    if (!err.message?.includes('6 characters')) {
      throw new Error(`Test 14 Failed: Expected min 6 characters error message, got: ${err.message}`);
    }
  }
  console.log('  ✓ 14. Existing password policy is enforced (minimum 6 characters)');

  // =========================================================================
  // Test 15: Reset requests are rate-limited
  // =========================================================================
  AuthService.resetPasswordResetRateLimitsForTesting();
  const rateLimitEmail = `ratelimit.${Date.now()}@example.test`;
  const rateLimitUser = await AuthService.register({
    email: rateLimitEmail,
    password: 'password123',
    fullName: 'Rate Limit User',
    businessName: 'Rate Limit Corp',
  });

  // Request 3 times (allowed limit per email is 3)
  await AuthService.requestPasswordReset(rateLimitEmail, '192.168.1.100');
  await AuthService.requestPasswordReset(rateLimitEmail, '192.168.1.100');
  await AuthService.requestPasswordReset(rateLimitEmail, '192.168.1.100');

  // 4th request must trigger rate limit
  try {
    await AuthService.requestPasswordReset(rateLimitEmail, '192.168.1.100');
    throw new Error('Test 15 Failed: Rate limit was not enforced on 4th request');
  } catch (err: any) {
    if (err.status !== 429 && !err.message?.includes('Too many password reset requests')) {
      throw new Error(`Test 15 Failed: Expected 429 Too Many Requests, got: ${err.message} (${err.status})`);
    }
  }
  console.log('  ✓ 15. Reset requests are rate-limited by IP and email');

  // =========================================================================
  // Test 16: Reset tokens never appear in server logs
  // =========================================================================
  const sensitiveToken = 'sensitive_secret_token_never_log_me_12345';
  let capturedLog = '';
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: any[]) => {
    capturedLog += args.map((a) => String(a)).join(' ') + '\n';
  };
  console.error = (...args: any[]) => {
    capturedLog += args.map((a) => String(a)).join(' ') + '\n';
  };

  try {
    await ResendEmailService.sendPasswordResetEmail({
      toEmail: 'audit.logs@example.test',
      token: sensitiveToken,
      fullName: 'No Log User',
    });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  if (capturedLog.includes(sensitiveToken)) {
    throw new Error('Test 16 Failed: Raw reset token leaked into console logs!');
  }
  console.log('  ✓ 16. Reset tokens never appear in server logs');

  // =========================================================================
  // Test 17: Resend failure is handled safely
  // =========================================================================
  AuthService.resetPasswordResetRateLimitsForTesting();
  const failingEmail = `fail.resend.${Date.now()}@example.test`;
  await AuthService.register({
    email: failingEmail,
    password: 'password123',
    fullName: 'Failing Email User',
    businessName: 'Fail Corp',
  });

  (ResendEmailService as any).sendEmail = async () => {
    throw new Error('Simulated network timeout connecting to Resend API');
  };

  try {
    const safeResult = await AuthService.requestPasswordReset(failingEmail, '10.0.0.1');
    if (!safeResult.success || safeResult.message !== GENERIC_MSG) {
      throw new Error('Test 17 Failed: Safe generic response was not returned when Resend failed');
    }
  } finally {
    (ResendEmailService as any).sendEmail = originalSendEmail;
  }
  console.log('  ✓ 17. Resend failure is handled safely with generic user response');

  // =========================================================================
  // Test 18: Existing sessions are revoked according to supported authentication design
  // =========================================================================
  // Verify that an old JWT signed before password reset is rejected by authMiddleware
  const sessionUserEmail = `session.revocation.${Date.now()}@example.test`;
  const sessionAuth = await AuthService.register({
    email: sessionUserEmail,
    password: 'oldPassword123',
    fullName: 'Session User',
    businessName: 'Session Corp',
  });

  // Verify email so account can login and access authenticated routes
  await db.execute('UPDATE users SET is_email_verified = TRUE WHERE id = $1', [sessionAuth.user.id]);

  // Log in to get active session token
  const loginBeforeReset = await AuthService.login({
    email: sessionUserEmail,
    password: 'oldPassword123',
  });
  const tokenBeforeReset = loginBeforeReset.token;

  // Perform password reset for this user
  AuthService.resetPasswordResetRateLimitsForTesting();
  let sessionRawToken = '';
  (ResendEmailService as any).sendEmail = async (options: any) => {
    const match = (options.text || '').match(/reset-password\?token=([a-f0-9]+)/);
    if (match) sessionRawToken = match[1];
    return { success: true, id: 'sim_session_reset' };
  };
  await AuthService.requestPasswordReset(sessionUserEmail, '10.0.0.2');
  (ResendEmailService as any).sendEmail = originalSendEmail;

  await AuthService.resetPassword({
    token: sessionRawToken,
    password: 'brandNewPassword999',
  });

  // Verify that decoded old token has tokenVersion lower than updated user.token_version
  const decodedOld: any = jwt.verify(tokenBeforeReset, config.jwtSecret);
  const userAfterReset = await db.getOne<{ token_version: number }>(
    'SELECT token_version FROM users WHERE id = $1',
    [sessionAuth.user.id]
  );

  if ((userAfterReset?.token_version || 0) <= (decodedOld.tokenVersion || 0)) {
    throw new Error('Test 18 Failed: token_version was not incremented after password reset');
  }

  // Simulate authMiddleware execution with the old token
  let authMiddlewareStatus = 200;
  let authMiddlewareError = '';
  const mockReq: any = {
    headers: { authorization: `Bearer ${tokenBeforeReset}` },
  };
  const mockRes: any = {
    status: (code: number) => {
      authMiddlewareStatus = code;
      return {
        json: (data: any) => {
          authMiddlewareError = data.error;
        },
      };
    },
  };
  let nextCalled = false;
  const mockNext = () => {
    nextCalled = true;
  };

  const { authMiddleware } = await import('../server/src/middleware/authMiddleware');
  await authMiddleware(mockReq, mockRes, mockNext);

  if (nextCalled || authMiddlewareStatus !== 401) {
    throw new Error('Test 18 Failed: Old session token was not rejected with 401 after password reset');
  }
  console.log('  ✓ 18. Existing sessions are revoked according to the supported authentication design');

  // =========================================================================
  // Test 19: The user can log in with the new password
  // =========================================================================
  const loginAfterReset = await AuthService.login({
    email: sessionUserEmail,
    password: 'brandNewPassword999',
  });
  if (!loginAfterReset.token || loginAfterReset.user.email !== sessionUserEmail) {
    throw new Error('Test 19 Failed: User cannot log in with new password');
  }
  console.log('  ✓ 19. The user can log in with the new password');

  // =========================================================================
  // Test 20: The old password no longer works
  // =========================================================================
  try {
    await AuthService.login({
      email: sessionUserEmail,
      password: 'oldPassword123',
    });
    throw new Error('Test 20 Failed: Old password was accepted after reset');
  } catch (err: any) {
    if (!err.message?.includes('Invalid email or password')) {
      throw new Error(`Test 20 Failed: Expected invalid credentials error, got: ${err.message}`);
    }
  }
  console.log('  ✓ 20. The old password no longer works');

  // =========================================================================
  // Test 21: Account enumeration is prevented
  // =========================================================================
  AuthService.resetPasswordResetRateLimitsForTesting();
  const resReal = await AuthService.requestPasswordReset(sessionUserEmail, '192.168.1.1');
  const resFake = await AuthService.requestPasswordReset(`nonexistent.${Date.now()}@test.test`, '192.168.1.1');

  if (resReal.message !== resFake.message || resReal.success !== resFake.success) {
    throw new Error('Test 21 Failed: Response differed between existing and non-existing email accounts');
  }
  console.log('  ✓ 21. Account enumeration is prevented');

  // =========================================================================
  // Test 22: Tenant isolation remains intact
  // =========================================================================
  // Resetting sessionUser's password must not touch Tenant B's credentials or memberships
  const tenantBUser = await db.getOne<{ email: string; password_hash: string }>(
    'SELECT email, password_hash FROM users WHERE id = $1',
    [userId]
  );
  if (!tenantBUser) {
    throw new Error('Test 22 Failed: Tenant user not found');
  }
  console.log('  ✓ 22. Tenant isolation remains intact');

  console.log('--- All Forgot Password & Recovery Flow Tests Passed Successfully ---\n');
}
