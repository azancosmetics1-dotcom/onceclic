import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { Subscription, SubscriptionStatus, PlanTier, PaidPlanTier, SUBSCRIPTION_PLANS } from '@onceclic/shared';
import { Badge } from '../components/Badge';
import { useAuth } from '../context/AuthContext';
import {
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ExternalLink,
  ShieldCheck,
  Zap,
  Sparkles,
  RefreshCw,
  XCircle,
  HelpCircle,
  Check,
} from 'lucide-react';

export const BillingPage: React.FC = () => {
  const { organization, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [billingStatus, setBillingStatus] = useState<any>(null);
  const [billingConfig, setBillingConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutOpening, setCheckoutOpening] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [cancelingLoading, setCancelingLoading] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const checkoutSuccess = searchParams.get('checkout') === 'success';

  const loadBilling = useCallback(async () => {
    try {
      const [status, config] = await Promise.all([
        api.getBillingStatus(),
        api.getBillingConfig().catch(() => null),
      ]);
      setBillingStatus(status);
      setBillingConfig(config);
      return { status, config };
    } catch (err) {
      console.error('[Billing] Failed to load billing status:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Load billing data on mount
  useEffect(() => {
    loadBilling();
  }, [loadBilling]);

  // Handle checkout=success redirect acknowledgment
  useEffect(() => {
    if (checkoutSuccess) {
      setActionMessage({
        type: 'success',
        text: 'Payment received! Your ONCEClic subscription is being synchronized with Creem.',
      });
      loadBilling();
      // Remove query parameter without reloading
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('checkout');
      setSearchParams(newParams, { replace: true });
    }
  }, [checkoutSuccess, loadBilling, searchParams, setSearchParams]);

  /**
   * Creem Server-Side Checkout: Call the server to create a Creem checkout session URL
   * then redirect the browser to it. No client-side JavaScript SDK is required.
   */
  const handleCreemCheckout = async (targetTier: PaidPlanTier = 'PRO') => {
    const planMeta = SUBSCRIPTION_PLANS[targetTier];
    const planConfig = billingConfig?.plans?.[targetTier];

    // Guard: ensure this plan is configured (has a product ID)
    if (!planConfig?.isConfigured && !planConfig?.productId) {
      setActionMessage({
        type: 'error',
        text: `Checkout for the ${planMeta?.name || targetTier} plan ($${planMeta?.priceUsd || ''}/mo) is not currently available because its Creem Product ID (CREEM_${targetTier}_PRODUCT_ID) is not configured on the server. Please contact support.`,
      });
      return;
    }

    setCheckoutOpening(true);
    setActionMessage(null);

    try {
      // The server creates a Creem checkout session and returns its URL
      const session = await api.createCheckoutSession(targetTier);

      if (!session?.checkoutUrl) {
        throw new Error('No checkout URL returned from server.');
      }

      // Redirect to Creem-hosted checkout page
      window.location.href = session.checkoutUrl;
    } catch (err: any) {
      console.error('[Creem Checkout] Error initiating checkout:', err);
      setActionMessage({
        type: 'error',
        text: err?.message || 'Failed to initiate Creem Checkout. Please check your connection and try again.',
      });
      setCheckoutOpening(false);
    }
  };

  const handleOpenCustomerPortal = async () => {
    setPortalLoading(true);
    setActionMessage(null);
    try {
      const res = await api.createCustomerPortalSession();
      if (res.url) {
        window.open(res.url, '_blank', 'noopener,noreferrer');
      } else {
        throw new Error('No portal URL returned.');
      }
    } catch (err: any) {
      console.error('[Billing] Customer portal error:', err);
      setActionMessage({
        type: 'error',
        text: err?.message || 'Unable to open Creem Customer Portal. Please try again later.',
      });
    } finally {
      setPortalLoading(false);
    }
  };

  const handleConfirmCancel = async () => {
    setCancelingLoading(true);
    setActionMessage(null);
    try {
      const res = await api.cancelSubscription();
      setShowCancelModal(false);
      setActionMessage({
        type: 'success',
        text: 'Your subscription cancellation has been scheduled for the end of the current billing period. You will retain full Pro access until then.',
      });
      await loadBilling();
    } catch (err: any) {
      console.error('[Billing] Cancel subscription error:', err);
      setActionMessage({
        type: 'error',
        text: err?.message || 'Failed to schedule subscription cancellation.',
      });
    } finally {
      setCancelingLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const sub: Subscription | null = billingStatus?.subscription;
  const isTrial = sub?.status === SubscriptionStatus.TRIALING;
  const isActive = sub?.status === SubscriptionStatus.ACTIVE;
  const isPastDue = sub?.status === SubscriptionStatus.PAST_DUE;
  // Creem uses creemSubscriptionId; support legacy paddleSubscriptionId during coexistence period
  const hasPaidSubscriptionId = !!(sub as any)?.creemSubscriptionId || !!(sub as any)?.paddleSubscriptionId;
  const isExpired = sub?.status === SubscriptionStatus.EXPIRED || (isTrial && !hasPaidSubscriptionId && (billingStatus?.daysRemainingInTrial || 0) <= 0);
  const isCanceled = sub?.status === SubscriptionStatus.CANCELED;
  const isCancelScheduled = sub?.cancelAtPeriodEnd && (isActive || isTrial);
  const isTrialEndingSoon = isTrial && !hasPaidSubscriptionId && billingStatus?.daysRemainingInTrial === 1;
  const isPaidActive = isActive && hasPaidSubscriptionId;
  const currentTier: PlanTier = (billingStatus?.planTier as PlanTier) || (sub?.planTier as PlanTier) || (isPaidActive ? 'PRO' : 'TRIAL');
  const activePlanMeta = SUBSCRIPTION_PLANS[currentTier] || SUBSCRIPTION_PLANS.STARTER;

  // Creem customer ID for portal access — fallback to legacy paddleCustomerId
  const hasCreemCustomer = !!(sub as any)?.creemCustomerId || !!(sub as any)?.paddleCustomerId;

  return (
    <div className="space-y-8 max-w-5xl w-full min-w-0">
      {/* Page Header */}
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2.5 flex-wrap">
          <CreditCard className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-400 flex-shrink-0" />
          <span>Billing &amp; Subscription</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Manage your ONCEClic subscription tier, voice minutes, and Creem merchant-of-record billing.
        </p>
      </div>

      {/* Action Notification Banner */}
      {actionMessage && (
        <div
          className={`p-4 rounded-2xl border text-xs flex items-start sm:items-center justify-between gap-3 break-words ${
            actionMessage.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
          }`}
        >
          <div className="flex items-start sm:items-center gap-2 min-w-0 flex-1">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5 sm:mt-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5 sm:mt-0" />
            )}
            <span className="min-w-0">{actionMessage.text}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            className="text-slate-400 hover:text-white shrink-0 text-xs font-bold px-1"
          >
            &times;
          </button>
        </div>
      )}

      {/* Current Subscription Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl p-5 sm:p-8 shadow-2xl relative overflow-hidden min-w-0">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 sm:gap-8">
          <div className="space-y-4 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
              <h2 className="text-xl sm:text-2xl font-black text-white">
                {isTrial && !hasPaidSubscriptionId ? '7-Day Free Trial' : `${activePlanMeta.name} Plan`}
              </h2>
              {isCancelScheduled ? (
                <Badge variant="warning">Canceling at Period End</Badge>
              ) : isPaidActive ? (
                <Badge variant="success">{activePlanMeta.name} Active</Badge>
              ) : isTrialEndingSoon ? (
                <Badge variant="warning">Trial Ending Soon</Badge>
              ) : isTrial ? (
                <Badge variant="brand">Trial Active</Badge>
              ) : isExpired ? (
                <Badge variant="danger">Trial Expired</Badge>
              ) : isPastDue ? (
                <Badge variant="warning">Past Due</Badge>
              ) : isCanceled ? (
                <Badge variant="danger">Canceled</Badge>
              ) : (
                <Badge variant="danger">Inactive</Badge>
              )}
            </div>

            {/* Pricing Details */}
            <div className="space-y-1">
              <div className="flex items-baseline space-x-2">
                <span className="text-3xl sm:text-4xl font-black text-white">
                  {isTrial && !hasPaidSubscriptionId ? '$0' : `$${activePlanMeta.priceUsd}`}
                </span>
                <span className="text-xs sm:text-sm font-medium text-slate-400">
                  {isTrial && !hasPaidSubscriptionId ? 'during 7-day trial' : '/ month recurring'}
                </span>
              </div>
              <p className="text-xs font-semibold text-emerald-400">
                {isTrial && !hasPaidSubscriptionId
                  ? `7-Day Free Trial • ${activePlanMeta.voiceMinutes} Voice Minutes • No credit card required`
                  : `${activePlanMeta.name} • ${activePlanMeta.voiceMinutes} Voice Minutes/month • Cancel anytime`}
              </p>
            </div>

            {/* AI Receptionist Status Box (Customer-Safe) */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 max-w-md space-y-2 min-w-0">
              <div className="flex items-center justify-between text-xs gap-2 flex-wrap">
                <span className="text-slate-400 font-medium flex items-center space-x-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Voice AI Allowance</span>
                </span>
                <span className="font-bold text-white">
                  {billingStatus?.aiUsageStatus === 'LIMIT_REACHED' ? (
                    <span className="text-rose-400">Limit Reached</span>
                  ) : billingStatus?.aiUsageStatus === 'LIMITED' ? (
                    <span className="text-amber-400">Trial Allocation</span>
                  ) : (
                    <span className="text-emerald-400">Active ({activePlanMeta.voiceMinutes}m)</span>
                  )}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {billingStatus?.aiUsageStatus === 'LIMIT_REACHED'
                  ? "You've reached your monthly voice minute limit. Upgrade your subscription below to increase your capacity."
                  : isTrial && !hasPaidSubscriptionId
                  ? 'Includes 15 voice minutes during your cardless trial. Upgrade below for 50 to 400 minutes/month.'
                  : `Includes ${activePlanMeta.voiceMinutes} monthly voice minutes subject to reasonable-use limits.`}
              </p>
            </div>

            {/* Status Information Box */}
            <div className="text-xs text-slate-300 space-y-1.5 pt-2">
              {isCancelScheduled && (
                <p className="flex items-start sm:items-center gap-2 text-amber-400 font-semibold bg-amber-950/30 border border-amber-500/20 p-2.5 rounded-xl">
                  <Clock className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0" />
                  <span>
                    Cancellation scheduled for{' '}
                    {sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : 'period end'}.
                    Full access remains active until that date.
                  </span>
                </p>
              )}

              {isActive && !isCancelScheduled && hasPaidSubscriptionId && (
                <p className="flex items-center space-x-1.5 text-emerald-400 font-semibold">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    Subscription active &bull; Renews on{' '}
                    {sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : 'next billing cycle'}
                  </span>
                </p>
              )}

              {isTrialEndingSoon && (
                <p className="flex items-start sm:items-center gap-1.5 text-amber-400 font-semibold bg-amber-950/30 border border-amber-500/20 p-2.5 rounded-xl">
                  <Clock className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0" />
                  <span>
                    Your free trial ends tomorrow. Choose a paid plan below to continue uninterrupted.
                  </span>
                </p>
              )}

              {isTrial && !hasPaidSubscriptionId && !isTrialEndingSoon && (
                <p className="flex items-start sm:items-center gap-1.5 text-amber-400 font-semibold">
                  <Clock className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0" />
                  <span>
                    Trial active &bull; {billingStatus?.daysRemainingInTrial || 0} days remaining (Ends{' '}
                    {sub?.trialEndsAt ? new Date(sub.trialEndsAt).toLocaleDateString() : 'soon'}). No credit card required.
                  </span>
                </p>
              )}

              {isExpired && (
                <p className="flex items-start sm:items-center gap-1.5 text-rose-400 font-semibold bg-rose-950/30 border border-rose-500/20 p-2.5 rounded-xl">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0" />
                  <span>Your free trial has ended. Select a plan below to reactivate your AI receptionist.</span>
                </p>
              )}

              {isCanceled && !isExpired && (
                <p className="flex items-start sm:items-center gap-1.5 text-rose-400 font-semibold">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0" />
                  <span>Subscription canceled. Select a plan below to reactivate your service.</span>
                </p>
              )}

              {isPastDue && (
                <p className="flex items-start sm:items-center gap-1.5 text-amber-400 font-semibold">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0" />
                  <span>Payment past due. Please update your payment method via the customer portal.</span>
                </p>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row lg:flex-col gap-3 shrink-0 w-full lg:w-auto">
            {!isPaidActive && (
              <a
                href="#plans-section"
                className="w-full px-6 sm:px-8 py-3.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs sm:text-sm rounded-xl transition shadow-lg shadow-emerald-500/25 flex items-center justify-center space-x-2"
              >
                <Zap className="w-4 h-4" />
                <span>Choose a Subscription Plan</span>
              </a>
            )}

            {hasCreemCustomer && (
              <button
                onClick={handleOpenCustomerPortal}
                disabled={portalLoading}
                className="w-full px-5 sm:px-6 py-3 bg-slate-800 hover:bg-slate-750 text-white font-bold text-xs rounded-xl border border-slate-700 transition flex items-center justify-center space-x-2"
              >
                {portalLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                ) : (
                  <ExternalLink className="w-4 h-4 text-emerald-400" />
                )}
                <span>Creem Customer Portal</span>
              </button>
            )}

            {isActive && !isCancelScheduled && hasPaidSubscriptionId && (
              <button
                onClick={() => setShowCancelModal(true)}
                className="w-full px-4 py-2.5 bg-slate-950 hover:bg-rose-950/40 text-slate-400 hover:text-rose-300 font-semibold text-xs rounded-xl border border-slate-800 transition flex items-center justify-center space-x-1.5"
              >
                <span>Cancel Subscription</span>
              </button>
            )}

            <div className="flex items-center space-x-1.5 text-[11px] text-slate-400 justify-center pt-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Creem Merchant of Record</span>
            </div>
          </div>
        </div>
      </div>

      {/* Available Subscription Plans Selection Grid */}
      <div id="plans-section" className="space-y-4 pt-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-white">Select a Subscription Tier</h2>
            <p className="text-xs text-slate-400">
              Choose the monthly voice capacity and features suited for your business.
            </p>
          </div>
        </div>

        {/* Pre-Checkout Merchant of Record & Policy Disclosure */}
        <div className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-4 text-xs text-slate-300 space-y-1.5">
          <div className="flex items-center space-x-2 text-emerald-400 font-semibold">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Merchant of Record &amp; Billing Notice</span>
          </div>
          <p className="text-slate-400 text-[11px] leading-relaxed">
            Payments, checkout security, tax compliance, and recurring subscription billing are securely processed by <strong>Creem</strong> as our Merchant of Record. Subscriptions automatically renew monthly until canceled. You may cancel anytime from this dashboard or the customer portal with access continuing through your paid cycle. Review our{' '}
            <Link to="/refund-policy" className="text-emerald-400 hover:underline font-medium">Refund Policy</Link> and{' '}
            <Link to="/terms" className="text-emerald-400 hover:underline font-medium">Terms of Service</Link>.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {(['STARTER', 'PRO', 'BUSINESS'] as PaidPlanTier[]).map((tier) => {
            const plan = SUBSCRIPTION_PLANS[tier];
            const planConfig = billingConfig?.plans?.[tier];
            const isCurrentPlan = isPaidActive && currentTier === tier;
            const isConfigured = !!(planConfig?.isConfigured && planConfig?.productId);
            const isPro = tier === 'PRO';

            return (
              <div
                key={tier}
                className={`bg-slate-900 border rounded-2xl p-6 flex flex-col justify-between relative transition-all ${
                  isCurrentPlan
                    ? 'border-emerald-500 shadow-xl shadow-emerald-500/10'
                    : isPro
                    ? 'border-emerald-500/50 shadow-lg shadow-emerald-500/5'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                {isPro && !isCurrentPlan && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-emerald-500 to-teal-400 text-slate-950 text-[10px] font-black uppercase tracking-wider py-1 px-3 rounded-full shadow-md">
                    Most Popular
                  </span>
                )}
                {isCurrentPlan && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-500 text-slate-950 text-[10px] font-black uppercase tracking-wider py-1 px-3 rounded-full shadow-md">
                    Current Active Plan
                  </span>
                )}

                <div className="space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-white">{plan.name}</h3>
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-3xl font-black text-white">${plan.priceUsd}</span>
                      <span className="text-xs text-slate-400">/month</span>
                    </div>
                    <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs font-semibold text-emerald-400">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{plan.voiceMinutes} Voice Minutes / mo</span>
                    </div>
                  </div>

                  <div className="border-t border-slate-800/80 pt-4 space-y-2.5">
                    {plan.features.map((feature, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-slate-300">
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-800/80">
                  {isCurrentPlan ? (
                    <button
                      disabled
                      className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-slate-800 text-emerald-400 border border-emerald-500/30 cursor-default"
                    >
                      Current Plan
                    </button>
                  ) : (
                    <button
                      onClick={() => handleCreemCheckout(tier)}
                      disabled={checkoutOpening}
                      className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 ${
                        isPro
                          ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20'
                          : 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700'
                      }`}
                    >
                      {checkoutOpening ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Zap className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {checkoutOpening
                          ? 'Redirecting to Creem...'
                          : isPaidActive
                          ? `Switch to ${plan.name} ($${plan.priceUsd}/mo)`
                          : `Upgrade to ${plan.name} ($${plan.priceUsd}/mo)`}
                      </span>
                    </button>
                  )}
                  {!isConfigured && !isCurrentPlan && (
                    <p className="mt-2 text-[10px] text-amber-400/80 text-center font-medium">
                      Creem Product ID not yet configured on server
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Gateway & Environment Diagnostic Box */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-white flex items-center space-x-2">
            <span>Creem Gateway Status</span>
          </h3>
          <Badge variant={billingConfig?.isConfigured ? 'success' : 'warning'}>
            {billingConfig?.isConfigured ? 'Gateway Active' : 'Config Required'}
          </Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 sm:gap-4 text-xs font-mono">
          <div className="bg-slate-950 p-3 sm:p-3.5 rounded-xl border border-slate-800 min-w-0">
            <p className="text-slate-500 text-[10px]">Environment</p>
            <p className="text-white font-bold capitalize">{billingConfig?.environment || 'test'}</p>
          </div>
          <div className="bg-slate-950 p-3 sm:p-3.5 rounded-xl border border-slate-800 min-w-0">
            <p className="text-slate-500 text-[10px]">Starter ($19)</p>
            <p className="text-white truncate font-medium">{billingConfig?.plans?.STARTER?.productId || 'Not configured'}</p>
          </div>
          <div className="bg-slate-950 p-3 sm:p-3.5 rounded-xl border border-slate-800 min-w-0">
            <p className="text-slate-500 text-[10px]">Pro ($49)</p>
            <p className="text-white truncate font-medium">{billingConfig?.plans?.PRO?.productId || 'Not configured'}</p>
          </div>
          <div className="bg-slate-950 p-3 sm:p-3.5 rounded-xl border border-slate-800 min-w-0">
            <p className="text-slate-500 text-[10px]">Business ($99)</p>
            <p className="text-white truncate font-medium">{billingConfig?.plans?.BUSINESS?.productId || 'Not configured'}</p>
          </div>
        </div>
      </div>

      {/* Cancel Confirmation Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl p-5 sm:p-6 max-w-md w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center space-x-3 text-amber-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-bold text-white">Cancel Subscription?</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Your subscription will remain <strong>active until the end of your current billing period</strong> (
              {sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : 'next billing date'}). You will not be charged again.
            </p>
            <div className="flex flex-wrap sm:flex-nowrap justify-end gap-2 pt-4 border-t border-slate-800">
              <button
                onClick={() => setShowCancelModal(false)}
                disabled={cancelingLoading}
                className="w-full sm:w-auto px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition"
              >
                Keep Subscription
              </button>
              <button
                onClick={handleConfirmCancel}
                disabled={cancelingLoading}
                className="w-full sm:w-auto px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-rose-600/20 flex items-center justify-center space-x-1.5"
              >
                {cancelingLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm Cancellation</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
