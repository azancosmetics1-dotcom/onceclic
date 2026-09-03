import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { CheckCircle2, Sparkles, ArrowRight, Bot, ShieldCheck, Zap } from 'lucide-react';

export const Welcome: React.FC = () => {
  const { user, organization, refreshProfile } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(true);
  const [billingInfo, setBillingInfo] = useState<any>(null);

  useEffect(() => {
    let isMounted = true;
    const syncState = async () => {
      try {
        await refreshProfile();
        const status = await api.getBillingStatus().catch(() => null);
        if (isMounted) {
          setBillingInfo(status);
        }
      } catch (err) {
        console.warn('[Welcome] Sync billing status notice:', err);
      } finally {
        if (isMounted) {
          setSyncing(false);
        }
      }
    };

    syncState();
    return () => {
      isMounted = false;
    };
  }, [refreshProfile]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-xl w-full mx-auto text-center space-y-8">
        {/* Animated Brand Header */}
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-3xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shadow-xl shadow-emerald-500/10">
            <CheckCircle2 className="w-10 h-10" />
          </div>
        </div>

        <div className="space-y-3">
          <div className="inline-flex items-center space-x-2 bg-emerald-500/10 border border-emerald-500/20 px-3.5 py-1 rounded-full text-xs font-semibold text-emerald-400">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Subscription Activated</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            Welcome to ONCEClic Pro!
          </h1>
          <p className="text-sm text-slate-300 max-w-md mx-auto">
            Your 7-day trial ($1) is now active. Your AI Receptionist is ready to capture leads, book appointments, and answer questions 24/7.
          </p>
        </div>

        {/* Plan Summary Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 text-left shadow-2xl space-y-4">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">ONCEClic Pro</h3>
                <p className="text-xs text-slate-400">Merchant of Record: Paddle</p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
                Active Pro Plan
              </span>
            </div>
          </div>

          <div className="space-y-2 text-xs text-slate-300">
            <div className="flex justify-between">
              <span className="text-slate-400">Initial Trial Period:</span>
              <span className="font-semibold text-white">7 Days ($1.00)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Recurring Billing:</span>
              <span className="font-semibold text-white">$49.00 / month</span>
            </div>
            {user?.email && (
              <div className="flex justify-between">
                <span className="text-slate-400">Account Email:</span>
                <span className="font-semibold text-white">{user.email}</span>
              </div>
            )}
            {organization?.name && (
              <div className="flex justify-between">
                <span className="text-slate-400">Organization:</span>
                <span className="font-semibold text-white">{organization.name}</span>
              </div>
            )}
          </div>

          <div className="pt-2 text-[11px] text-slate-400 flex items-center justify-center space-x-1.5 border-t border-slate-800">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Encrypted & verified via Paddle Sandbox</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/app"
            className="w-full sm:w-auto px-8 py-3.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs rounded-xl transition shadow-lg shadow-emerald-500/20 flex items-center justify-center space-x-2"
          >
            <Zap className="w-4 h-4" />
            <span>Go to Dashboard</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            to="/app/ai-employee"
            className="w-full sm:w-auto px-6 py-3.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-200 font-bold text-xs rounded-xl transition flex items-center justify-center space-x-2"
          >
            <span>Customize AI Receptionist</span>
          </Link>
        </div>
      </div>
    </div>
  );
};
