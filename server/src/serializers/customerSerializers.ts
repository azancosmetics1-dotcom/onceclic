import {
  SubscriptionStatus,
  CustomerSubscription,
  CustomerBillingStatus,
  CustomerBillingConfig,
  CustomerPlanConfig,
  CustomerAIStatus,
  TrialEligibilityResponse,
  AIUsageStatus,
  PlanTier,
  PaidPlanTier,
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
  isPro?: boolean;
  planTier?: PlanTier;
  daysRemainingInTrial?: number;
  billingConfigured?: boolean;
  budgetStatus?: BudgetStatus;
  aiUsageStatus?: AIUsageStatus;
}): CustomerBillingStatus {
  let aiUsageStatus: AIUsageStatus = (params as any).aiUsageStatus || 'AVAILABLE';
  if (params.budgetStatus?.isExceeded) {
    aiUsageStatus = 'LIMIT_REACHED';
  } else if (params.budgetStatus?.plan === 'TRIAL') {
    aiUsageStatus = 'LIMITED';
  }

  const rawPlanTier: PlanTier =
    params.planTier ||
    params.subscription?.planTier ||
    params.subscription?.plan_tier ||
    (params.isPro ? 'PRO' : 'TRIAL');

  const customerSub: CustomerSubscription | null = params.subscription
    ? {
        id: String(params.subscription.id),
        organizationId: String(params.subscription.organizationId || params.subscription.organization_id),
        status: params.subscription.status as SubscriptionStatus,
        planTier: rawPlanTier,
        priceId: params.subscription.priceId || params.subscription.price_id || null,
        creemProductId: params.subscription.creemProductId || params.subscription.creem_product_id || null,
        creemCustomerId: params.subscription.creemCustomerId || params.subscription.creem_customer_id || null,
        creemSubscriptionId: params.subscription.creemSubscriptionId || params.subscription.creem_subscription_id || null,
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
    planTier: rawPlanTier,
    daysRemainingInTrial: Number(params.daysRemainingInTrial) || 0,
    billingConfigured: Boolean(params.billingConfigured),
    aiUsageStatus,
  };
}

/**
 * Map server billing config to client-safe billing & pricing config.
 * Note: Internal AI budgets ($0.50/$10) are NEVER returned.
 */
export function toCustomerBillingConfig(config: any): CustomerBillingConfig {
  const creem = (config as any).creem || {};
  const paddle = (config as any).paddle || {};
  const isCreemActive = Boolean(creem.isConfigured || creem.plans?.PRO?.productId);

  const starterProductId = creem.plans?.STARTER?.productId || '';
  const proProductId = creem.plans?.PRO?.productId || '';
  const businessProductId = creem.plans?.BUSINESS?.productId || '';

  const starterPriceId = paddle.plans?.STARTER?.priceId || (config as any).plans?.STARTER?.priceId || '';
  const proPriceId = paddle.plans?.PRO?.priceId || paddle.priceId || (config as any).plans?.PRO?.priceId || '';
  const businessPriceId = paddle.plans?.BUSINESS?.priceId || (config as any).plans?.BUSINESS?.priceId || '';

  const plans: Record<PaidPlanTier, CustomerPlanConfig> = {
    STARTER: {
      id: 'STARTER',
      name: 'Starter',
      priceUsd: 19,
      productId: starterProductId && !starterProductId.includes('placeholder') ? starterProductId : null,
      priceId: starterPriceId && !starterPriceId.includes('placeholder') ? starterPriceId : null,
      isConfigured: Boolean(
        (starterProductId && !starterProductId.includes('placeholder')) ||
        (starterPriceId && !starterPriceId.includes('placeholder'))
      ),
      voiceMinutes: 50,
      features: [
        '50 Included Voice Minutes / mo',
        '24/7 AI Phone Receptionist',
        'Existing Business Number Forwarding',
        'Google Calendar Real-Time Booking',
        '24/7 Website Live Chat Widget',
      ],
    },
    PRO: {
      id: 'PRO',
      name: 'ONCEClic Pro',
      priceUsd: 49,
      productId: proProductId && !proProductId.includes('placeholder') ? proProductId : null,
      priceId: proPriceId && !proPriceId.includes('placeholder') ? proPriceId : null,
      isConfigured: Boolean(
        (proProductId && !proProductId.includes('placeholder')) ||
        (proPriceId && !proPriceId.includes('placeholder'))
      ),
      voiceMinutes: 150,
      highlight: true,
      badge: 'Most Popular',
      features: [
        '150 Included Voice Minutes / mo',
        'Everything in Starter',
        'Call Transcripts & Recordings',
        'SMS & Email Confirmation Alerts',
        'Custom Industry Knowledge & FAQs',
        'Priority Support',
      ],
    },
    BUSINESS: {
      id: 'BUSINESS',
      name: 'Business',
      priceUsd: 99,
      productId: businessProductId && !businessProductId.includes('placeholder') ? businessProductId : null,
      priceId: businessPriceId && !businessPriceId.includes('placeholder') ? businessPriceId : null,
      isConfigured: Boolean(
        (businessProductId && !businessProductId.includes('placeholder')) ||
        (businessPriceId && !businessPriceId.includes('placeholder'))
      ),
      voiceMinutes: 400,
      features: [
        '400 Included Voice Minutes / mo',
        'Everything in Pro',
        'Multiple Phone Numbers Support',
        'Dedicated Team Member Inboxes',
        'Advanced Call Analytics & Reporting',
      ],
    },
  };

  return {
    provider: isCreemActive ? 'creem' : 'paddle',
    clientToken: String(paddle.clientToken || ''),
    priceId: String(paddle.priceId || proPriceId || ''),
    environment: isCreemActive ? (creem.environment === 'prod' ? 'production' : 'test') : (paddle.environment === 'production' ? 'production' : 'sandbox'),
    isConfigured: Boolean(creem.isConfigured || paddle.isConfigured),
    planName: String(config.billing?.planName || 'ONCEClic Pro'),
    monthlyPriceUsd: Number(config.billing?.monthlyPriceUsd) || 19,
    trialPeriodDays: Number(config.billing?.trialPeriodDays) || 7,
    trialPriceUsd: Number(config.billing?.trialPriceUsd) || 0,
    plans,
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
    provisioningStatus: String(config?.provisioningStatus || (config?.receptionistActive ? 'ACTIVE' : 'NOT_CONFIGURED')),
    connectionTestStatus: String(config?.connectionTestStatus || 'NOT_TESTED'),
    phoneNumbers: Array.isArray(config?.phoneNumbers)
      ? config.phoneNumbers.map((p: any) => ({
          id: String(p.id),
          phoneNumber: String(p.phoneNumber || p.phone_number),
          countryCode: p.countryCode || p.country_code ? String(p.countryCode || p.country_code) : undefined,
          phoneNumberType: String(p.phoneNumberType || p.phone_number_type || 'EXISTING'),
          connectionMethod: String(p.connectionMethod || p.connection_method || 'EXISTING_FORWARDING'),
          forwardingTarget: p.forwardingTarget || p.forwarding_target ? String(p.forwardingTarget || p.forwarding_target) : undefined,
          sipEndpoint: p.sipEndpoint || p.sip_endpoint ? String(p.sipEndpoint || p.sip_endpoint) : undefined,
          status: String(p.status || 'ACTIVE'),
          provisioningStatus: String(p.provisioningStatus || p.provisioning_status || p.status || 'ACTIVE'),
          monthlyCostUsd: p.monthlyCostUsd !== undefined ? Number(p.monthlyCostUsd || p.monthly_cost_usd) : undefined,
          setupCostUsd: p.setupCostUsd !== undefined ? Number(p.setupCostUsd || p.setup_cost_usd) : undefined,
          regulatoryStatus: p.regulatoryStatus || p.regulatory_status ? String(p.regulatoryStatus || p.regulatory_status) : undefined,
          requiredDocuments: Array.isArray(p.requiredDocuments || p.required_documents) ? (p.requiredDocuments || p.required_documents) : [],
          actionRequiredReason: p.actionRequiredReason || p.action_required_reason ? String(p.actionRequiredReason || p.action_required_reason) : undefined,
          lastError: p.lastError || p.last_error ? String(p.lastError || p.last_error) : undefined,
          verificationStatus: p.verificationStatus || p.verification_status ? String(p.verificationStatus || p.verification_status) : undefined,
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

