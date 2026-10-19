import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Bot, ArrowRight, AlertCircle, CheckCircle2, RotateCcw } from 'lucide-react';

export const ResetPassword: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!token.trim()) {
      setError('Missing or invalid reset token. Please request a new password reset link.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match. Please ensure both fields are identical.');
      return;
    }

    setLoading(true);

    try {
      await api.resetPassword(token.trim(), password);
      setSuccess(true);
    } catch (err: any) {
      setError(
        err.message || 'This password reset link is invalid or has expired. Please request a new link.'
      );
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
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">Create a new password</h1>
        <p className="mt-2 text-xs sm:text-sm text-slate-400 max-w-sm mx-auto">
          Please enter your new password below to regain secure access to your account.
        </p>
      </div>

      <div className="mt-6 sm:mt-8 sm:mx-auto sm:w-full sm:max-w-md min-w-0">
        <div className="bg-slate-900 border border-slate-800 py-6 sm:py-8 px-4 sm:px-10 shadow-xl rounded-2xl sm:rounded-3xl space-y-6 min-w-0">
          {!token.trim() && !success && (
            <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-4 space-y-3 text-xs text-amber-300">
              <div className="flex items-start space-x-3">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>No reset token was found in the link. Please request a fresh password reset link.</span>
              </div>
              <Link
                to="/forgot-password"
                className="inline-flex items-center space-x-1.5 font-semibold text-emerald-400 hover:text-emerald-300 underline"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Request password reset</span>
              </Link>
            </div>
          )}

          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 space-y-2 text-xs text-rose-300">
              <div className="flex items-start space-x-3">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
              <div className="pt-2 border-t border-rose-500/20">
                <Link
                  to="/forgot-password"
                  className="font-semibold text-emerald-400 hover:text-emerald-300 underline inline-flex items-center space-x-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Request a new reset link</span>
                </Link>
              </div>
            </div>
          )}

          {success ? (
            <div className="space-y-6">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex items-start space-x-3 text-xs text-emerald-300 leading-relaxed">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  Your password has been reset successfully. Please sign in with your new password to access your account.
                </span>
              </div>

              <Link
                to="/login"
                className="w-full flex items-center justify-center space-x-2 py-3 px-4 border border-transparent rounded-xl shadow-md text-sm font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 transition"
              >
                <span>Sign In to ONCEClic</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">New password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  minLength={6}
                  autoComplete="new-password"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Confirm new password</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  minLength={6}
                  autoComplete="new-password"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !token.trim()}
                className="w-full flex items-center justify-center space-x-2 py-3 px-4 border border-transparent rounded-xl shadow-md text-sm font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 focus:outline-none disabled:opacity-50 transition"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Reset Password</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <div className="pt-2 text-center">
                <Link to="/login" className="text-xs font-medium text-slate-400 hover:text-emerald-400 transition">
                  Back to Login
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
