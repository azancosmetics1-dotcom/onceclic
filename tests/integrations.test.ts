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

  // 6. Test Email Connection
  const testBusinessEmail = 'contact@apexhealth.com';
  const connectedEmail = await IntegrationService.connectEmail(orgId, testBusinessEmail, user.user.id);
  if (connectedEmail.status !== IntegrationStatus.CONNECTED || connectedEmail.connectedEmail !== testBusinessEmail) {
    throw new Error('Email connection failed to update connected address or status.');
  }
  console.log('  ✓ Business email connected with non-technical customer flow');

  // 7. Test Email Disconnect
  const disconnectedEmail = await IntegrationService.disconnectEmail(orgId, user.user.id);
  if (disconnectedEmail.status !== IntegrationStatus.DISCONNECTED) {
    throw new Error('Email disconnect failed to transition status to DISCONNECTED.');
  }
  console.log('  ✓ Business email disconnect transitions status to DISCONNECTED');
}
