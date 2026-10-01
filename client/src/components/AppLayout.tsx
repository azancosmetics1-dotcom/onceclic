import React, { useEffect, useState } from 'react';
import { Outlet, Link, Navigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { AlertTriangle, Clock, CreditCard, Menu, Bot, ExternalLink } from 'lucide-react';

export const AppLayout: React.FC = () => {
  const { organization, loading } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [billingInfo, setBillingInfo] = useState<{
    isPro: boolean;
    daysRemainingInTrial: number;
    subscription: any;
  } | null>(null);

  useEffect(() => {
    if (organization?.id) {
      api
        .getBillingStatus()
        .then((res) => setBillingInfo(res))
        .catch((err) => console.warn('[AppLayout] Billing status fetch failed:', err));
    }
  }, [organization?.id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // Redirect to onboarding if business industry & knowledge have not been configured
  if (organization && (organization.businessType === 'ONBOARDING_REQUIRED' || !organization.businessType)) {
    return <Navigate to="/onboarding" replace />;
  }

  const showTrialBanner = billingInfo && !billingInfo.isPro;
  const isTrialActive = billingInfo?.subscription?.status === 'TRIALING' && (billingInfo?.daysRemainingInTrial || 0) > 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col lg:flex-row">
      {/* Sidebar with Drawer Support */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-screen min-w-0 lg:ml-64 w-full">
        {/* Mobile Header (Hidden on Desktop) */}
        <header className="lg:hidden h-16 px-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 hover:text-white transition focus:outline-none"
              aria-label="Open Navigation Menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <Link to="/app" className="flex items-center space-x-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-sm">
                <Bot className="w-4 h-4 text-slate-950 stroke-[2.5]" />
              </div>
              <span className="text-base font-black tracking-tight text-white">
                ONCE<span className="text-emerald-400">Clic</span>
              </span>
            </Link>
          </div>

          {organization?.slug && (
            <a
              href={`/chat/${organization.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center space-x-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition"
            >
              <span>Live Chat</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </header>

        {/* Trial & Subscription Notification Banner */}
        {showTrialBanner && (
          <div className="bg-gradient-to-r from-amber-500/20 via-amber-600/15 to-transparent border-b border-amber-500/30 px-4 sm:px-6 py-2.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
            <div className="flex items-start sm:items-center space-x-2 text-xs font-medium text-amber-300 min-w-0">
              {isTrialActive ? (
                billingInfo?.daysRemainingInTrial === 1 ? (
                  <>
                    <Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
                    <span>
                      <strong>Your free trial ends tomorrow.</strong> Upgrade to Pro for $19/month to keep your AI receptionist running.
                    </span>
                  </>
                ) : (
                  <>
                    <Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
                    <span>
                      You are currently on your <strong>7-Day Free Trial</strong> ({billingInfo?.daysRemainingInTrial} days remaining &bull; No credit card required).
                    </span>
                  </>
                )
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5 sm:mt-0" />
                  <span className="text-rose-300">
                    <strong>Your free trial has ended.</strong> Upgrade to ONCEClic Pro for $19/month to continue using your AI receptionist.
                  </span>
                </>
              )}
            </div>
            <Link
              to="/app/billing"
              className="inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-amber-400 text-slate-950 hover:bg-amber-300 transition shadow-sm shrink-0"
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>Upgrade to Pro ($19/mo)</span>
            </Link>
          </div>
        )}

        {/* Page Content View */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
