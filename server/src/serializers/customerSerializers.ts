import {
  SubscriptionStatus,
  CustomerSubscription,
  CustomerBillingStatus,
  CustomerBillingConfig,
  CustomerAIStatus,
  TrialEligibilityResponse,
  AIUsageStatus,
} from '@onceclic/shared';
import { BudgetStatus } from '../services/AIBudgetService';

/**
 * 🚨 CUSTOMER-SAFE FIELD ALLOWLIST SERIALIZERS
 *
 * Rules:
 * 1. NEVER spread (...) internal DB models or ORM objects.
 * 2. NEVER expose internal AI cost values ($0.50, $10.00, spentUsd, budgetUsd, remainingUsd, openAiCostUsd).
 * 3. NEVER expose OAuth tokens, client secrets, API keys, webhook secrets, or internal encryption credentials.
 * 4. Explicitly construct and return only the approved customer-safe fields.
 */

/**
 * Map internal subscription and budget status to customer-safe billing status.
 */
export function toCustomerBillingStatus(params: {
  subscription: any | null;
  isPro: boolean;
  daysRemainingInTrial: number;
  billingConfigured: boolean;
  budgetStatus: BudgetStatus;
}): CustomerBillingStatus {
  let aiUsageStatus: AIUsageStatus = 'AVAILABLE';
  if (params.budgetStatus.isExceeded) {
    aiUsageStatus = 'LIMIT_REACHED';
  } else if (params.budgetStatus.plan === 'TRIAL') {
    aiUsageStatus = 'LIMITED';
  }

  const customerSub: CustomerSubscription | null = params.subscription
    ? {
        id: String(params.subscription.id),
        organizationId: String(params.subscription.organizationId || params.subscription.organization_id),
        status: params.subscription.status as SubscriptionStatus,
        trialStartedAt: params.subscription.trialStartedAt || params.subscription.trial_started_at || null,
        trialEndsAt: params.subscription.trialEndsAt || params.subscription.trial_ends_at || null,
        currentPeriodStart: params.subscription.currentPeriodStart || params.subscription.current_period_start || null,
        currentPeriodEnd: params.subscription.currentPeriodEnd || params.subscription.current_period_end || null,
        cancelAtPeriodEnd: Boolean(params.subscription.cancelAtPeriodEnd || params.subscription.cancel_at_period_end),
      }
    : null;

  return {
    subscription: customerSub,
    isPro: Boolean(params.isPro),
    daysRemainingInTrial: Number(params.daysRemainingInTrial) || 0,
    billingConfigured: Boolean(params.billingConfigured),
    aiUsageStatus,
  };
}

/**
 * Map server billing config to client-safe billing & pricing config.
 * Note: $19/mo is the subscription price. Internal AI budgets ($0.50/$10) are NEVER returned.
 */
export function toCustomerBillingConfig(config: {
  paddle: {
    clientToken: string;
    priceId: string;
    environment: 'sandbox' | 'production';
    isConfigured: boolean;
  };
  billing: {
    planName: string;
    monthlyPriceUsd: number;
    trialPeriodDays: number;
    trialPriceUsd: number;
  };
}): CustomerBillingConfig {
  return {
    clientToken: String(config.paddle.clientToken || ''),
    priceId: String(config.paddle.priceId || ''),
    environment: config.paddle.environment === 'production' ? 'production' : 'sandbox',
    isConfigured: Boolean(config.paddle.isConfigured),
    planName: String(config.billing.planName || 'ONCEClic Pro'),
    monthlyPriceUsd: Number(config.billing.monthlyPriceUsd) || 19,
    trialPeriodDays: Number(config.billing.trialPeriodDays) || 7,
    trialPriceUsd: Number(config.billing.trialPriceUsd) || 0,
  };
}

/**
 * Map internal trial eligibility calculation to customer-safe response.
 */
export function toCustomerTrialEligibility(data: {
  eligible: boolean;
  normalizedEmail: string;
  hasUsedTrial: boolean;
  message?: string;
  pricePerMonthUsd: number;
}): TrialEligibilityResponse {
  return {
    eligible: Boolean(data.eligible),
    normalizedEmail: String(data.normalizedEmail || ''),
    hasUsedTrial: Boolean(data.hasUsedTrial),
    message: data.message ? String(data.message) : undefined,
    pricePerMonthUsd: Number(data.pricePerMonthUsd) || 19,
  };
}

/**
 * Map internal AI budget status to customer-safe status.
 * Internal dollar spending and remaining budget are excluded.
 */
export function toCustomerAIStatus(budgetStatus: BudgetStatus): CustomerAIStatus {
  let aiUsageStatus: AIUsageStatus = 'AVAILABLE';
  if (budgetStatus.isExceeded) {
    aiUsageStatus = 'LIMIT_REACHED';
  } else if (budgetStatus.plan === 'TRIAL') {
    aiUsageStatus = 'LIMITED';
  }

  return {
    allowed: Boolean(budgetStatus.allowed),
    isExpired: budgetStatus.isExpired ? Boolean(budgetStatus.isExpired) : undefined,
    isExceeded: budgetStatus.isExceeded ? Boolean(budgetStatus.isExceeded) : undefined,
    plan: budgetStatus.plan,
    aiUsageStatus,
    reason: budgetStatus.reason ? String(budgetStatus.reason) : undefined,
  };
}

/**
 * Customer-safe Website integration serializer
 */
export function toCustomerWebsiteConfig(data: any) {
  return {
    status: String(data?.status || 'NOT_CONNECTED'),
    domain: data?.domain ? String(data.domain) : undefined,
    isVerified: Boolean(data?.isVerified ?? data?.is_verified),
    scriptTag: data?.scriptTag ? String(data.scriptTag) : undefined,
    lastSyncedAt: data?.lastSyncedAt || data?.last_synced_at || undefined,
    errorMessage: data?.errorMessage || data?.error_message || undefined,
  };
}

/**
 * Customer-safe Email integration serializer (strips imap_pass, oauth tokens)
 */
export function toCustomerEmailConfig(data: any) {
  return {
    status: String(data?.status || 'NOT_CONNECTED'),
    emailAddress: data?.emailAddress || data?.email_address || data?.email || undefined,
    provider: data?.provider ? String(data.provider) : undefined,
    isConfigured: Boolean(data?.isConfigured ?? data?.is_configured),
    lastSyncedAt: data?.lastSyncedAt || data?.last_synced_at || undefined,
    errorMessage: data?.errorMessage || data?.error_message || undefined,
  };
}

/**
 * Customer-safe Google Calendar integration serializer (strips tokens & secrets)
 */
export function toCustomerCalendarConfig(data: any) {
  return {
    status: String(data?.status || 'NOT_CONNECTED'),
    calendarId: data?.calendarId || data?.calendar_id || undefined,
    calendarName: data?.calendarName || data?.calendar_name || undefined,
    isConfigured: Boolean(data?.isConfigured ?? data?.is_configured),
    lastSyncedAt: data?.lastSyncedAt || data?.last_synced_at || undefined,
    errorMessage: data?.errorMessage || data?.error_message || undefined,
  };
}

/**
 * Customer-safe Instagram integration serializer (strips tokens & composio internal secrets)
 */
export function toCustomerInstagramConfig(data: any) {
  return {
    status: String(data?.status || 'NOT_CONNECTED'),
    username: data?.username ? String(data.username) : undefined,
    instagramUserId: data?.instagramUserId || data?.instagram_user_id || undefined,
    accountType: data?.accountType || data?.account_type || undefined,
    isConfigured: Boolean(data?.isConfigured ?? data?.is_configured),
    lastSyncedAt: data?.lastSyncedAt || data?.last_synced_at || undefined,
    errorMessage: data?.errorMessage || data?.error_message || undefined,
  };
}

/**
 * Customer-safe Facebook integration serializer (strips tokens & composio internal secrets)
 */
export function toCustomerFacebookConfig(data: any) {
  return {
    status: String(data?.status || 'NOT_CONNECTED'),
    pageName: data?.pageName || data?.page_name || undefined,
    pageId: data?.pageId || data?.page_id || undefined,
    isConfigured: Boolean(data?.isConfigured ?? data?.is_configured),
    lastSyncedAt: data?.lastSyncedAt || data?.last_synced_at || undefined,
    errorMessage: data?.errorMessage || data?.error_message || undefined,
  };
}

