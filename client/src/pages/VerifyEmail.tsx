import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import { Mail, CheckCircle2, AlertTriangle, XCircle, ArrowRight, RefreshCw, Sparkles } from 'lucide-react';

type VerificationState = 'loading' | 'waiting' | 'success' | 'expired' | 'invalid';

export const VerifyEmail: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  const emailParam = searchParams.get('email') || '';

  const [state, setState] = useState<VerificationState>(token ? 'loading' : 'waiting');
  const [email, setEmail] = useState(emailParam);
  const [message, setMessage] = useState('');
  const [resending, setResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!token) {
      setState('waiting');
      return;
    }

    const performVerification = async () => {
      try {
        const res = await api.verifyEmail(token);
        setMessage(res.message || 'Email verified successfully.');
        setState('success');
      } catch (err: any) {
        if (err.code === 'TOKEN_EXPIRED') {
          setState('expired');
          setMessage(err.message || 'This verification link has expired.');
        } else {
          setState('invalid');
          setMessage(err.message || 'This verification link is invalid or has already been used.');
        }
      }
    };

    performVerification();
  }, [token]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setResending(true);
    setResendStatus(null);
    try {
      const res = await api.resendVerification(email);
      setResendStatus({
        type: 'success',
        text: res.message || 'A new verification link has been sent to your email address.',
      });
    } catch (err: any) {
      setResendStatus({
        type: 'error',
        text: err.message || 'Failed to send verification email. Please try again.',
      });
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Background glowing gradients */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 left-10 w-80 h-80 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <Link to="/" className="flex items-center justify-center gap-2 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className="text-2xl font-bold text-white tracking-tight">
            ONCE<span className="text-emerald-400">Clic</span>
          </span>
        </Link>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="bg-slate-900/90 backdrop-blur-xl py-8 px-6 shadow-2xl border border-slate-800 rounded-2xl sm:px-10">
          {/* 1. Loading State */}
          {state === 'loading' && (
            <div className="text-center py-6">
              <div className="w-14 h-14 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mx-auto mb-4" />
              <h2 className="text-xl font-bold text-white mb-2">Verifying your email...</h2>
              <p className="text-slate-400 text-sm">Please wait while we confirm your account.</p>
            </div>
          )}

          {/* 2. Waiting State */}
          {state === 'waiting' && (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto mb-5 text-emerald-400">
                <Mail className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Verify your email</h2>
              <p className="text-slate-300 text-sm leading-relaxed mb-6">
                Check your email to verify your ONCEClic account. Click the link in the message to activate your account and access your AI Receptionist.
              </p>

              <form onSubmit={handleResend} className="space-y-4 pt-4 border-t border-slate-800">
                <div className="text-left">
                  <label className="block text-xs font-semibold text-slate-400 mb-1">
                    Didn't receive the email? Enter your email address to resend:
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                {resendStatus && (
                  <div
                    className={`p-3 rounded-lg text-xs leading-relaxed ${
                      resendStatus.type === 'success'
                        ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-300'
                        : 'bg-red-950/60 border border-red-800 text-red-300'
                    }`}
                  >
                    {resendStatus.text}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={resending}
                  className="w-full inline-flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-750 text-slate-200 hover:text-white border border-slate-700 font-medium py-2.5 px-4 rounded-lg transition text-sm disabled:opacity-50"
                >
                  {resending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Resend verification email
                </button>
              </form>

              <div className="mt-6 pt-4 text-center">
                <Link to="/login" className="text-sm text-emerald-400 hover:text-emerald-300 font-medium">
                  Return to login
                </Link>
              </div>
            </div>
          )}

          {/* 3. Success State */}
          {state === 'success' && (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto mb-5 text-emerald-400">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Email verified successfully!</h2>
              <p className="text-slate-300 text-sm leading-relaxed mb-6">
                Your ONCEClic account is now verified. You can now access your dashboard and configure your AI Receptionist.
              </p>

              <button
                onClick={() => navigate('/login')}
                className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-medium py-3 px-4 rounded-xl shadow-lg shadow-emerald-500/25 transition text-sm"
              >
                Continue to ONCEClic
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* 4. Expired State */}
          {state === 'expired' && (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-center mx-auto mb-5 text-amber-400">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Link Expired</h2>
              <p className="text-slate-300 text-sm leading-relaxed mb-6">
                This verification link has expired for your security. Please request a new verification email below.
              </p>

              <form onSubmit={handleResend} className="space-y-4">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your account email"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />

                {resendStatus && (
                  <div
                    className={`p-3 rounded-lg text-xs leading-relaxed ${
                      resendStatus.type === 'success'
                        ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-300'
                        : 'bg-red-950/60 border border-red-800 text-red-300'
                    }`}
                  >
                    {resendStatus.text}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={resending}
                  className="w-full inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm disabled:opacity-50"
                >
                  {resending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Send new verification email
                </button>
              </form>

              <div className="mt-6 pt-4 border-t border-slate-800 text-center">
                <Link to="/login" className="text-sm text-emerald-400 hover:text-emerald-300 font-medium">
                  Return to login
                </Link>
              </div>
            </div>
          )}

          {/* 5. Invalid State */}
          {state === 'invalid' && (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-center mx-auto mb-5 text-red-400">
                <XCircle className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Invalid Verification Link</h2>
              <p className="text-slate-300 text-sm leading-relaxed mb-6">
                This verification link is invalid or has already been used. You can request a fresh verification link or try logging in.
              </p>

              <form onSubmit={handleResend} className="space-y-4">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your account email"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />

                {resendStatus && (
                  <div
                    className={`p-3 rounded-lg text-xs leading-relaxed ${
                      resendStatus.type === 'success'
                        ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-300'
                        : 'bg-red-950/60 border border-red-800 text-red-300'
                    }`}
                  >
                    {resendStatus.text}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={resending}
                  className="w-full inline-flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-750 text-slate-200 hover:text-white border border-slate-700 font-medium py-2.5 px-4 rounded-lg transition text-sm disabled:opacity-50"
                >
                  {resending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Send fresh verification email
                </button>
              </form>

              <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between text-sm">
                <Link to="/login" className="text-emerald-400 hover:text-emerald-300 font-medium">
                  Go to login
                </Link>
                <Link to="/signup" className="text-slate-400 hover:text-slate-300">
                  Create new account
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
