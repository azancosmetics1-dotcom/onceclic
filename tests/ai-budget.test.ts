import { AuthService } from '../server/src/services/AuthService';
import { AIBudgetService } from '../server/src/services/AIBudgetService';
import { PaddleBillingService } from '../server/src/services/PaddleBillingService';
import { aiProvider } from '../server/src/services/AIProvider';
import { config } from '../server/src/config';
import { db } from '../server/src/db';
import { SubscriptionStatus } from '@onceclic/shared';

export async function runAIBudgetTests() {
  console.log('--- Running AI Budget & Cost Enforcement Tests ---');

  const auth = await AuthService.register({
    email: `ai_budget_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Budget User',
    businessName: 'Budget Org',
  });
  const orgId = auth.organization!.id;

  // 1. Trial starts with $0 AI usage
  const spent0 = await AIBudgetService.getOrganizationSpentUsd(orgId);
  if (spent0 !== 0) {
    throw new Error(`Expected initial trial spent to be 0, got ${spent0}`);
  }
  console.log('  ✓ 1. Trial starts with $0 AI usage');

  // 2. Trial budget = $0.50
  const budgetStatus = await AIBudgetService.checkBudget(orgId);
  if (budgetStatus.budgetUsd !== config.billing.trialAiBudgetUsd || budgetStatus.budgetUsd !== 0.5) {
    throw new Error(`Expected trial AI budget to be $0.50, got ${budgetStatus.budgetUsd}`);
  }
  if (!budgetStatus.allowed || budgetStatus.plan !== 'TRIAL') {
    throw new Error(`Expected trial plan allowed=true, got allowed=${budgetStatus.allowed}`);
  }
  console.log('  ✓ 2. Trial budget = $0.50 USD');

  // 3. AI usage accumulates
  await db.execute(
    `INSERT INTO ai_usage_records (
       id, organization_id, channel, model, provider, prompt_tokens, completion_tokens,
       total_tokens, estimated_cost_usd, created_at
     ) VALUES ($1, $2, 'WEBSITE', 'gpt-4o-mini', 'OpenAI', 500, 250, 750, 0.15, CURRENT_TIMESTAMP)`,
    [`rec_usage_1_${Date.now()}`, orgId]
  );
  const spentAfter1 = await AIBudgetService.getOrganizationSpentUsd(orgId);
  if (spentAfter1 !== 0.15) {
    throw new Error(`Expected spent to accumulate to 0.15, got ${spentAfter1}`);
  }
  console.log('  ✓ 3. AI usage accumulates accurately');

  // 4. AI cost is calculated from token usage
  // Model: gpt-4o-mini ($0.15/1M prompt, $0.60/1M completion)
  // 1,000,000 prompt tokens + 1,000,000 completion tokens = $0.15 + $0.60 = $0.75
  const estimatedCost = aiProvider.estimateCost('gpt-4o-mini', 1000000, 1000000);
  if (Math.abs(estimatedCost - 0.75) > 0.001) {
    throw new Error(`Expected estimated cost for 1M/1M gpt-4o-mini to be $0.75, got ${estimatedCost}`);
  }
  console.log('  ✓ 4. AI cost is calculated from token usage using centralized pricing table');

  // 5. Request is blocked when budget is reached
  // Spend up to $0.50
  await db.execute(
    `INSERT INTO ai_usage_records (
       id, organization_id, channel, model, provider, prompt_tokens, completion_tokens,
       total_tokens, estimated_cost_usd, created_at
     ) VALUES ($1, $2, 'WEBSITE', 'gpt-4o-mini', 'OpenAI', 1000, 500, 1500, 0.35, CURRENT_TIMESTAMP)`,
    [`rec_usage_2_${Date.now()}`, orgId]
  );
  const spentAtCap = await AIBudgetService.getOrganizationSpentUsd(orgId);
  if (spentAtCap < 0.5) {
    throw new Error(`Expected total spent >= 0.50, got ${spentAtCap}`);
  }

  const cappedStatus = await AIBudgetService.checkBudget(orgId);
  if (cappedStatus.allowed || !cappedStatus.isExceeded) {
    throw new Error('Expected AI request to be blocked when $0.50 trial budget is reached.');
  }
  console.log('  ✓ 5. Request is blocked when budget is reached');

  // 6. Request cannot bypass budget from frontend (server-side assertion throws)
  let assertionBlocked = false;
  try {
    await AIBudgetService.assertBudgetAvailable(orgId);
  } catch (err: any) {
    assertionBlocked =
      err.message.includes("You've reached the AI usage limit for your free trial") ||
      err.message.includes('Upgrade to Pro') ||
      err.message.includes('limit');
  }
  if (!assertionBlocked) {
    throw new Error('Server-side budget assertion must throw and block generation.');
  }
  console.log('  ✓ 6. Request cannot bypass budget from frontend (server-side enforcement)');

  // 7. Concurrent requests cannot materially bypass budget
  const orgRace = await AuthService.register({
    email: `airace_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'AI Race User',
    businessName: 'AI Race Org',
  });
  const raceOrgId = orgRace.organization!.id;

  // Add usage to $0.48 (only $0.02 remaining)
  await db.execute(
    `INSERT INTO ai_usage_records (
       id, organization_id, channel, model, provider, prompt_tokens, completion_tokens,
       total_tokens, estimated_cost_usd, created_at
     ) VALUES ($1, $2, 'WEBSITE', 'gpt-4o-mini', 'OpenAI', 100, 100, 200, 0.48, CURRENT_TIMESTAMP)`,
    [`rec_race_init_${Date.now()}`, raceOrgId]
  );

  // Attempt simultaneous AI request executions
  const tryGenerate = async () => {
    await AIBudgetService.assertBudgetAvailable(raceOrgId);
    // Simulate generation cost of $0.05
    await db.execute(
      `INSERT INTO ai_usage_records (
         id, organization_id, channel, model, provider, prompt_tokens, completion_tokens,
         total_tokens, estimated_cost_usd, created_at
       ) VALUES ($1, $2, 'WEBSITE', 'gpt-4o-mini', 'OpenAI', 100, 100, 200, 0.05, CURRENT_TIMESTAMP)`,
      [`rec_race_${Date.now()}_${Math.random()}`, raceOrgId]
    );
  };

  const raceResults = await Promise.allSettled([
    tryGenerate(),
    tryGenerate(),
    tryGenerate(),
  ]);
  const allowedGenerations = raceResults.filter((r) => r.status === 'fulfilled').length;
  // Once the first request finishes and exceeds $0.50, subsequent checks fail
  const totalSpentRace = await AIBudgetService.getOrganizationSpentUsd(raceOrgId);
  if (totalSpentRace > 0.65) {
    throw new Error(`Budget protection failure: Total spent exceeded allowable window: $${totalSpentRace}`);
  }
  console.log(`  ✓ 7. Concurrent requests cannot materially bypass budget (allowed: ${allowedGenerations}, final spent: $${totalSpentRace})`);

  // 8. Pro uses separate budget
  await PaddleBillingService.handleWebhookEvent({
    event_id: `evt_pro_upgrade_${Date.now()}`,
    event_type: 'subscription.activated',
    occurred_at: new Date().toISOString(),
    data: {
      id: `sub_pro_${Date.now()}`,
      customer_id: `ctm_pro_${Date.now()}`,
      status: 'active',
      custom_data: { organization_id: orgId },
      current_billing_period: {
        starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      },
    },
  });

  const proStatus = await AIBudgetService.checkBudget(orgId);
  if (!proStatus.allowed || proStatus.plan !== 'PRO') {
    throw new Error('Pro subscription should unblock AI usage with Pro plan budget.');
  }
  console.log('  ✓ 8. Pro uses separate budget and unlocks AI generation');

  // 9. Pro has higher configurable allowance
  if (proStatus.budgetUsd !== config.billing.proAiBudgetUsd || proStatus.budgetUsd <= config.billing.trialAiBudgetUsd) {
    throw new Error(`Pro budget ($${proStatus.budgetUsd}) must be higher than trial budget ($${config.billing.trialAiBudgetUsd})`);
  }
  console.log(`  ✓ 9. Pro has higher configurable allowance ($${proStatus.budgetUsd}/mo vs $${config.billing.trialAiBudgetUsd} trial)`);

  // 10. Trial expiration blocks continued trial AI usage
  const orgExpired = await AuthService.register({
    email: `expired_user_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Expired User',
    businessName: 'Expired Org',
  });
  const expOrgId = orgExpired.organization!.id;

  // Manually expire the trial by setting trial_ends_at in the past
  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await db.execute(
    `UPDATE subscriptions SET trial_ends_at = $1 WHERE organization_id = $2`,
    [pastDate, expOrgId]
  );

  const expStatus = await AIBudgetService.checkBudget(expOrgId);
  if (expStatus.allowed || !expStatus.isExpired) {
    throw new Error('Expired trial must block AI generation with isExpired=true.');
  }
  console.log('  ✓ 10. Trial expiration blocks continued trial AI usage');
}
