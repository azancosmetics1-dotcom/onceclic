import { IntegrationService } from '../server/src/services/IntegrationService';
import { AuthService } from '../server/src/services/AuthService';
import { getDatabase } from '../server/src/db';
import { IntegrationStatus } from '@onceclic/shared';

export async function runIntegrationTests() {
  console.log('--- Running Website & Email Integration Tests ---');
  const db = getDatabase();
  await db.runMigrations();

  // 1. Register test organization
  const user = await AuthService.register({
    email: `integ_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Integration Owner',
    businessName: 'Apex Health',
  });
  await AuthService.verifyEmail(user.verificationToken!);
  const orgId = user.organization!.id;

  // 2. Test Website Configuration
  const initialWeb = await IntegrationService.getWebsiteConfig(orgId);
  if (!initialWeb.embedScriptSnippet.includes(user.organization!.slug) || !initialWeb.embedScriptSnippet.includes('widget.js')) {
    throw new Error('Website embed script snippet is missing or incorrectly formatted.');
  }
  if (!initialWeb.publicChatUrl.includes(user.organization!.slug)) {
    throw new Error('Public chat URL is missing or incorrectly formatted.');
  }
  console.log('  ✓ Website connection configuration generated with safe public embed snippet and chat URL');

  // 3. Test Website Verification
  const verifiedWeb = await IntegrationService.verifyWebsite(orgId, user.user.id);
  if (verifiedWeb.status !== IntegrationStatus.CONNECTED || !verifiedWeb.isVerified) {
    throw new Error('Website verification failed to transition status to CONNECTED.');
  }
  console.log('  ✓ Website verification successfully updates integration status to CONNECTED');

  // 4. Test Website Disconnect
  const disconnectedWeb = await IntegrationService.disconnectWebsite(orgId, user.user.id);
  if (disconnectedWeb.status !== IntegrationStatus.DISCONNECTED) {
    throw new Error('Website disconnect failed to transition status to DISCONNECTED.');
  }
  console.log('  ✓ Website disconnect transitions status to DISCONNECTED');

  // 5. Test Email Configuration
  const initialEmail = await IntegrationService.getEmailConfig(orgId);
  if (!initialEmail.inboundWebhookAddress.includes(user.organization!.slug)) {
    throw new Error('Email inbound webhook address is missing or incorrectly formatted.');
  }
  console.log('  ✓ Email configuration provides secure inbound webhook routing address');

  // 6. Test Email Connection via Google OAuth Flow
  const { config } = await import('../server/src/config');
  const prevClientId = config.google.clientId;
  const prevClientSecret = config.google.clientSecret;
  config.google.clientId = config.google.clientId || 'mock_google_client_id.apps.googleusercontent.com';
  config.google.clientSecret = config.google.clientSecret || 'mock_google_client_secret_xyz';

  const authUrlRes = await IntegrationService.getGoogleEmailAuthUrl(orgId, user.user.id);
  if (!authUrlRes.url || !authUrlRes.state) {
    throw new Error('Google Email OAuth URL generation failed.');
  }

  // Mock token exchange & capability verification
  const originalFetch = global.fetch;
  global.fetch = async (url: any, init?: any) => {
    const urlStr = String(url);
    if (urlStr.includes('oauth2.googleapis.com/token')) {
      return {
        ok: true,
        json: async () => ({
          access_token: 'mock_token_apex',
          refresh_token: 'mock_refresh_apex',
          expires_in: 3600,
        }),
      } as any;
    }
    if (urlStr.includes('gmail.googleapis.com/gmail/v1/users/me/profile')) {
      return {
        ok: true,
        json: async () => ({
          emailAddress: 'contact@apexhealth.com',
        }),
      } as any;
    }
    return originalFetch(url, init);
  };

  await IntegrationService.handleGoogleEmailCallback('mock_code_apex', authUrlRes.state, user.user.id);
  global.fetch = originalFetch;
  config.google.clientId = prevClientId;
  config.google.clientSecret = prevClientSecret;

  const connectedEmail = await IntegrationService.getEmailConfig(orgId);
  if (connectedEmail.status !== IntegrationStatus.CONNECTED || connectedEmail.connectedEmail !== 'contact@apexhealth.com') {
    throw new Error('Email connection failed to update connected address or status.');
  }
  console.log('  ✓ Business Gmail connected and verified with secure OAuth flow');

  // 7. Test Email Disconnect
  const disconnectedEmail = await IntegrationService.disconnectEmail(orgId, user.user.id);
  if (disconnectedEmail.status !== IntegrationStatus.DISCONNECTED) {
    throw new Error('Email disconnect failed to transition status to DISCONNECTED.');
  }
  console.log('  ✓ Business email disconnect transitions status to DISCONNECTED');
}
