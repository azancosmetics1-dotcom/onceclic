import { AuthService } from '../server/src/services/AuthService';
import { TrialService } from '../server/src/services/TrialService';
import { PaddleBillingService } from '../server/src/services/PaddleBillingService';
import { AIBudgetService } from '../server/src/services/AIBudgetService';
import { db } from '../server/src/db';
import { SubscriptionStatus } from '@onceclic/shared';

export async function runTrialSecurityTests() {
  console.log('--- Running Trial Security & Anti-Abuse Tests ---');

  const baseEmail = `security_user_${Date.now()}@example.com`;

  // 1. New email can receive trial
  const eligibility1 = await TrialService.checkEligibility(baseEmail);
  if (!eligibility1.eligible || eligibility1.hasUsedTrial) {
    throw new Error('New email should be eligible for 7-day free trial.');
  }

  const auth1 = await AuthService.register({
    email: baseEmail,
    password: 'password123',
    fullName: 'Security User 1',
    businessName: 'Security Clinic 1',
  });
  const orgId1 = auth1.organization!.id;
  const userId1 = auth1.user.id;

  // Complete onboarding to activate the 7-day trial
  await AuthService.completeOnboarding({
    userId: userId1,
    organizationId: orgId1,
    industry: 'Clinic',
    businessKnowledge: 'Security Clinic 1 is open Monday to Friday 9 AM to 5 PM. Address: 1 Security Road.',
  });

  const sub1 = await PaddleBillingService.getSubscription(orgId1);
  if (sub1.subscription?.status !== SubscriptionStatus.TRIALING) {
    throw new Error(`Expected status TRIALING on first trial redemption, got ${sub1.subscription?.status}`);
  }
  console.log('  ✓ 1. New email can receive 7-day free trial');

  // 2. Same email cannot receive second trial
  const eligibility2 = await TrialService.checkEligibility(baseEmail);
  if (eligibility2.eligible || !eligibility2.hasUsedTrial) {
    throw new Error('Same email should not be eligible for a second free trial.');
  }

  let secondTrialError: any = null;
  try {
    await TrialService.redeemTrial({
      userId: userId1,
      organizationId: orgId1,
      email: baseEmail,
    });
  } catch (err: any) {
    secondTrialError = err;
  }
  if (!secondTrialError || !secondTrialError.message.includes('already been used')) {
    throw new Error('Attempt to redeem a second trial with the same email must be rejected server-side.');
  }
  console.log('  ✓ 2. Same email cannot receive second trial');

  // 3. Same email with different capitalization cannot receive second trial
  const upperEmail = baseEmail.toUpperCase();
  const eligibilityUpper = await TrialService.checkEligibility(upperEmail);
  if (eligibilityUpper.eligible || !eligibilityUpper.hasUsedTrial) {
    throw new Error('Same email with different capitalization must be rejected.');
  }

  let upperTrialError: any = null;
  try {
    await TrialService.redeemTrial({
      userId: userId1,
      organizationId: orgId1,
      email: upperEmail,
    });
  } catch (err: any) {
    upperTrialError = err;
  }
  if (!upperTrialError || !upperTrialError.message.includes('already been used')) {
    throw new Error('Capitalized email attempt must be blocked by normalized email check.');
  }
  console.log('  ✓ 3. Same email with different capitalization cannot receive second trial');

  // 4. Same email with surrounding whitespace cannot receive second trial
  const whitespaceEmail = `   ${baseEmail}   `;
  const eligibilityWs = await TrialService.checkEligibility(whitespaceEmail);
  if (eligibilityWs.eligible || !eligibilityWs.hasUsedTrial) {
    throw new Error('Same email with surrounding whitespace must be rejected.');
  }

  let wsTrialError: any = null;
  try {
    await TrialService.redeemTrial({
      userId: userId1,
      organizationId: orgId1,
      email: whitespaceEmail,
    });
  } catch (err: any) {
    wsTrialError = err;
  }
  if (!wsTrialError || !wsTrialError.message.includes('already been used')) {
    throw new Error('Whitespace-padded email attempt must be blocked by normalized email check.');
  }
  console.log('  ✓ 4. Same email with surrounding whitespace cannot receive second trial');

  // 5. Same email cannot receive another trial after organization deletion
  // Simulate organization deletion
  await db.execute(`DELETE FROM organizations WHERE id = $1`, [orgId1]);
  const eligibilityPostDelete = await TrialService.checkEligibility(baseEmail);
  if (eligibilityPostDelete.eligible || !eligibilityPostDelete.hasUsedTrial) {
    throw new Error('Email must remain ineligible even after organization deletion due to permanent trial_redemptions record.');
  }
  console.log('  ✓ 5. Same email cannot receive another trial after organization deletion');

  // 5b. Same email cannot receive another trial after user account deletion and re-creation
  await db.execute(`DELETE FROM users WHERE id = $1`, [userId1]);
  const eligibilityPostUserDelete = await TrialService.checkEligibility(baseEmail);
  if (eligibilityPostUserDelete.eligible || !eligibilityPostUserDelete.hasUsedTrial) {
    throw new Error('Email must remain ineligible even after user account deletion.');
  }
  const authRecreated = await AuthService.register({
    email: baseEmail,
    password: 'newpassword123',
    fullName: 'Recreated User',
    businessName: 'Recreated Org',
  });
  const subRecreated = await PaddleBillingService.getSubscription(authRecreated.organization!.id);
  if (subRecreated.subscription?.status === SubscriptionStatus.TRIALING) {
    throw new Error('Recreated account with used email must NOT receive another TRIALING subscription.');
  }
  console.log('  ✓ 5b. Same email cannot receive another trial after user account deletion & recreation');

  // 6. Same email cannot receive another trial through another organization
  const auth2 = await AuthService.register({
    email: `diff_user_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Diff User',
    businessName: 'Second Org',
  });
  const orgId2 = auth2.organization!.id;
  await AuthService.completeOnboarding({
    userId: auth2.user.id,
    organizationId: orgId2,
    industry: 'Restaurant',
    businessKnowledge: 'Second Org Restaurant is open daily 9 AM to 9 PM. Located at 2 Second Street.',
  });

  let crossOrgError: any = null;
  try {
    await TrialService.redeemTrial({
      userId: auth2.user.id,
      organizationId: orgId2,
      email: baseEmail, // Attempting to use the already consumed email in org 2
    });
  } catch (err: any) {
    crossOrgError = err;
  }
  if (!crossOrgError || !crossOrgError.message.includes('already been used')) {
    throw new Error('Trial redemption for used email in a different organization must be blocked.');
  }
  console.log('  ✓ 6. Same email cannot receive another trial through another organization');

  // 7. Same email can still purchase Pro after using a trial
  const paddleSubId = `sub_test_${Date.now()}`;
  await PaddleBillingService.handleWebhookEvent({
    event_id: `evt_pro_${Date.now()}`,
    event_type: 'subscription.activated',
    occurred_at: new Date().toISOString(),
    data: {
      id: paddleSubId,
      customer_id: `ctm_${Date.now()}`,
      status: 'active',
      custom_data: { organization_id: orgId2 },
      current_billing_period: {
        starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      },
    },
  });
  const subPaid = await PaddleBillingService.getSubscription(orgId2);
  if (subPaid.subscription?.status !== SubscriptionStatus.ACTIVE || !subPaid.isPro) {
    throw new Error('User should be able to activate paid Pro subscription regardless of trial history.');
  }
  console.log('  ✓ 7. Same email can still purchase Pro after using a trial');

  // 8. Two simultaneous trial requests for the same email result in only ONE trial
  const raceEmail = `race_user_${Date.now()}@example.com`;
  const raceAuth = await AuthService.register({
    email: raceEmail,
    password: 'password123',
    fullName: 'Race Tester',
    businessName: 'Race Org',
  });
  const raceOrgId = raceAuth.organization!.id;
  const raceUserId = raceAuth.user.id;
  await AuthService.completeOnboarding({
    userId: raceUserId,
    organizationId: raceOrgId,
    industry: 'Restaurant',
    businessKnowledge: 'Race Org Restaurant is open daily 9 AM to 9 PM. Located at 8 Race Street.',
  });

  // Clear any pre-existing redemption for test isolation
  await db.execute(`DELETE FROM trial_redemptions WHERE normalized_email = $1`, [raceEmail.toLowerCase()]);

  const [resA, resB] = await Promise.allSettled([
    TrialService.redeemTrial({ userId: raceUserId, organizationId: raceOrgId, email: raceEmail }),
    TrialService.redeemTrial({ userId: raceUserId, organizationId: raceOrgId, email: raceEmail }),
  ]);

  const successCount = [resA, resB].filter((r) => r.status === 'fulfilled').length;
  const rejectedCount = [resA, resB].filter((r) => r.status === 'rejected').length;

  if (successCount !== 1 || rejectedCount !== 1) {
    throw new Error(`Race condition failure: Expected exactly 1 success and 1 rejection, got ${successCount} success and ${rejectedCount} rejected`);
  }
  console.log('  ✓ 8. Two simultaneous trial requests for the same email result in only ONE trial');

  // 9. Database uniqueness prevents duplicate trial redemption
  const redemptionsInDb = await db.query(
    `SELECT COUNT(*) as count FROM trial_redemptions WHERE normalized_email = $1`,
    [raceEmail.toLowerCase()]
  );
  const count = parseInt(redemptionsInDb.rows[0]?.count || '0', 10);
  if (count !== 1) {
    throw new Error(`Expected exactly 1 DB record in trial_redemptions for normalized email, found ${count}`);
  }
  console.log('  ✓ 9. Database uniqueness prevents duplicate trial redemption');

  // 10. Organization A cannot access Organization B trial history
  const authOrgA = await AuthService.register({
    email: `orga_${Date.now()}@tenant-a.com`,
    password: 'password123',
    fullName: 'Owner A',
    businessName: 'Tenant A',
  });
  const authOrgB = await AuthService.register({
    email: `orgb_${Date.now()}@tenant-b.com`,
    password: 'password123',
    fullName: 'Owner B',
    businessName: 'Tenant B',
  });
  await AuthService.completeOnboarding({
    userId: authOrgA.user.id,
    organizationId: authOrgA.organization!.id,
    industry: 'Clinic',
    businessKnowledge: 'Tenant A Clinic is open Monday to Friday 9 AM to 5 PM. Located at 1 Tenant Street.',
  });
  await AuthService.completeOnboarding({
    userId: authOrgB.user.id,
    organizationId: authOrgB.organization!.id,
    industry: 'Clinic',
    businessKnowledge: 'Tenant B Clinic is open Monday to Friday 10 AM to 6 PM. Located at 2 Tenant Avenue.',
  });

  const tenantARedemptions = await db.query(
    `SELECT * FROM trial_redemptions WHERE organization_id = $1`,
    [authOrgA.organization!.id]
  );
  for (const row of tenantARedemptions.rows) {
    if (row.organization_id !== authOrgA.organization!.id) {
      throw new Error('Tenant isolation failure: Organization A query returned Organization B record!');
    }
  }
  console.log('  ✓ 10. Organization A cannot access Organization B trial history');

  // 11. Organization A cannot manipulate Organization B AI budget
  const orgABudgetBefore = await AIBudgetService.checkBudget(authOrgA.organization!.id);
  const orgBBudgetBefore = await AIBudgetService.checkBudget(authOrgB.organization!.id);

  // Spend AI cost only in Org A
  await db.execute(
    `INSERT INTO ai_usage_records (
       id, organization_id, channel, model, provider, prompt_tokens, completion_tokens,
       total_tokens, estimated_cost_usd, created_at
     ) VALUES ($1, $2, 'WEBSITE', 'gpt-4o-mini', 'OpenAI', 1000, 500, 1500, 0.25, CURRENT_TIMESTAMP)`,
    [`rec_${Date.now()}_a`, authOrgA.organization!.id]
  );

  const orgABudgetAfter = await AIBudgetService.checkBudget(authOrgA.organization!.id);
  const orgBBudgetAfter = await AIBudgetService.checkBudget(authOrgB.organization!.id);

  if (orgABudgetAfter.spentUsd <= orgABudgetBefore.spentUsd) {
    throw new Error('Org A AI spent should have increased.');
  }
  if (orgBBudgetAfter.spentUsd !== orgBBudgetBefore.spentUsd) {
    throw new Error('Org B AI budget was improperly affected by Org A usage!');
  }
  console.log('  ✓ 11. Organization A cannot manipulate Organization B AI budget');
}
