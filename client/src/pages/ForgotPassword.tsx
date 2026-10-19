import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Bot, ArrowLeft, Send, AlertCircle, CheckCircle2 } from 'lucide-react';

export const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const trimmed = email.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!trimmed || !emailRegex.test(trimmed)) {
      setError('Please enter a valid email address.');
      return;
    }

    setLoading(true);

    try {
      const res = await api.forgotPassword(trimmed);
      setSuccessMessage(
        res.message || "If an account exists for that email, we've sent a password reset link. Please check your inbox."
      );
    } catch (err: any) {
      if (err.status === 429) {
        setError(err.message || 'Too many requests. Please wait a few minutes before trying again.');
      } else {
        // Defensive: even on network or other errors, if it's not rate-limited, provide a safe response
        setError(err.message || 'Failed to request password reset. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-8 sm:py-12 px-4 sm:px-6 lg:px-8 min-w-0">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center min-w-0">
        <Link to="/" className="inline-flex items-center space-x-2.5 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
            <Bot className="w-6 h-6 text-slate-950 stroke-[2.5]" />
          </div>
          <span className="text-2xl font-black tracking-tight text-white">
            ONCE<span className="text-emerald-400">Clic</span>
          </span>
        </Link>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">Forgot your password?</h1>
        <p className="mt-2 text-xs sm:text-sm text-slate-400 max-w-sm mx-auto leading-relaxed">
          Enter the email address associated with your ONCEClic account. We'll send you a secure link to reset your password.
        </p>
      </div>

      <div className="mt-6 sm:mt-8 sm:mx-auto sm:w-full sm:max-w-md min-w-0">
        <div className="bg-slate-900 border border-slate-800 py-6 sm:py-8 px-4 sm:px-10 shadow-xl rounded-2xl sm:rounded-3xl space-y-6 min-w-0">
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 flex items-start space-x-3 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successMessage ? (
            <div className="space-y-6">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex items-start space-x-3 text-xs text-emerald-300 leading-relaxed">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{successMessage}</span>
              </div>
              <p className="text-xs text-slate-400 text-center">
                Didn't receive the email? Check your spam folder or wait a few minutes before trying again.
              </p>
              <Link
                to="/login"
                className="w-full flex items-center justify-center space-x-2 py-3 px-4 border border-slate-700 hover:border-slate-600 rounded-xl text-sm font-semibold text-slate-200 bg-slate-800/80 hover:bg-slate-800 transition"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to Login</span>
              </Link>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Email address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center space-x-2 py-3 px-4 border border-transparent rounded-xl shadow-md text-sm font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 focus:outline-none disabled:opacity-50 transition"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Send Reset Link</span>
                    <Send className="w-4 h-4" />
                  </>
                )}
              </button>

              <div className="pt-2 text-center">
                <Link
                  to="/login"
                  className="inline-flex items-center space-x-1.5 text-xs font-medium text-slate-400 hover:text-emerald-400 transition"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Login</span>
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
