import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { Bot, AlertCircle } from 'lucide-react';

export const AuthCallback: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      const errorParam = searchParams.get('error');
      if (errorParam) {
        setError(decodeURIComponent(errorParam));
        return;
      }

      const token = searchParams.get('token');
      const orgId = searchParams.get('orgId');
      const returnUrl = searchParams.get('returnUrl') || '/app';

      if (!token) {
        setError('No authentication token received from OAuth provider.');
        return;
      }

      try {
        api.setToken(token);
        if (orgId) {
          api.setOrgId(orgId);
        }
        await refreshProfile();
        navigate(returnUrl, { replace: true });
      } catch (err: any) {
        console.error('[AuthCallback] Failed to complete login:', err);
        setError(err.message || 'Failed to initialize session. Please try logging in again.');
      }
    };

    handleCallback();
  }, [searchParams, navigate, refreshProfile]);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full bg-slate-900 border border-rose-500/20 rounded-2xl p-8 text-center space-y-4 shadow-xl">
          <div className="w-12 h-12 rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-white">Authentication Failed</h2>
          <p className="text-sm text-rose-300">{error}</p>
          <div className="pt-4">
            <button
              onClick={() => navigate('/login', { replace: true })}
              className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-semibold text-sm transition"
            >
              Return to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center px-4">
      <div className="text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
          <Bot className="w-7 h-7 text-slate-950 stroke-[2.5]" />
        </div>
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <h2 className="text-lg font-semibold text-white">Completing Google Sign In...</h2>
        <p className="text-xs text-slate-400">Preparing your ONCEClic workspace</p>
      </div>
    </div>
  );
};
