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

/**
 * Customer-safe Voice Receptionist Config & Usage Serializer
 */
export function toCustomerVoiceConfig(config: any) {
  const usage = config?.voiceUsage || {};
  return {
    receptionistActive: Boolean(config?.receptionistActive),
    isConfigured: Boolean(config?.isConfigured),
    activeNumber: config?.activeNumber ? String(config.activeNumber) : undefined,
    connectionMethod: config?.connectionMethod ? String(config.connectionMethod) : undefined,
    setupState: String(config?.setupState || 'NOT_CONFIGURED'),
    connectionTestStatus: String(config?.connectionTestStatus || 'NOT_TESTED'),
    phoneNumbers: Array.isArray(config?.phoneNumbers)
      ? config.phoneNumbers.map((p: any) => ({
          id: String(p.id),
          phoneNumber: String(p.phoneNumber || p.phone_number),
          phoneNumberType: String(p.phoneNumberType || p.phone_number_type || 'EXISTING'),
          connectionMethod: String(p.connectionMethod || p.connection_method || 'EXISTING_FORWARDING'),
          forwardingTarget: p.forwardingTarget || p.forwarding_target ? String(p.forwardingTarget || p.forwarding_target) : undefined,
          sipEndpoint: p.sipEndpoint || p.sip_endpoint ? String(p.sipEndpoint || p.sip_endpoint) : undefined,
          status: String(p.status || 'ACTIVE'),
          createdAt: String(p.createdAt || p.created_at),
        }))
      : [],
    voiceUsage: {
      planTier: String(usage.planTier || 'PRO'),
      includedMinutes: Number(usage.includedMinutes) || 150,
      usedMinutes: Number(usage.usedMinutes) || 0,
      remainingMinutes: Number(usage.remainingMinutes) || 0,
      percentageUsed: Number(usage.percentageUsed) || 0,
      limitReached: Boolean(usage.limitReached),
      billingPeriodStart: String(usage.billingPeriodStart || new Date().toISOString()),
      billingPeriodEnd: String(usage.billingPeriodEnd || new Date().toISOString()),
    },
  };
}

/**
 * Customer-safe Voice Analytics Serializer
 */
export function toCustomerVoiceAnalytics(analytics: any) {
  return {
    totalCalls: Number(analytics?.totalCalls) || 0,
    answeredCalls: Number(analytics?.answeredCalls) || 0,
    totalDurationSeconds: Number(analytics?.totalDurationSeconds) || 0,
    totalMinutes: Number(analytics?.totalMinutes) || 0,
    averageDurationSeconds: Number(analytics?.averageDurationSeconds) || 0,
    appointmentsBooked: Number(analytics?.appointmentsBooked) || 0,
    appointmentsRescheduled: Number(analytics?.appointmentsRescheduled) || 0,
    appointmentsCanceled: Number(analytics?.appointmentsCanceled) || 0,
    generalInquiries: Number(analytics?.generalInquiries) || 0,
  };
}

/**
 * Mask caller phone number for privacy in UI while keeping identification useful
 */
export function maskPhoneNumber(phone: string | undefined | null): string {
  if (!phone) return 'Unknown Caller';
  const clean = phone.trim();
  if (clean.length <= 4) return clean;
  const last4 = clean.slice(-4);
  const prefix = clean.slice(0, 3);
  return `${prefix}***${last4}`;
}

/**
 * Customer-safe Voice Call Record Serializer
 */
export function toCustomerCallRecord(call: any) {
  return {
    id: String(call.id),
    callerPhone: maskPhoneNumber(call.callerPhone || call.caller_phone),
    direction: String(call.direction || 'INBOUND'),
    startedAt: String(call.startedAt || call.started_at),
    endedAt: call.endedAt || call.ended_at ? String(call.endedAt || call.ended_at) : undefined,
    durationSeconds: Number(call.durationSeconds ?? call.duration_seconds) || 0,
    durationMinutes: Number(call.durationMinutes ?? call.duration_minutes) || 0,
    status: String(call.status || 'COMPLETED'),
    outcome: String(call.outcome || 'GENERAL_INQUIRY'),
    hasBookedAppointment: Boolean(call.bookedAppointmentId || call.booked_appointment_id),
    hasTranscript: Boolean(call.transcript && call.transcript.trim().length > 0),
    transcript: call.transcript ? String(call.transcript) : undefined,
    hasRecording: Boolean(call.recordingUrl || call.recording_url),
    createdAt: String(call.createdAt || call.created_at),
  };
}

export function toCustomerCallRecordList(calls: any[]) {
  if (!Array.isArray(calls)) return [];
  return calls.map((c) => toCustomerCallRecord(c));
}

