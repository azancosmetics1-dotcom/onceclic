import React, { useEffect, useState } from 'react';
import { Outlet, Link } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { AlertTriangle, Clock, CreditCard } from 'lucide-react';

export const AppLayout: React.FC = () => {
  const { organization, loading } = useAuth();
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

  const showTrialBanner = billingInfo && !billingInfo.isPro;
  const isTrialActive = billingInfo?.subscription?.status === 'TRIALING' && (billingInfo?.daysRemainingInTrial || 0) > 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex-1 ml-64 flex flex-col min-h-screen">
        {/* Trial & Subscription Notification Banner */}
        {showTrialBanner && (
          <div className="bg-gradient-to-r from-amber-500/20 via-amber-600/15 to-transparent border-b border-amber-500/30 px-6 py-2.5 flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs font-medium text-amber-300">
              {isTrialActive ? (
                <>
                  <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    You are currently on your <strong>7-Day Trial</strong> ({billingInfo?.daysRemainingInTrial} days remaining).
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span className="text-rose-300">
                    Your trial has expired. AI Receptionist features are currently paused.
                  </span>
                </>
              )}
            </div>
            <Link
              to="/app/billing"
              className="inline-flex items-center space-x-1 px-3 py-1 text-xs font-semibold rounded-md bg-amber-400 text-slate-950 hover:bg-amber-300 transition shadow-sm"
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>Start Pro ($1 for 7 Days)</span>
            </Link>
          </div>
        )}

        {/* Page Content View */}
        <main className="flex-1 p-8 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
