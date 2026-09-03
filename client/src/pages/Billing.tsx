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
        text: 'Paddle Sandbox Client Token is missing or invalid. Please configure VITE_PADDLE_CLIENT_TOKEN on Netlify and PADDLE_CLIENT_TOKEN on Railway.',
      });
      return;
    }

    if (!priceId || priceId.includes('placeholder')) {
      setActionMessage({
        type: 'error',
        text: 'Paddle Price ID is missing or invalid. Please configure VITE_PADDLE_PRICE_ID on Netlify and PADDLE_PRICE_ID on Railway.',
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
                text: `Paddle Checkout notice: ${event.data?.message || event.data?.error || event.name}. Please check domain approval & default payment link in Paddle Sandbox.`,
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
  const isCanceled = sub?.status === SubscriptionStatus.CANCELED || sub?.status === SubscriptionStatus.EXPIRED;
  const isCancelScheduled = sub?.cancelAtPeriodEnd && (isActive || isTrial);

  const proFeatures = [
    '24/7 AI Receptionist & Real-Time Website Chatbot',
    'Automated Business Email Answering & Smart Lead Capture',
    'Real-Time Appointment Scheduling & Double-Booking Prevention',
    'Google Calendar 2-Way Sync & Slot Collision Checks',
    'Custom Knowledge Base & Anti-Hallucination Guardrails',
    'Multi-Tenant Team Member Roles (Owner, Manager, Staff)',
  ];

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-black text-white flex items-center space-x-2.5">
          <CreditCard className="w-6 h-6 text-emerald-400" />
          <span>Billing & Subscription</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Manage your ONCEClic Pro plan, billing cycle, and Paddle merchant-of-record subscription.
        </p>
      </div>

      {/* Action Notification Banner */}
      {actionMessage && (
        <div
          className={`p-4 rounded-2xl border text-xs flex items-center justify-between ${
            actionMessage.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
          }`}
        >
          <div className="flex items-center space-x-2">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            className="text-slate-400 hover:text-white ml-3 text-xs font-bold"
          >
            &times;
          </button>
        </div>
      )}

      {/* Main Subscription Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <h2 className="text-2xl font-black text-white">ONCEClic Pro</h2>
              {isCancelScheduled ? (
                <Badge variant="warning">Canceling at Period End</Badge>
              ) : isActive ? (
                <Badge variant="success">Active</Badge>
              ) : isTrial ? (
                <Badge variant="brand">7-Day Trial ($1)</Badge>
              ) : isPastDue ? (
                <Badge variant="warning">Past Due</Badge>
              ) : (
                <Badge variant="danger">Canceled / Inactive</Badge>
              )}
            </div>

            {/* Pricing Details */}
            <div className="space-y-1">
              <div className="flex items-baseline space-x-2">
                <span className="text-4xl font-black text-white">$49</span>
                <span className="text-sm font-medium text-slate-400">/ month recurring</span>
              </div>
              <p className="text-xs font-semibold text-emerald-400">
                $1 for your first 7 days &bull; Then $49/month
              </p>
            </div>

            {/* Status Information Box */}
            <div className="text-xs text-slate-300 space-y-1.5 pt-2">
              {isCancelScheduled && (
                <p className="flex items-center space-x-2 text-amber-400 font-semibold bg-amber-950/30 border border-amber-500/20 p-2.5 rounded-xl">
                  <Clock className="w-4 h-4 shrink-0" />
                  <span>
                    Cancellation scheduled for{' '}
                    {sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : 'period end'}.
                    Full Pro access remains active until that date.
                  </span>
                </p>
              )}

              {isActive && !isCancelScheduled && (
                <p className="flex items-center space-x-1.5 text-emerald-400 font-semibold">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    Subscription active &bull; Renews on{' '}
                    {sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : 'next billing cycle'}
                  </span>
                </p>
              )}

              {isTrial && !sub?.paddleSubscriptionId && (
                <p className="flex items-center space-x-1.5 text-amber-400 font-semibold">
                  <Clock className="w-4 h-4 shrink-0" />
                  <span>
                    7-Day Trial: {billingStatus?.daysRemainingInTrial || 0} days remaining (Ends{' '}
                    {sub?.trialEndsAt ? new Date(sub.trialEndsAt).toLocaleDateString() : 'soon'}).
                    Upgrade now to activate full recurring Pro.
                  </span>
                </p>
              )}

              {isCanceled && (
                <p className="flex items-center space-x-1.5 text-rose-400 font-semibold">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Subscription is inactive. Start Pro to reactivate your AI receptionist.</span>
                </p>
              )}

              {isPastDue && (
                <p className="flex items-center space-x-1.5 text-amber-400 font-semibold">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Payment past due. Please update your payment method via the customer portal.</span>
                </p>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row lg:flex-col gap-3 shrink-0">
            {(!isActive || isCanceled) && (
              <button
                onClick={handlePaddleCheckout}
                disabled={checkoutOpening}
                className="px-8 py-3.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs rounded-xl transition shadow-lg shadow-emerald-500/25 flex items-center justify-center space-x-2"
              >
                <Zap className="w-4 h-4" />
                <span>{isCanceled ? 'Reactivate Pro ($1 / 7 Days)' : 'Start Pro ($1 for 7 Days)'}</span>
              </button>
            )}

            {sub?.paddleCustomerId && (
              <button
                onClick={handleOpenCustomerPortal}
                disabled={portalLoading}
                className="px-6 py-3 bg-slate-800 hover:bg-slate-750 text-white font-bold text-xs rounded-xl border border-slate-700 transition flex items-center justify-center space-x-2"
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
                className="px-4 py-2.5 bg-slate-950 hover:bg-rose-950/40 text-slate-400 hover:text-rose-300 font-semibold text-xs rounded-xl border border-slate-800 transition flex items-center justify-center space-x-1.5"
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
        <div className="border-t border-slate-800 mt-8 pt-6">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
            Included in ONCEClic Pro:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-300">
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
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center space-x-2">
            <span>Paddle Sandbox Gateway Status</span>
          </h3>
          <Badge variant={billingConfig?.isConfigured ? 'success' : 'warning'}>
            {billingConfig?.isConfigured ? 'Sandbox Active' : 'Config Required'}
          </Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
            <p className="text-slate-500 text-[10px]">Environment</p>
            <p className="text-white font-bold capitalize">{billingConfig?.environment || 'sandbox'}</p>
          </div>
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
            <p className="text-slate-500 text-[10px]">Price ID</p>
            <p className="text-white truncate font-medium">{billingConfig?.priceId || 'pri_01m187782qdqsvcsd19jmb8v2h'}</p>
          </div>
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
            <p className="text-slate-500 text-[10px]">Webhook Verification</p>
            <p className="text-emerald-400 font-bold">HMAC-SHA256 Idempotent</p>
          </div>
        </div>
      </div>

      {/* Cancel Confirmation Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center space-x-3 text-amber-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-bold text-white">Cancel Subscription?</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Your subscription will remain <strong>active until the end of your current billing period</strong> (
              {sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : 'next billing date'}). You will not be charged again.
            </p>
            <div className="flex justify-end space-x-3 pt-4 border-t border-slate-800">
              <button
                onClick={() => setShowCancelModal(false)}
                disabled={cancelingLoading}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition"
              >
                Keep Subscription
              </button>
              <button
                onClick={handleConfirmCancel}
                disabled={cancelingLoading}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-rose-600/20 flex items-center space-x-1.5"
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
