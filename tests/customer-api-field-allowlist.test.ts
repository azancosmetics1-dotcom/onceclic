import {
  toCustomerBillingStatus,
  toCustomerBillingConfig,
  toCustomerTrialEligibility,
  toCustomerAIStatus,
  toCustomerWebsiteConfig,
  toCustomerEmailConfig,
  toCustomerCalendarConfig,
  toCustomerInstagramConfig,
} from '../server/src/serializers/customerSerializers';
import { AIBudgetService } from '../server/src/services/AIBudgetService';
import { AuthService } from '../server/src/services/AuthService';
import { PaddleBillingService } from '../server/src/services/PaddleBillingService';
import { config } from '../server/src/config';
import { db } from '../server/src/db';
import { SubscriptionStatus } from '@onceclic/shared';

/**
 * Forbidden fields that must NEVER appear in normal customer-facing API responses or serializers.
 */
const FORBIDDEN_CUSTOMER_FIELDS = [
  'trialAiBudgetUsd',
  'proAiBudgetUsd',
  'aiBudgetUsd',
  'aiBudgetRemainingUsd',
  'aiBudgetUsedUsd',
  'trialAiUsageUsd',
  'proAiUsageUsd',
  'aiCostUsd',
  'openAiCostUsd',
  'geminiCostUsd',
  'estimatedOpenAiCost',
  'estimatedGeminiCost',
  'internalAiCost',
  'tokenCostUsd',
  'openAiTokenCost',
  'geminiTokenCost',
  'spentUsd',
  'budgetUsd',
  'remainingUsd',
  'accessToken',
  'refreshToken',
  'oauthToken',
  'clientSecret',
  'clientSecretKey',
  'composioApiKey',
  'encryptionKey',
  'openAiApiKey',
  'geminiApiKey',
  'paddleApiKey',
  'paddleSecret',
  'paddleWebhookSecret',
  'webhookSecret',
  'password_hash',
  'passwordHash',
];

/**
 * Recursively inspect an object/array to ensure no forbidden internal fields exist.
 */
export function assertNoForbiddenFields(target: any, path: string = 'root') {
  if (target === null || target === undefined) return;

  if (Array.isArray(target)) {
    target.forEach((item, index) => assertNoForbiddenFields(item, `${path}[${index}]`));
    return;
  }

  if (typeof target === 'object') {
    for (const key of Object.keys(target)) {
      const currentPath = `${path}.${key}`;
      if (FORBIDDEN_CUSTOMER_FIELDS.includes(key)) {
        throw new Error(
          `🚨 CUSTOMER API LEAK DETECTED: Forbidden internal field "${key}" found at "${currentPath}"`
        );
      }

      // Check if string contains internal dollar budget disclosures
      if (typeof target[key] === 'string') {
        const val = target[key];
        if (val.includes('$0.50') || val.includes('$10.00') || val.includes('$10/month AI') || val.includes('$0.50 AI')) {
          throw new Error(
            `🚨 CUSTOMER TEXT LEAK DETECTED: Forbidden internal budget amount disclosed in text at "${currentPath}": "${val}"`
          );
        }
      }

      assertNoForbiddenFields(target[key], currentPath);
    }
  }
}

export async function runCustomerApiFieldAllowlistTests() {
  console.log('--- Running Customer API Field Allowlist & Information Security Tests ---');

  // 1. Positive Allowlist & Forbidden Field Check on Billing Config
  const safeConfig = toCustomerBillingConfig(config);
  assertNoForbiddenFields(safeConfig, 'billingConfig');

  const allowedConfigKeys = [
    'clientToken',
    'priceId',
    'environment',
    'isConfigured',
    'planName',
    'monthlyPriceUsd',
    'trialPeriodDays',
    'trialPriceUsd',
  ];
  for (const key of Object.keys(safeConfig)) {
    if (!allowedConfigKeys.includes(key)) {
      throw new Error(`Unexpected field "${key}" in customer billing config`);
    }
  }
  if (safeConfig.monthlyPriceUsd !== 19) {
    throw new Error(`Expected customer subscription price to be 19, got ${safeConfig.monthlyPriceUsd}`);
  }
  console.log('  ✓ 1. Customer billing config contains strictly allowed fields ($19/mo Pro, $0 trial, no AI budget)');

  // 2. Positive Allowlist & Forbidden Field Check on Trial Eligibility
  const safeEligibility = toCustomerTrialEligibility({
    eligible: true,
    normalizedEmail: 'test@example.com',
    hasUsedTrial: false,
    message: 'Eligible for 7-day free trial (no credit card required).',
    pricePerMonthUsd: 19,
  });
  assertNoForbiddenFields(safeEligibility, 'trialEligibility');

  const allowedEligibilityKeys = ['eligible', 'normalizedEmail', 'hasUsedTrial', 'message', 'pricePerMonthUsd'];
  for (const key of Object.keys(safeEligibility)) {
    if (!allowedEligibilityKeys.includes(key)) {
      throw new Error(`Unexpected field "${key}" in customer trial eligibility`);
    }
  }
  console.log('  ✓ 2. Customer trial eligibility response contains strictly allowed fields');

  // 3. Positive Allowlist on AI Status (Available, Trial, Exceeded)
  const availableBudgetStatus = {
    allowed: true,
    plan: 'TRIAL' as const,
    budgetUsd: 0.5,
    spentUsd: 0.1,
    remainingUsd: 0.4,
  };
  const customerAiAvailable = toCustomerAIStatus(availableBudgetStatus);
  assertNoForbiddenFields(customerAiAvailable, 'aiStatusAvailable');

  const allowedAiKeys = ['allowed', 'isExpired', 'isExceeded', 'plan', 'aiUsageStatus', 'reason'];
  for (const key of Object.keys(customerAiAvailable)) {
    if (!allowedAiKeys.includes(key)) {
      throw new Error(`Unexpected field "${key}" in customer AI status`);
    }
  }
  if (customerAiAvailable.aiUsageStatus !== 'LIMITED') {
    throw new Error(`Expected trial AI status to be LIMITED, got ${customerAiAvailable.aiUsageStatus}`);
  }
  console.log('  ✓ 3. Customer AI status is mapped to qualitative status ("LIMITED") without dollar amounts');

  // 4. Test Trial AI Budget Limit Exhaustion Customer-Safe Messaging
  const exceededBudgetStatus = {
    allowed: false,
    isExceeded: true,
    plan: 'TRIAL' as const,
    budgetUsd: 0.5,
    spentUsd: 0.5,
    remainingUsd: 0,
    reason: "You've reached the AI usage limit for your free trial. Upgrade to Pro to continue using your AI receptionist.",
  };
  const customerAiExceeded = toCustomerAIStatus(exceededBudgetStatus);
  assertNoForbiddenFields(customerAiExceeded, 'aiStatusExceeded');
  if (customerAiExceeded.aiUsageStatus !== 'LIMIT_REACHED') {
    throw new Error(`Expected status to be LIMIT_REACHED, got ${customerAiExceeded.aiUsageStatus}`);
  }
  if (!customerAiExceeded.reason?.includes("You've reached the AI usage limit for your free trial")) {
    throw new Error(`Expected customer-safe error reason, got: "${customerAiExceeded.reason}"`);
  }
  console.log('  ✓ 4. Trial AI limit exhaustion returns customer-safe reason without internal dollar calculations');

  // 5. Customer Billing Status Positive Allowlist
  const sampleSub = {
    id: 'sub_test_123',
    organizationId: 'org_test_123',
    status: SubscriptionStatus.TRIALING,
    trialStartedAt: '2026-09-01T00:00:00Z',
    trialEndsAt: '2026-09-08T00:00:00Z',
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  };
  const customerBillingStatus = toCustomerBillingStatus({
    subscription: sampleSub,
    isPro: true,
    daysRemainingInTrial: 7,
    billingConfigured: true,
    budgetStatus: availableBudgetStatus,
  });
  assertNoForbiddenFields(customerBillingStatus, 'billingStatus');

  const allowedBillingStatusKeys = [
    'subscription',
    'isPro',
    'daysRemainingInTrial',
    'billingConfigured',
    'aiUsageStatus',
  ];
  for (const key of Object.keys(customerBillingStatus)) {
    if (!allowedBillingStatusKeys.includes(key)) {
      throw new Error(`Unexpected field "${key}" in customer billing status`);
    }
  }
  console.log('  ✓ 5. Customer billing status positive allowlist verified');

  // 6. Integrations serializers positive allowlist (Website, Email, Calendar, Instagram)
  const safeWebsite = toCustomerWebsiteConfig({
    status: 'CONNECTED',
    domain: 'example.com',
    isVerified: true,
    scriptTag: '<script src="..."></script>',
    internalSecretKey: 'SECRET_DO_NOT_LEAK',
  });
  assertNoForbiddenFields(safeWebsite, 'websiteConfig');
  if ((safeWebsite as any).internalSecretKey) {
    throw new Error('Website serializer leaked internal secret key!');
  }

  const safeEmail = toCustomerEmailConfig({
    status: 'CONNECTED',
    emailAddress: 'owner@example.com',
    provider: 'GMAIL',
    isConfigured: true,
    oauthToken: 'oauth_access_token_12345',
    refreshToken: 'oauth_refresh_token_67890',
  });
  assertNoForbiddenFields(safeEmail, 'emailConfig');
  if ((safeEmail as any).oauthToken || (safeEmail as any).refreshToken) {
    throw new Error('Email serializer leaked OAuth tokens!');
  }

  const safeCalendar = toCustomerCalendarConfig({
    status: 'CONNECTED',
    calendarId: 'primary',
    calendarName: 'My Business Calendar',
    isConfigured: true,
    accessToken: 'google_oauth_token_abc',
    clientSecret: 'google_client_secret_xyz',
  });
  assertNoForbiddenFields(safeCalendar, 'calendarConfig');
  if ((safeCalendar as any).accessToken || (safeCalendar as any).clientSecret) {
    throw new Error('Calendar serializer leaked access token / client secret!');
  }

  const safeInstagram = toCustomerInstagramConfig({
    status: 'CONNECTED',
    username: 'my_salon_ig',
    instagramUserId: 'ig_user_123',
    accountType: 'BUSINESS',
    isConfigured: true,
    composioApiKey: 'comp_api_secret_key',
    encryptionKey: 'aes256_key',
  });
  assertNoForbiddenFields(safeInstagram, 'instagramConfig');
  if ((safeInstagram as any).composioApiKey || (safeInstagram as any).encryptionKey) {
    throw new Error('Instagram serializer leaked composio API key / encryption key!');
  }
  console.log('  ✓ 6. Integration serializers strip all OAuth tokens, credentials, and internal secrets');

  // 7. Multi-Tenant Isolation & Field Security across two synthetic organizations
  const ts = Date.now();
  const orgAEmail = `org_allowlist_a_${ts}@example.test`;
  const orgBEmail = `org_allowlist_b_${ts}@example.test`;

  const authOrgA = await AuthService.register({
    email: orgAEmail,
    password: 'Password123!',
    fullName: 'Owner A',
    businessName: 'Organization A Allowlist Test',
  });

  const authOrgB = await AuthService.register({
    email: orgBEmail,
    password: 'Password123!',
    fullName: 'Owner B',
    businessName: 'Organization B Allowlist Test',
  });

  const orgAId = authOrgA.organization!.id;
  const orgBId = authOrgB.organization!.id;

  await AuthService.completeOnboarding({
    userId: authOrgA.user.id,
    organizationId: orgAId,
    industry: 'Restaurant',
    businessKnowledge: 'Organization A Allowlist Test is open daily 9 AM to 9 PM. Located at 1 Test Street.',
  });
  await AuthService.completeOnboarding({
    userId: authOrgB.user.id,
    organizationId: orgBId,
    industry: 'Restaurant',
    businessKnowledge: 'Organization B Allowlist Test is open daily 10 AM to 8 PM. Located at 2 Test Avenue.',
  });

  const rawOrgASub = await PaddleBillingService.getSubscription(orgAId);
  const orgABudgetStatus = await AIBudgetService.checkBudget(orgAId);
  const safeOrgABilling = toCustomerBillingStatus({
    subscription: rawOrgASub.subscription,
    isPro: rawOrgASub.isPro,
    daysRemainingInTrial: rawOrgASub.daysRemainingInTrial,
    billingConfigured: rawOrgASub.billingConfigured,
    budgetStatus: orgABudgetStatus,
  });

  assertNoForbiddenFields(safeOrgABilling, 'orgA.billing');
  if (safeOrgABilling.subscription?.organizationId !== orgAId) {
    throw new Error(`Org A received incorrect organizationId`);
  }

  const rawOrgBSub = await PaddleBillingService.getSubscription(orgBId);
  const orgBBudgetStatus = await AIBudgetService.checkBudget(orgBId);
  const safeOrgBBilling = toCustomerBillingStatus({
    subscription: rawOrgBSub.subscription,
    isPro: rawOrgBSub.isPro,
    daysRemainingInTrial: rawOrgBSub.daysRemainingInTrial,
    billingConfigured: rawOrgBSub.billingConfigured,
    budgetStatus: orgBBudgetStatus,
  });

  assertNoForbiddenFields(safeOrgBBilling, 'orgB.billing');
  if (safeOrgBBilling.subscription?.organizationId !== orgBId) {
    throw new Error(`Org B received incorrect organizationId`);
  }

  if (safeOrgABilling.subscription?.id === safeOrgBBilling.subscription?.id) {
    throw new Error('Org A and Org B shared subscription record!');
  }

  console.log('  ✓ 7. Multi-tenant isolation verified with customer-safe allowlist serialization');
}
