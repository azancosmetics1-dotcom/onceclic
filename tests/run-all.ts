import { runAuthTests } from './auth.test';
import { runTenantIsolationTests } from './tenant-isolation.test';
import { runAppointmentTests } from './appointments.test';
import { runPaddleWebhookTests } from './paddle-webhooks.test';
import { runRBACTests } from './rbac.test';
import { runIdempotencyTests } from './idempotency.test';
import { runAIGroundingTests } from './ai-grounding.test';
import { runAnalyticsTests } from './analytics.test';
import { runIntegrationTests } from './integrations.test';
import { runGoogleCalendarTests } from './google-calendar.test';
import { runResendEmailTests } from './resend-email.test';
import { getDatabase } from '../server/src/db';

async function runAllTests() {
  console.log('====================================================');
  console.log('  ONCEClic MVP Automated Integration Test Suite');
  console.log('====================================================\n');

  const start = Date.now();
  const db = getDatabase();
  await db.runMigrations();

  try {
    await runAuthTests();
    console.log('');

    await runTenantIsolationTests();
    console.log('');

    await runAppointmentTests();
    console.log('');

    await runPaddleWebhookTests();
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
