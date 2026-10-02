process.env.USE_EMBEDDED_DB = 'true';
process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'mock';

async function runAllTests() {
  // 1. Mandatory Executable Preflight Safety Check (Fails closed)
  const { printPreflightSummary, assertSafeTestEnvironment } = await import('./utils/environmentGuard');
  assertSafeTestEnvironment();
  printPreflightSummary();

  console.log('====================================================');
  console.log('ENVIRONMENT: LOCAL/TEST');
  console.log('AI PROVIDER FOR TESTS: MOCK');
  console.log('REAL GEMINI API CALLS EXPECTED: 0');
  console.log('PRODUCTION DATABASE: NO');
  console.log('PRODUCTION COMPOSIO: NO');
  console.log('PRODUCTION PADDLE: NO');
  console.log('PRODUCTION DEPLOYMENT: NO');
  console.log('====================================================\n');

  const { runEnvironmentGuardTests } = await import('./environment-guard.test');
  const { getDatabase } = await import('../server/src/db');
  const { runAuthTests } = await import('./auth.test');
  const { runSignupIndustryKnowledgeTests } = await import('./signup-industry-knowledge.test');
  const { runRealChannelAIReplyTests } = await import('./real-channel-ai-reply.test');
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

  const start = Date.now();
  const db = getDatabase();
  await db.runMigrations();

  try {
    await runEnvironmentGuardTests();
    console.log('');
    await runAuthTests();
    console.log('');
    await runSignupIndustryKnowledgeTests();
    console.log('');
    await runRealChannelAIReplyTests();
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

    const { runChannelRealWorldVerificationTests } = await import('./channel-ai-real-world-verification.test');
    await runChannelRealWorldVerificationTests();
    console.log('');

    const { runFinalProductFlowTests } = await import('./final-product-flow.test');
    await runFinalProductFlowTests();
    console.log('');

    const { runGmailAIReplyTests } = await import('./gmail-ai-reply.test');
    await runGmailAIReplyTests();
    console.log('');

    const { runInstagramAIReplyTests } = await import('./instagram-ai-reply.test');
    await runInstagramAIReplyTests();
    console.log('');

    const { runFacebookAIReplyTests } = await import('./facebook-ai-reply.test');
    await runFacebookAIReplyTests();
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

