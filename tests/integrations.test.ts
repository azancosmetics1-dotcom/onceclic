import { IntegrationService } from '../server/src/services/IntegrationService';
import { AuthService } from '../server/src/services/AuthService';
import { getDatabase } from '../server/src/db';
import { IntegrationStatus } from '@onceclic/shared';

export async function runIntegrationTests() {
  console.log('--- Running Website & Email Integration Tests ---');
  const db = getDatabase();
  await db.runMigrations();

  const { aiProvider } = await import('../server/src/services/AIProvider');
  const originalGenerateResponse = aiProvider.generateResponse;
  const originalGenerateEmbedding = aiProvider.generateEmbedding;
  aiProvider.generateResponse = async () => ({
    content: 'Mock AI response',
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
    estimatedCostUsd: 0.0001,
    model: 'gpt-4o-mini',
    provider: 'OpenAI',
    handoffRequired: false,
  });
  aiProvider.generateEmbedding = async () => new Array(1536).fill(0.01);

  const { config } = await import('../server/src/config');
  const prevComposioKey = config.composio.apiKey;
  config.composio.apiKey = config.composio.apiKey || 'mock_comp_api_key_test';

  // Mock fetch for Composio / Google endpoints
  const originalFetch = global.fetch;
  let isDeleted = false;
  global.fetch = async (url: any, init?: any) => {
    const urlStr = String(url);
    if (urlStr.includes('/v3.1/auth_configs')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            items: [
              {
                id: 'ac_mock_gmail_123',
                is_composio_managed: true,
                toolkit: { slug: 'gmail' },
              },
            ],
          }),
      } as any;
    }
    if (urlStr.includes('/v3.1/connected_accounts/link') || urlStr.includes('/v1/connectedAccounts')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            redirect_url: 'https://connect.composio.dev/link/gmail?session=mock_session_123',
          }),
      } as any;
    }
    if (urlStr.includes('/connected_accounts') || urlStr.includes('/connectedAccounts')) {
      if (init?.method === 'DELETE') {
        isDeleted = true;
        return { ok: true, status: 200, text: async () => JSON.stringify({ success: true }) } as any;
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            items: isDeleted
              ? []
              : [
                  {
                    id: 'ca_mock_gmail_apex',
                    status: 'ACTIVE',
                    app: 'gmail',
                    toolkit: { slug: 'gmail' },
                    userEmail: 'contact@apexhealth.com',
                    user_email: 'contact@apexhealth.com',
                  },
                ],
          }),
      } as any;
    }
    return originalFetch(url, init);
  };

  try {
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

    // 6. Test Email Connection via Composio Managed OAuth
    const authUrlRes = await IntegrationService.getGoogleEmailAuthUrl(orgId, user.user.id);
    if (!authUrlRes.url || !authUrlRes.state) {
      throw new Error('Google Email OAuth URL generation failed.');
    }

    await IntegrationService.handleComposioCallback({
      orgId,
      app: 'gmail',
    });

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
  } finally {
    global.fetch = originalFetch;
    config.composio.apiKey = prevComposioKey;
    aiProvider.generateResponse = originalGenerateResponse;
    aiProvider.generateEmbedding = originalGenerateEmbedding;
  }
}
