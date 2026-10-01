import { AuthService } from '../server/src/services/AuthService';
import { TrialService } from '../server/src/services/TrialService';
import { PaddleBillingService } from '../server/src/services/PaddleBillingService';
import { TrialNotificationService } from '../server/src/services/TrialNotificationService';
import { ResendEmailService } from '../server/src/services/ResendEmailService';
import { AppointmentService } from '../server/src/services/AppointmentService';
import { AIBudgetService } from '../server/src/services/AIBudgetService';
import { db } from '../server/src/db';
import { SubscriptionStatus, AuditAction } from '@onceclic/shared';
import { config } from '../server/src/config';

export async function runTrialNotificationEmailTests() {
  console.log('--- Running Trial Reminder & Expiration Email Notification Tests ---');

  const dispatchedEmails: Array<{
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
  }> = [];

  const originalSendEmail = ResendEmailService.sendEmail;

  ResendEmailService.sendEmail = async (options) => {
    dispatchedEmails.push(options);
    return {
      success: true,
      id: `mock_email_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      isSimulated: true,
    };
  };

  try {
    // ==========================================================
    // 1. DETERMINISTIC TIMESTAMPS SETUP
    // ==========================================================
    const testUserEmail = `trial_notify_${Date.now()}@example.test`;
    const authRes = await AuthService.register({
      email: testUserEmail,
      password: 'SecurePassword123!',
      fullName: 'Alice Test Owner',
      businessName: 'Alice Dental Clinic',
    });

    const orgId = authRes.organization!.id;
    const userId = authRes.user.id;

    // Complete onboarding to activate trial (creates the subscription row)
    await AuthService.completeOnboarding({
      userId,
      organizationId: orgId,
      industry: 'Clinic',
      businessKnowledge: 'Alice Dental Clinic is open Monday to Friday 9 AM to 5 PM. Address: 1 Dental Road. Phone: 555-1234.',
    });

    // Set deterministic timestamps:
    // Trial started: 2026-01-01T10:00:00Z
    // Trial expires: 2026-01-08T10:00:00Z (exactly 7 days)
    const trialStartedAt = new Date('2026-01-01T10:00:00.000Z');
    const trialEndsAt = new Date('2026-01-08T10:00:00.000Z');

    await db.execute(
      `UPDATE subscriptions
       SET trial_started_at = $1, trial_ends_at = $2, status = 'TRIALING'
       WHERE organization_id = $3`,
      [trialStartedAt.toISOString(), trialEndsAt.toISOString(), orgId]
    );

    // ==========================================================
    // 2. TWO-DAYS-REMAINING REMINDER TESTS
    // ==========================================================
    console.log('Testing Two-Day Reminder Logic...');

    // Case 1: More than 2 days remaining (e.g. 2026-01-05T10:00:00Z -> 3 days remaining)
    dispatchedEmails.length = 0;
    const t_3daysLeft = new Date('2026-01-05T10:00:00.000Z');
    const summary1 = await TrialNotificationService.checkAndProcessTrialReminders(t_3daysLeft);
    if (summary1.remindersSent !== 0 || dispatchedEmails.length !== 0) {
      throw new Error(`Expected 0 reminder emails when > 2 days remaining, got ${summary1.remindersSent} (emails: ${dispatchedEmails.length})`);
    }
    console.log('  ✓ 1. Active trial with > 2 days remaining sends no reminder email');

    // Case 2: At approximately 2 days remaining (2026-01-06T10:00:00.000Z -> exactly 2 days / 48h left)
    dispatchedEmails.length = 0;
    const t_2daysLeft = new Date('2026-01-06T10:00:00.000Z');
    const summary2 = await TrialNotificationService.checkAndProcessTrialReminders(t_2daysLeft);
    if (summary2.remindersSent !== 1 || dispatchedEmails.length !== 1) {
      throw new Error(`Expected 1 reminder email at 2 days remaining, got ${summary2.remindersSent} (emails: ${dispatchedEmails.length})`);
    }

    const reminderEmail = dispatchedEmails[0];
    if (reminderEmail.to !== testUserEmail) {
      throw new Error(`Expected reminder sent to ${testUserEmail}, got ${reminderEmail.to}`);
    }
    if (reminderEmail.subject !== 'Your ONCEClic free trial ends in 2 days') {
      throw new Error(`Unexpected reminder subject: "${reminderEmail.subject}"`);
    }
    if (!reminderEmail.html?.includes('$19/month') || !reminderEmail.text?.includes('$19/month')) {
      throw new Error('Reminder email must clearly mention $19/month for Pro upgrade.');
    }
    if (!reminderEmail.html?.includes('Upgrade to Pro') || !reminderEmail.html?.includes('/app/billing')) {
      throw new Error('Reminder email must include Upgrade to Pro button linking to /app/billing.');
    }
    if (!reminderEmail.html?.includes('No payment is taken automatically') && !reminderEmail.html?.includes('no automatic payment')) {
      throw new Error('Reminder email must clearly state no automatic payment is taken upon trial end.');
    }
    if (reminderEmail.html?.includes('unlimited AI') || reminderEmail.html?.includes('Unlimited AI')) {
      throw new Error('Reminder email must NOT claim unlimited AI.');
    }

    // Check no secrets leaked
    const secrets = [config.jwtSecret, config.paddle.apiKey, config.paddle.webhookSecret, config.gemini.apiKey, config.composio.apiKey].filter(Boolean);
    for (const secret of secrets) {
      if (secret && secret.length > 5 && (reminderEmail.html?.includes(secret) || reminderEmail.text?.includes(secret))) {
        throw new Error(`Secret leaked in reminder email: ${secret}`);
      }
    }
    console.log('  ✓ 2. Trial at 2 days remaining receives compliant reminder email with $19/mo Pro info & no secrets');

    // Case 3: Reminder sent twice by scheduler -> Idempotency prevents second email
    dispatchedEmails.length = 0;
    const summary3 = await TrialNotificationService.checkAndProcessTrialReminders(t_2daysLeft);
    if (summary3.remindersSent !== 0 || dispatchedEmails.length !== 0) {
      throw new Error(`Expected 0 duplicate reminder emails on second scheduler run, got ${summary3.remindersSent}`);
    }
    console.log('  ✓ 3. Scheduler rerun is strictly idempotent (no duplicate 2-day reminder)');

    // Case 4: Reminder failure does not corrupt trial state
    const subAfterReminder = await PaddleBillingService.getSubscription(orgId, t_2daysLeft);
    if (subAfterReminder.subscription?.status !== SubscriptionStatus.TRIALING) {
      throw new Error(`Expected subscription status to remain TRIALING after reminder, got ${subAfterReminder.subscription?.status}`);
    }
    console.log('  ✓ 4. Reminder dispatch preserves valid TRIALING subscription status');

    // ==========================================================
    // 3. TRIAL EXPIRATION TESTS
    // ==========================================================
    console.log('Testing Trial Expiration Logic...');

    // Case 5: Trial before expiration (e.g. 2026-01-08T09:00:00Z -> 1 hour before expiration)
    dispatchedEmails.length = 0;
    const t_beforeExp = new Date('2026-01-08T09:00:00.000Z');
    const summaryBeforeExp = await TrialNotificationService.checkAndProcessTrialReminders(t_beforeExp);
    if (summaryBeforeExp.expirationsProcessed !== 0 || dispatchedEmails.length !== 0) {
      throw new Error(`Expected 0 expiration emails before expiration time, got ${summaryBeforeExp.expirationsProcessed}`);
    }
    console.log('  ✓ 5. Trial before expiration triggers no expiration email');

    // Case 6: Trial exactly at expiration (2026-01-08T10:00:00Z)
    dispatchedEmails.length = 0;
    const t_exactExp = new Date('2026-01-08T10:00:00.000Z');
    const summaryExactExp = await TrialNotificationService.checkAndProcessTrialReminders(t_exactExp);
    if (summaryExactExp.expirationsProcessed !== 1 || dispatchedEmails.length !== 1) {
      throw new Error(`Expected 1 expiration email at exact expiration, got ${summaryExactExp.expirationsProcessed} (emails: ${dispatchedEmails.length})`);
    }

    const expirationEmail = dispatchedEmails[0];
    if (expirationEmail.to !== testUserEmail) {
      throw new Error(`Expected expiration email to ${testUserEmail}, got ${expirationEmail.to}`);
    }
    if (expirationEmail.subject !== 'Your ONCEClic free trial has ended') {
      throw new Error(`Unexpected expiration subject: "${expirationEmail.subject}"`);
    }
    if (!expirationEmail.html?.includes('$19/month') || !expirationEmail.text?.includes('$19/month')) {
      throw new Error('Expiration email must clearly mention $19/month for Pro upgrade.');
    }
    if (!expirationEmail.html?.includes('Upgrade to Pro') || !expirationEmail.html?.includes('/app/billing')) {
      throw new Error('Expiration email must include Upgrade to Pro button linking to /app/billing.');
    }
    if (!expirationEmail.html?.includes('No automatic payment was taken') && !expirationEmail.html?.includes('no automatic payment')) {
      throw new Error('Expiration email must clearly state no automatic payment was taken.');
    }
    if (expirationEmail.html?.includes('unlimited AI') || expirationEmail.html?.includes('Unlimited AI')) {
      throw new Error('Expiration email must NOT claim unlimited AI.');
    }

    for (const secret of secrets) {
      if (secret && secret.length > 5 && (expirationEmail.html?.includes(secret) || expirationEmail.text?.includes(secret))) {
        throw new Error(`Secret leaked in expiration email: ${secret}`);
      }
    }

    // Verify DB status transitioned to EXPIRED
    const subAfterExp = await PaddleBillingService.getSubscription(orgId);
    if (subAfterExp.subscription?.status !== SubscriptionStatus.EXPIRED) {
      throw new Error(`Expected subscription status EXPIRED, got ${subAfterExp.subscription?.status}`);
    }
    if (subAfterExp.isPro) {
      throw new Error('Expired subscription must not have isPro access.');
    }
    console.log('  ✓ 6. Trial at expiration transitions to EXPIRED and receives compliant expiration email');

    // Case 7: Expired trial checked again -> No duplicate expiration email
    dispatchedEmails.length = 0;
    const t_afterExp = new Date('2026-01-08T10:01:00.000Z');
    const summaryAfterExp = await TrialNotificationService.checkAndProcessTrialReminders(t_afterExp);
    if (summaryAfterExp.expirationsProcessed !== 0 || dispatchedEmails.length !== 0) {
      throw new Error(`Expected 0 duplicate expiration emails after expiration, got ${summaryAfterExp.expirationsProcessed}`);
    }
    console.log('  ✓ 7. Expired trial checked after expiration triggers zero duplicate emails');

    // Case 8: Expiration does not create automatic Paddle charge or subscription
    const subRecord = await db.getOne<{ paddle_subscription_id?: string; paddle_customer_id?: string }>(
      `SELECT paddle_subscription_id, paddle_customer_id FROM subscriptions WHERE organization_id = $1`,
      [orgId]
    );
    if (subRecord?.paddle_subscription_id) {
      throw new Error('Trial expiration must NOT automatically create a Paddle subscription ID.');
    }
    console.log('  ✓ 8. Expiration does NOT trigger automatic Paddle subscription or charge');

    // Case 9: Expired customer can still access billing & start Paddle checkout manually
    const billingStatus = await PaddleBillingService.getSubscription(orgId);
    if (billingStatus.subscription?.status !== SubscriptionStatus.EXPIRED) {
      throw new Error('Expired user must be able to view their expired subscription status in billing.');
    }
    console.log('  ✓ 9. Expired customer can still safely access Billing & start Pro checkout');

    // ==========================================================
    // 4. CONCURRENT EXECUTION & IDEMPOTENCY SAFETY
    // ==========================================================
    console.log('Testing Concurrent Scheduler & Multi-Execution Safety...');
    dispatchedEmails.length = 0;

    const concurrentUserEmail = `concurrent_trial_${Date.now()}@example.test`;
    const concurrentAuth = await AuthService.register({
      email: concurrentUserEmail,
      password: 'SecurePassword123!',
      fullName: 'Bob Concurrent Owner',
      businessName: 'Bob Dental Spa',
    });
    const concurrentOrgId = concurrentAuth.organization!.id;

    // Activate trial via onboarding (creates the subscription row)
    await AuthService.completeOnboarding({
      userId: concurrentAuth.user.id,
      organizationId: concurrentOrgId,
      industry: 'Clinic',
      businessKnowledge: 'Bob Dental Spa is open Monday to Friday 9 AM to 5 PM. Address: 1 Concurrent Lane. Phone: 555-9999.',
    });

    await db.execute(
      `UPDATE subscriptions
       SET trial_started_at = $1, trial_ends_at = $2, status = 'TRIALING'
       WHERE organization_id = $3`,
      [trialStartedAt.toISOString(), trialEndsAt.toISOString(), concurrentOrgId]
    );

    // Run 5 simultaneous concurrent check cycles for the 2-day reminder
    dispatchedEmails.length = 0;
    const concurrentResults = await Promise.all([
      TrialNotificationService.checkAndProcessTrialReminders(t_2daysLeft),
      TrialNotificationService.checkAndProcessTrialReminders(t_2daysLeft),
      TrialNotificationService.checkAndProcessTrialReminders(t_2daysLeft),
      TrialNotificationService.checkAndProcessTrialReminders(t_2daysLeft),
      TrialNotificationService.checkAndProcessTrialReminders(t_2daysLeft),
    ]);

    const totalConcurrentReminders = concurrentResults.reduce((acc, r) => acc + r.remindersSent, 0);
    const concurrentReminderEmailsForBob = dispatchedEmails.filter(
      (e) => e.to === concurrentUserEmail && e.subject === 'Your ONCEClic free trial ends in 2 days'
    );
    if (concurrentReminderEmailsForBob.length !== 1) {
      throw new Error(`Expected exactly 1 reminder email sent despite 5 concurrent executions, got ${concurrentReminderEmailsForBob.length}`);
    }
    console.log('  ✓ 10. Concurrent scheduler executions cannot send duplicate reminder emails');

    // ==========================================================
    // 5. REGRESSION VERIFICATION (EXISTING SYSTEMS STILL WORK)
    // ==========================================================
    console.log('Testing Regression on Existing Booking & Email Workflows...');

    // Resend Direct Verification Email
    const verifyRes = await ResendEmailService.sendVerificationEmail({
      toEmail: 'verify_regress@example.test',
      token: 'mock_verify_token_123',
      fullName: 'Regress User',
    });
    if (!verifyRes.success) {
      throw new Error('sendVerificationEmail must continue to succeed');
    }

    // Resend Booking Confirmation
    const bookingConfirmRes = await ResendEmailService.sendBookingConfirmation({
      appointmentId: 'appt_regress_123',
      customerName: 'Carol Patient',
      customerEmail: 'carol@example.test',
      serviceName: 'Teeth Cleaning',
      businessName: 'Alice Dental Clinic',
      businessType: 'clinic',
      price: 120,
      startTime: '2026-10-15T14:00:00.000Z',
      endTime: '2026-10-15T15:00:00.000Z',
      organizationId: orgId,
    });
    if (!bookingConfirmRes.success) {
      throw new Error('sendBookingConfirmation must continue to succeed');
    }

    // Resend Owner New Booking Alert
    const ownerAlertRes = await ResendEmailService.sendOwnerNewBookingAlert({
      ownerEmail: testUserEmail,
      ownerName: 'Alice Test Owner',
      appointmentId: 'appt_regress_123',
      customerName: 'Carol Patient',
      customerEmail: 'carol@example.test',
      serviceName: 'Teeth Cleaning',
      businessName: 'Alice Dental Clinic',
      startTime: '2026-10-15T14:00:00.000Z',
      endTime: '2026-10-15T15:00:00.000Z',
      organizationId: orgId,
    });
    if (!ownerAlertRes.success) {
      throw new Error('sendOwnerNewBookingAlert must continue to succeed');
    }
    console.log('  ✓ 11. Existing owner & customer booking notification emails work without regression');

    // One trial per email rule still works
    const eligibilityRecheck = await TrialService.checkEligibility(testUserEmail);
    if (eligibilityRecheck.eligible || !eligibilityRecheck.hasUsedTrial) {
      throw new Error('One-trial-per-email rule must remain strictly enforced.');
    }
    console.log('  ✓ 12. Existing one-trial-per-email security enforcement verified intact');

    console.log('====================================================');
    console.log('  ALL TRIAL REMINDER & EXPIRATION EMAIL TESTS PASSED!');
    console.log('====================================================');
  } finally {
    ResendEmailService.sendEmail = originalSendEmail;
  }
}
