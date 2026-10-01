process.env.USE_EMBEDDED_DB = 'true';
process.env.NODE_ENV = 'test';

async function runAllTests() {
  // 1. Mandatory Executable Preflight Safety Check (Fails closed)
  const { printPreflightSummary, assertSafeTestEnvironment } = await import('./utils/environmentGuard');
  assertSafeTestEnvironment();
  printPreflightSummary();

  const { runEnvironmentGuardTests } = await import('./environment-guard.test');
  const { getDatabase } = await import('../server/src/db');
  const { runAuthTests } = await import('./auth.test');
  const { runTenantIsolationTests } = await import('./tenant-isolation.test');
  const { runAppointmentTests } = await import('./appointments.test');
  const { runPaddleWebhookTests } = await import('./paddle-webhooks.test');
  const { runRBACTests } = await import('./rbac.test');
  const { runIdempotencyTests } = await import('./idempotency.test');
  const { runAIGroundingTests } = await import('./ai-grounding.test');
  const { runAnalyticsTests } = await import('./analytics.test');
  const { runIntegrationTests } = await import('./integrations.test');
  const { runGoogleCalendarTests } = await import('./google-calendar.test');
  const { runResendEmailTests } = await import('./resend-email.test');
  const { runGmailOAuthSecurityTests } = await import('./gmail-oauth-security.test');
  const { runComposioIntegrationTests } = await import('./composio-integrations.test');
  const { runInstagramIntegrationTests } = await import('./instagram-integration.test');
  const { runTrialSecurityTests } = await import('./trial-security.test');
  const { runAIBudgetTests } = await import('./ai-budget.test');
  const { runCustomerApiFieldAllowlistTests } = await import('./customer-api-field-allowlist.test');
  const { runPaddlePricingTests } = await import('./paddle-pricing.test');
  const { runIndustryBookingAndSocialTests } = await import('./industry-booking-and-social.test');
  const { runGeminiProviderTests } = await import('./gemini-provider.test');

  const { aiProvider } = await import('../server/src/services/AIProvider');
  aiProvider.generateEmbedding = async () => new Array(1536).fill(0.01);
  aiProvider.generateResponse = async () => ({
    content: 'Thank you for reaching out to us. We are here to assist you.',
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
    estimatedCostUsd: 0.0001,
    model: 'gpt-4o-mini',
    provider: 'OpenAI',
    handoffRequired: false,
  });

  const start = Date.now();
  const db = getDatabase();
  await db.runMigrations();

  try {
    await runEnvironmentGuardTests();
    console.log('');
    await runAuthTests();
    console.log('');

    await runTenantIsolationTests();
    console.log('');

    await runAppointmentTests();
    console.log('');

    await runPaddleWebhookTests();
    console.log('');

    await runPaddlePricingTests();
    console.log('');

    await runTrialSecurityTests();
    console.log('');

    await runAIBudgetTests();
    console.log('');

    await runCustomerApiFieldAllowlistTests();
    console.log('');

    await runRBACTests();
    console.log('');

    await runIdempotencyTests();
    console.log('');

    await runAIGroundingTests();
    console.log('');

    await runAnalyticsTests();
    console.log('');

    await runIntegrationTests();
    console.log('');

    await runGoogleCalendarTests();
    console.log('');

    await runResendEmailTests();
    console.log('');

    await runGmailOAuthSecurityTests();
    console.log('');

    await runComposioIntegrationTests();
    console.log('');

    await runInstagramIntegrationTests();
    console.log('');

    await runIndustryBookingAndSocialTests();
    console.log('');

    await runGeminiProviderTests();
    console.log('');

    const { runOwnerNotificationTests } = await import('./owner-notification.test');
    await runOwnerNotificationTests();
    console.log('');

    const { runAIBusinessDataVerificationTests } = await import('./ai-business-data-verification.test');
    await runAIBusinessDataVerificationTests();
    console.log('');

    const { runTrialNotificationEmailTests } = await import('./trial-notification-emails.test');
    await runTrialNotificationEmailTests();
    console.log('');

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log('====================================================');
    console.log(`  ALL TESTS PASSED SUCCESSFULLY in ${duration}s!`);
    console.log('====================================================');
    process.exit(0);
  } catch (err: any) {
    console.error('\n❌ TEST SUITE FAILED:');
    console.error(err.message || err);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}

runAllTests();
