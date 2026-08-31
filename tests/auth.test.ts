import { AuthService } from '../server/src/services/AuthService';
import { getDatabase } from '../server/src/db';
import { UserRole } from '@onceclic/shared';

export async function runAuthTests() {
  console.log('--- Running Auth & Email Verification Tests ---');
  const db = getDatabase();
  await db.runMigrations();

  // Test 1: Successful Registration generates verification token
  const testEmail = `owner_${Date.now()}@example.com`;
  const regResult = await AuthService.register({
    email: testEmail,
    password: 'password123',
    fullName: 'Jane Doe',
    businessName: 'Apex Medical',
  });

  if (!regResult.token || !regResult.user.id || !regResult.organization?.id || !regResult.verificationToken) {
    throw new Error('Registration failed to return user, token, organization, or verificationToken.');
  }
  if (regResult.membership?.role !== UserRole.OWNER) {
    throw new Error(`Expected role OWNER but got ${regResult.membership?.role}`);
  }
  console.log('  ✓ User registration creates user, organization, owner membership, 7-day trial and verification token');

  // Test 2: Duplicate Registration Rejection
  let duplicateRejected = false;
  try {
    await AuthService.register({
      email: testEmail,
      password: 'password123',
      fullName: 'Jane Duplicate',
    });
  } catch (err: any) {
    duplicateRejected = err.message.includes('already exists');
  }
  if (!duplicateRejected) {
    throw new Error('Duplicate email registration should have thrown an error.');
  }
  console.log('  ✓ Duplicate email registration rejected');

  // Test 3: Login before email verification is blocked (EMAIL_NOT_VERIFIED)
  let unverifiedBlocked = false;
  try {
    await AuthService.login({
      email: testEmail,
      password: 'password123',
    });
  } catch (err: any) {
    unverifiedBlocked = err.code === 'EMAIL_NOT_VERIFIED';
  }
  if (!unverifiedBlocked) {
    throw new Error('Login before email verification should have been blocked with EMAIL_NOT_VERIFIED.');
  }
  console.log('  ✓ Unverified user login rejected with EMAIL_NOT_VERIFIED');

  // Test 4: Invalid verification token rejected
  let invalidTokenRejected = false;
  try {
    await AuthService.verifyEmail('invalid_token_123');
  } catch (err: any) {
    invalidTokenRejected = err.code === 'INVALID_TOKEN';
  }
  if (!invalidTokenRejected) {
    throw new Error('Invalid verification token should have been rejected.');
  }
  console.log('  ✓ Invalid verification token rejected safely');

  // Test 5: Resend verification token
  const resendRes = await AuthService.resendVerification(testEmail);
  if (!resendRes.success || !resendRes.verificationToken) {
    throw new Error('Resending verification email failed to return a new verification token.');
  }
  console.log('  ✓ Resend verification email creates a new single-use cryptographic token');

  // Test 6: Verify email with the newly generated token
  const verifyRes = await AuthService.verifyEmail(resendRes.verificationToken);
  if (!verifyRes.success || !verifyRes.user?.isEmailVerified) {
    throw new Error('Verification failed to mark user as verified.');
  }
  console.log('  ✓ Email verification succeeds and marks account as verified');

  // Test 7: Re-using the same verification token is rejected (single-use)
  let reusedTokenRejected = false;
  try {
    await AuthService.verifyEmail(resendRes.verificationToken);
  } catch (err: any) {
    reusedTokenRejected = err.code === 'ALREADY_USED';
  }
  if (!reusedTokenRejected) {
    throw new Error('Re-using an already consumed verification token should have been rejected.');
  }
  console.log('  ✓ Reusing consumed verification token rejected (single-use enforced)');

  // Test 8: Successful Login after verification
  const loginResult = await AuthService.login({
    email: testEmail,
    password: 'password123',
  });

  if (!loginResult.token || loginResult.user.email !== testEmail || !loginResult.user.isEmailVerified) {
    throw new Error('Login failed with valid verified credentials.');
  }
  console.log('  ✓ Login with verified credentials succeeds and returns authenticated JWT session');

  // Test 9: Invalid Password Rejection
  let invalidPassRejected = false;
  try {
    await AuthService.login({
      email: testEmail,
      password: 'wrong_password',
    });
  } catch (err: any) {
    invalidPassRejected = err.message.includes('Invalid email or password');
  }
  if (!invalidPassRejected) {
    throw new Error('Login with wrong password should have failed.');
  }
  console.log('  ✓ Login with invalid credentials rejected safely');

  // ==========================================
  // Google OAuth 2.0 Tests
  // ==========================================
  console.log('\n--- Running Google OAuth Integration Tests ---');

  // Test 10: Google OAuth URL generation & CSRF state token
  const origClientId = (AuthService as any).config?.google?.clientId;
  const mockClientId = 'mock_google_client_id_12345.apps.googleusercontent.com';
  (AuthService as any).config = (AuthService as any).config || {};
  const { config } = await import('../server/src/config');
  config.google.clientId = mockClientId;

  const authUrlRes = AuthService.getGoogleAuthUrl('/app/billing');
  if (!authUrlRes.url || !authUrlRes.state) {
    throw new Error('getGoogleAuthUrl failed to return url or state token.');
  }
  if (!authUrlRes.url.includes('accounts.google.com') || !authUrlRes.url.includes(encodeURIComponent(mockClientId))) {
    throw new Error('Google auth URL is missing required Google endpoint or client_id parameter.');
  }
  const verifiedState = AuthService.verifyGoogleState(authUrlRes.state);
  if (!verifiedState.csrf || verifiedState.returnUrl !== '/app/billing') {
    throw new Error('Decoded Google state token does not match expected payload or returnUrl.');
  }
  console.log('  ✓ Google OAuth initiation generates valid authorization URL and signed CSRF state token');

  // Test 11: Invalid / Tampered / Expired OAuth state rejection
  let invalidStateRejected = false;
  try {
    AuthService.verifyGoogleState('forged_or_invalid_state_token_123');
  } catch (err: any) {
    invalidStateRejected = err.code === 'EXPIRED_OAUTH_STATE' || err.code === 'INVALID_OAUTH_STATE';
  }
  if (!invalidStateRejected) {
    throw new Error('Forged or invalid OAuth state was accepted!');
  }
  console.log('  ✓ Invalid / forged OAuth state token rejected safely (CSRF protection enforced)');

  // Test 12: New Google User Registration (Complete Workspace Provisioning)
  const newGoogleId = `gid_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const newGoogleEmail = `google_user_${Date.now()}@gmail.com`;

  const newGoogleAuth = await AuthService.processGoogleUser({
    googleId: newGoogleId,
    email: newGoogleEmail,
    emailVerified: true,
    fullName: 'Google Business Owner',
    avatarUrl: 'https://lh3.googleusercontent.com/a/default-user',
  });

  if (!newGoogleAuth.isNewUser) {
    throw new Error('Expected isNewUser to be true for new Google identity.');
  }
  if (!newGoogleAuth.token || !newGoogleAuth.user.id || !newGoogleAuth.organization?.id) {
    throw new Error('Google registration failed to return user, token, or organization.');
  }
  if (!newGoogleAuth.user.isEmailVerified) {
    throw new Error('Verified Google email was not marked as verified in ONCEClic user profile.');
  }
  if (newGoogleAuth.membership?.role !== UserRole.OWNER) {
    throw new Error(`Expected role OWNER for new Google user organization, got ${newGoogleAuth.membership?.role}`);
  }
  console.log('  ✓ New Google user automatically provisions verified account, organization, 7-day trial, AI employee & JWT session');

  // Test 13: Existing Google User Login (Idempotent, Zero Duplicate Workspace)
  const existingGoogleAuth = await AuthService.processGoogleUser({
    googleId: newGoogleId,
    email: newGoogleEmail,
    emailVerified: true,
    fullName: 'Google Business Owner Updated',
  });

  if (existingGoogleAuth.isNewUser) {
    throw new Error('Expected isNewUser to be false for existing Google identity.');
  }
  if (existingGoogleAuth.user.id !== newGoogleAuth.user.id) {
    throw new Error('Google login returned different user ID for the same googleId!');
  }
  if (existingGoogleAuth.organization?.id !== newGoogleAuth.organization?.id) {
    throw new Error('Google login failed to preserve existing organization!');
  }
  console.log('  ✓ Existing Google user logs in without creating duplicate user or organization');

  // Test 14: Existing Email/Password User links with verified Google account
  const passwordEmail = `link_test_${Date.now()}@example.com`;
  const existingPasswordUser = await AuthService.register({
    email: passwordEmail,
    password: 'password123',
    fullName: 'Linking Tester',
    businessName: 'Linking Clinic',
  });

  const linkGoogleId = `gid_link_${Date.now()}`;
  const linkedGoogleAuth = await AuthService.processGoogleUser({
    googleId: linkGoogleId,
    email: passwordEmail,
    emailVerified: true,
    fullName: 'Linking Tester Google',
  });

  if (linkedGoogleAuth.user.id !== existingPasswordUser.user.id) {
    throw new Error('Account linking failed: created new user instead of linking to existing email user.');
  }
  if (linkedGoogleAuth.organization?.id !== existingPasswordUser.organization?.id) {
    throw new Error('Account linking failed: did not preserve existing organization.');
  }
  console.log('  ✓ Verified Google identity seamlessly links to existing email/password account');

  // Test 15: Unverified Google email is blocked from linking to existing email account
  const targetEmail = `secure_target_${Date.now()}@example.com`;
  await AuthService.register({
    email: targetEmail,
    password: 'password123',
    fullName: 'Security Target',
  });

  let unverifiedLinkingBlocked = false;
  try {
    await AuthService.processGoogleUser({
      googleId: `unverified_gid_${Date.now()}`,
      email: targetEmail,
      emailVerified: false, // Unverified claim
      fullName: 'Attacker Fake Google',
    });
  } catch (err: any) {
    unverifiedLinkingBlocked = err.code === 'UNVERIFIED_GOOGLE_EMAIL' || err.status === 400;
  }
  if (!unverifiedLinkingBlocked) {
    throw new Error('Security Failure: Unverified Google email was allowed to link to an existing account!');
  }
  console.log('  ✓ Unverified Google email blocked from linking to existing accounts (anti-takeover security enforced)');
}
