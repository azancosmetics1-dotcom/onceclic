import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';

declare global {
  interface Window {
    Paddle?: any;
  }
}

export const BillingPage: React.FC = () => {
  const { organization, user } = useAuth();
  const [billingStatus, setBillingStatus] = useState<any>(null);
  const [billingConfig, setBillingConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutOpening, setCheckoutOpening] = useState(false);

  const loadBilling = async () => {
    try {
      const [status, config] = await Promise.all([
        api.getBillingStatus(),
        api.getBillingConfig().catch(() => null),
      ]);
      setBillingStatus(status);
      setBillingConfig(config);
    } catch (err) {
      console.error('[Billing] Failed to load:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBilling();
  }, []);

  const handlePaddleCheckout = () => {
    if (!billingConfig?.isConfigured) {
      alert(
        'Paddle is not configured yet on the backend. Please set PADDLE_API_KEY, PADDLE_CLIENT_TOKEN, PADDLE_WEBHOOK_SECRET, and PADDLE_PRICE_ID in your server environment.'
      );
      return;
    }

    setCheckoutOpening(true);

    if (window.Paddle) {
      try {
        window.Paddle.Environment.set(billingConfig.environment || 'sandbox');
        window.Paddle.Initialize({
          token: billingConfig.clientToken,
        });

        window.Paddle.Checkout.open({
          items: [{ priceId: billingConfig.priceId, quantity: 1 }],
          customer: { email: user?.email },
          customData: { organization_id: organization?.id },
          settings: {
            displayMode: 'overlay',
            theme: 'dark',
            successUrl: `${window.location.origin}/app/billing?checkout=success`,
          },
        });
      } catch (err) {
        console.error('[Paddle Checkout] Error:', err);
        alert('Failed to initialize Paddle Checkout modal.');
      } finally {
        setCheckoutOpening(false);
      }
    } else {
      alert('Paddle.js script is not loaded in the browser. Please check your internet connection.');
      setCheckoutOpening(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const sub: Subscription | null = billingStatus?.subscription;
  const isTrial = sub?.status === SubscriptionStatus.TRIALING;
  const isActive = sub?.status === SubscriptionStatus.ACTIVE;
  const isExpired = sub?.status === SubscriptionStatus.EXPIRED || sub?.status === SubscriptionStatus.CANCELED;

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-white flex items-center space-x-2">
          <CreditCard className="w-6 h-6 text-emerald-400" />
          <span>Billing & Subscription</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Manage your plan, billing cycle, and Paddle merchant-of-record integration.
        </p>
      </div>

      {/* Plan Status Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-3">
            <div className="flex items-center space-x-3">
              <h2 className="text-xl font-black text-white">ONCEClic Pro</h2>
              <Badge
                variant={
                  isActive
                    ? 'success'
                    : isTrial
                    ? 'brand'
                    : isExpired
                    ? 'danger'
                    : 'warning'
                }
              >
                {sub?.status || 'TRIALING'}
              </Badge>
            </div>

            <div className="flex items-baseline space-x-2">
              <span className="text-3xl font-black text-white">$49</span>
              <span className="text-xs text-slate-400">/ month recurring</span>
            </div>

            <div className="text-xs text-slate-300 space-y-1">
              {isTrial && (
                <p className="flex items-center space-x-1.5 text-amber-400 font-semibold">
                  <Clock className="w-4 h-4 shrink-0" />
                  <span>
                    7-Day Free Trial: {billingStatus?.daysRemainingInTrial || 0} days remaining (Ends{' '}
                    {sub?.trialEndsAt ? new Date(sub.trialEndsAt).toLocaleDateString() : 'soon'})
                  </span>
                </p>
              )}

              {isActive && (
                <p className="flex items-center space-x-1.5 text-emerald-400 font-semibold">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    Subscription active &bull; Next billing date:{' '}
                    {sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : 'N/A'}
                  </span>
                </p>
              )}

              {isExpired && (
                <p className="flex items-center space-x-1.5 text-rose-400 font-semibold">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Trial expired. Upgrade now to reactivate AI features.</span>
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col space-y-3 shrink-0">
            {!isActive && (
              <button
                onClick={handlePaddleCheckout}
                disabled={checkoutOpening}
                className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition shadow-lg shadow-emerald-500/25 flex items-center justify-center space-x-2"
              >
                <Zap className="w-4 h-4" />
                <span>Upgrade to Pro ($49/mo)</span>
              </button>
            )}

            <div className="flex items-center space-x-1.5 text-[11px] text-slate-400 justify-center">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Paddle Merchant of Record</span>
            </div>
          </div>
        </div>
      </div>

      {/* Paddle Integration Configuration Diagnostic */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center space-x-2">
          <span>Paddle Gateway Status</span>
          <Badge variant={billingConfig?.isConfigured ? 'success' : 'warning'}>
            {billingConfig?.isConfigured ? 'Configured' : 'Billing Setup Required'}
          </Badge>
        </h3>

        {!billingConfig?.isConfigured ? (
          <div className="text-xs text-slate-400 bg-slate-950 border border-slate-850 rounded-xl p-4 space-y-2">
            <p className="text-amber-300 font-semibold">
              Paddle environment variables are not yet configured on the server.
            </p>
            <p>
              To process live or sandbox payments, set the following in your server <code className="text-emerald-400">.env</code>:
            </p>
            <ul className="list-disc list-inside space-y-1 font-mono text-[11px] text-slate-300">
              <li>PADDLE_API_KEY=...</li>
              <li>PADDLE_CLIENT_TOKEN=...</li>
              <li>PADDLE_WEBHOOK_SECRET=...</li>
              <li>PADDLE_PRICE_ID=...</li>
            </ul>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs font-mono">
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
              <p className="text-slate-500">Environment</p>
              <p className="text-white font-bold capitalize">{billingConfig.environment}</p>
            </div>
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
              <p className="text-slate-500">Price ID</p>
              <p className="text-white truncate">{billingConfig.priceId}</p>
            </div>
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
              <p className="text-slate-500">Webhook Signature Verification</p>
              <p className="text-emerald-400 font-bold">HMAC-SHA256 Active</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
