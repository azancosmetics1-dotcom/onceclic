import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Subscription, SubscriptionStatus } from '@onceclic/shared';
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

declare global {
  interface Window {
    Paddle?: any;
    __paddle_initialized?: boolean;
  }
}

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

  // Initialize Paddle.js ONCE on mount or when config loads
  useEffect(() => {
    loadBilling().then((res) => {
      const token = res?.config?.clientToken || (import.meta as any).env?.VITE_PADDLE_CLIENT_TOKEN;
      const env = res?.config?.environment || (import.meta as any).env?.VITE_PADDLE_ENVIRONMENT || (import.meta as any).env?.VITE_PADDLE_ENV || 'sandbox';
      if (token && window.Paddle && !window.__paddle_initialized) {
        try {
          window.Paddle.Environment.set(env);
          window.Paddle.Initialize({
            token,
            eventCallback: (event: any) => {
              if (event.name === 'checkout.completed') {
                console.log('[Paddle.js] Checkout completed event received');
                loadBilling();
              } else if (event.name === 'checkout.error' || event.name === 'checkout.payment-error') {
                console.warn('[Paddle.js] Checkout event notice:', event.name, event.data?.error || event.data?.code || '');
              }
            },
          });
          window.__paddle_initialized = true;
          console.log('[Paddle.js] Successfully initialized in', env, 'mode');
        } catch (initErr) {
          console.warn('[Paddle.js] Initialization notice:', initErr);
        }
      }
    });
  }, [loadBilling]);

  // Handle checkout=success redirect acknowledgment
  useEffect(() => {
    if (checkoutSuccess) {
      setActionMessage({
        type: 'success',
        text: 'Payment received! Your ONCEClic Pro subscription is being synchronized with Paddle.',
      });
      loadBilling();
      // Remove query parameter without reloading
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('checkout');
      setSearchParams(newParams, { replace: true });
    }
  }, [checkoutSuccess, loadBilling, searchParams, setSearchParams]);

  const handlePaddleCheckout = () => {
    const clientToken = billingConfig?.clientToken || (import.meta as any).env?.VITE_PADDLE_CLIENT_TOKEN;
    const environment = billingConfig?.environment || (import.meta as any).env?.VITE_PADDLE_ENVIRONMENT || (import.meta as any).env?.VITE_PADDLE_ENV || 'sandbox';
    const priceId = billingConfig?.priceId || (import.meta as any).env?.VITE_PADDLE_PRICE_ID;

    if (!clientToken || clientToken.includes('placeholder')) {
      setActionMessage({
        type: 'error',
        text: 'Paddle Client Token is missing or invalid. Please configure VITE_PADDLE_CLIENT_TOKEN or check Paddle settings.',
      });
      return;
    }

    if (!priceId || priceId.includes('placeholder')) {
      setActionMessage({
        type: 'error',
        text: 'Paddle Price ID is missing or invalid. Please configure VITE_PADDLE_PRICE_ID or check Paddle settings.',
      });
      return;
    }

    if (!window.Paddle) {
      setActionMessage({
        type: 'error',
        text: 'Paddle.js is loading or blocked by your browser. Please refresh the page and try again.',
      });
      return;
    }

    setCheckoutOpening(true);
    setActionMessage(null);

    try {
      // Ensure Paddle is initialized once
      if (!window.__paddle_initialized) {
        window.Paddle.Environment.set(environment);
        window.Paddle.Initialize({
          token: clientToken,
          eventCallback: (event: any) => {
            if (event.name === 'checkout.completed') {
              loadBilling();
            } else if (event.name === 'checkout.error' || event.name === 'checkout.payment-error') {
              console.warn('[Paddle.js] Checkout event notice:', event.name, event.data?.error || event.data?.code || '');
              setActionMessage({
                type: 'error',
                text: `Paddle Checkout notice: ${event.data?.message || event.data?.error || event.name}. Please check domain approval & payment link in Paddle dashboard.`,
              });
            }
          },
        });
        window.__paddle_initialized = true;
      }

      const successUrl = `${window.location.origin}/welcome?checkout=success`;

      window.Paddle.Checkout.open({
        items: [
          {
            priceId: priceId,
            quantity: 1,
          },
        ],
        customer: user?.email ? { email: user.email } : undefined,
        customData: organization?.id ? { organization_id: organization.id } : undefined,
        settings: {
          displayMode: 'overlay',
          theme: 'dark',
          variant: 'one-page',
          allowLogout: !user?.email,
          successUrl: successUrl,
        },
      });
    } catch (err: any) {
      console.error('[Paddle Checkout] Error opening modal:', err);
      setActionMessage({
        type: 'error',
        text: err?.message || 'Failed to open Paddle Checkout modal. Please check your connection.',
      });
    } finally {
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
        text: err?.message || 'Unable to open Paddle Customer Portal. Please try again later.',
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
  const isExpired = sub?.status === SubscriptionStatus.EXPIRED || (isTrial && !sub?.paddleSubscriptionId && (billingStatus?.daysRemainingInTrial || 0) <= 0);
  const isCanceled = sub?.status === SubscriptionStatus.CANCELED;
  const isCancelScheduled = sub?.cancelAtPeriodEnd && (isActive || isTrial);
  const isTrialEndingSoon = isTrial && !sub?.paddleSubscriptionId && billingStatus?.daysRemainingInTrial === 1;

  const proFeatures = [
    '24/7 AI Receptionist & Real-Time Website Chatbot',
    'Automated Business Email Answering & Smart Lead Capture',
    'Real-Time Appointment Scheduling & Double-Booking Prevention',
    'Google Calendar 2-Way Sync & Slot Collision Checks',
    'Custom Knowledge Base & Anti-Hallucination Guardrails',
    'Multi-Tenant Team Member Roles (Owner, Manager, Staff)',
  ];

  return (
    <div className="space-y-8 max-w-5xl w-full min-w-0">
      {/* Page Header */}
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2.5 flex-wrap">
          <CreditCard className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-400 flex-shrink-0" />
          <span>Billing & Subscription</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Manage your ONCEClic Pro plan, billing cycle, and Paddle merchant-of-record subscription.
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

      {/* Main Subscription Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl p-5 sm:p-8 shadow-2xl relative overflow-hidden min-w-0">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 sm:gap-8">
          <div className="space-y-4 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
              <h2 className="text-xl sm:text-2xl font-black text-white">
                {isTrial && !sub?.paddleSubscriptionId ? '7-Day Free Trial' : 'ONCEClic Pro'}
              </h2>
              {isCancelScheduled ? (
                <Badge variant="warning">Canceling at Period End</Badge>
              ) : isActive && sub?.paddleSubscriptionId ? (
                <Badge variant="success">Pro Active</Badge>
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
                <span className="text-3xl sm:text-4xl font-black text-white">$19</span>
                <span className="text-xs sm:text-sm font-medium text-slate-400">/ month recurring</span>
              </div>
              <p className="text-xs font-semibold text-emerald-400">
                {isTrial && !sub?.paddleSubscriptionId
                  ? '7-Day Free Trial • No credit card required • $19/month after trial'
                  : 'ONCEClic Pro • $19/month • Cancel anytime'}
              </p>
            </div>

            {/* AI Receptionist Status Box (Customer-Safe) */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 max-w-md space-y-2 min-w-0">
              <div className="flex items-center justify-between text-xs gap-2 flex-wrap">
                <span className="text-slate-400 font-medium flex items-center space-x-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>AI Receptionist Status</span>
                </span>
                <span className="font-bold text-white">
                  {billingStatus?.aiUsageStatus === 'LIMIT_REACHED' ? (
                    <span className="text-rose-400">Limit Reached</span>
                  ) : billingStatus?.aiUsageStatus === 'LIMITED' ? (
                    <span className="text-amber-400">Trial Allowance</span>
                  ) : (
                    <span className="text-emerald-400">Active</span>
                  )}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {billingStatus?.aiUsageStatus === 'LIMIT_REACHED'
                  ? "You've reached the AI usage limit for your free trial. Upgrade to Pro to continue using your AI receptionist."
                  : isTrial && !sub?.paddleSubscriptionId
                  ? 'Limited AI usage during your free trial. Upgrade to Pro for expanded AI usage.'
                  : 'Pro includes expanded AI usage subject to reasonable-use limits.'}
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
                    Full Pro access remains active until that date.
                  </span>
                </p>
              )}

              {isActive && !isCancelScheduled && sub?.paddleSubscriptionId && (
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
                    Your free trial ends tomorrow. Upgrade to Pro for $19/month to continue using ONCEClic.
                  </span>
                </p>
              )}

              {isTrial && !sub?.paddleSubscriptionId && !isTrialEndingSoon && (
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
                  <span>Your free trial has ended. Upgrade to ONCEClic Pro for $19/month to continue using your AI receptionist.</span>
                </p>
              )}

              {isCanceled && !isExpired && (
                <p className="flex items-start sm:items-center gap-1.5 text-rose-400 font-semibold">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0" />
                  <span>Subscription canceled. Upgrade to ONCEClic Pro ($19/month) to continue using your AI receptionist.</span>
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
            {(!isActive || isExpired || isCanceled || (isTrial && !sub?.paddleSubscriptionId)) && (
              <button
                onClick={handlePaddleCheckout}
                disabled={checkoutOpening}
                className="w-full px-6 sm:px-8 py-3.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs sm:text-sm rounded-xl transition shadow-lg shadow-emerald-500/25 flex items-center justify-center space-x-2"
              >
                <Zap className="w-4 h-4" />
                <span>Upgrade to Pro — $19/month</span>
              </button>
            )}

            {sub?.paddleCustomerId && (
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
                <span>Paddle Customer Portal</span>
              </button>
            )}

            {isActive && !isCancelScheduled && sub?.paddleSubscriptionId && (
              <button
                onClick={() => setShowCancelModal(true)}
                className="w-full px-4 py-2.5 bg-slate-950 hover:bg-rose-950/40 text-slate-400 hover:text-rose-300 font-semibold text-xs rounded-xl border border-slate-800 transition flex items-center justify-center space-x-1.5"
              >
                <span>Cancel Subscription</span>
              </button>
            )}

            <div className="flex items-center space-x-1.5 text-[11px] text-slate-400 justify-center pt-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Paddle Merchant of Record</span>
            </div>
          </div>
        </div>

        {/* Pro Plan Features List */}
        <div className="border-t border-slate-800 mt-8 pt-6 min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
            Included in ONCEClic Pro:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-300">
            {proFeatures.map((feat, i) => (
              <div key={i} className="flex items-start space-x-2.5">
                <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{feat}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Gateway & Environment Diagnostic Box */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-white flex items-center space-x-2">
            <span>Paddle Gateway Status</span>
          </h3>
          <Badge variant={billingConfig?.isConfigured ? 'success' : 'warning'}>
            {billingConfig?.isConfigured ? 'Gateway Active' : 'Config Required'}
          </Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 text-xs font-mono">
          <div className="bg-slate-950 p-3 sm:p-3.5 rounded-xl border border-slate-800 min-w-0">
            <p className="text-slate-500 text-[10px]">Environment</p>
            <p className="text-white font-bold capitalize">{billingConfig?.environment || 'Active'}</p>
          </div>
          <div className="bg-slate-950 p-3 sm:p-3.5 rounded-xl border border-slate-800 min-w-0">
            <p className="text-slate-500 text-[10px]">Price ID</p>
            <p className="text-white truncate font-medium">{billingConfig?.priceId || 'pri_01m2n4s5n0zvwgrgwjnhfdh0p3'}</p>
          </div>
          <div className="bg-slate-950 p-3 sm:p-3.5 rounded-xl border border-slate-800 min-w-0">
            <p className="text-slate-500 text-[10px]">Webhook Verification</p>
            <p className="text-emerald-400 font-bold">HMAC-SHA256 Idempotent</p>
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
