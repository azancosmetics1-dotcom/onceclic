import React, { useEffect } from 'react';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { ShieldCheck, Lock, Key, CheckCircle2, Server, EyeOff, FileCode2, Mail } from 'lucide-react';

export const Security: React.FC = () => {
  useEffect(() => {
    document.title = 'Security & Trust — ONCEClic';
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-slate-950">
      <Navbar />

      <main className="flex-1 py-16 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto w-full">
        <div className="mb-10 pb-6 border-b border-slate-800">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-4">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Architecture & Trust</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            Security & Trust
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-2">
            How ONCEClic protects your business knowledge, customer conversations, and integrations.
          </p>
        </div>

        <div className="space-y-8 text-sm text-slate-300 leading-relaxed">
          {/* Commitment */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">Our Security Principles</h2>
            <p>
              At <strong>ONCEClic</strong>, security is built into our core architectural design. We implement strict tenant isolation, server-side credential management, and AI prompt-grounding defenses to ensure your business operations remain protected.
            </p>
          </section>

          {/* Architecture Grid */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Multi-Tenant Isolation */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-white">Multi-Tenant Tenant Isolation</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                All customer data, appointment schedules, and business knowledge base entries are strictly segregated by organization IDs at the database layer. No cross-tenant data leakage is permitted.
              </p>
            </div>

            {/* Role-Based Access Control */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-white">Role-Based Access (RBAC)</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Granular team role permissions (Owner, Manager, Staff) ensure that sensitive settings, API tokens, and billing actions are only accessible by authorized members.
              </p>
            </div>

            {/* Server-Side Credentials */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <Key className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-white">Server-Side Secret Isolation</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                OAuth access tokens, API credentials, and internal provider keys are stored exclusively on secure backend servers and are never exposed to browser clients.
              </p>
            </div>

            {/* Webhook HMAC Verification */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <FileCode2 className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-white">Cryptographic Webhook Verification</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Inbound payment and integration webhooks are verified using HMAC-SHA256 signature hashes and timestamp validation to prevent spoofing and replay attacks.
              </p>
            </div>

            {/* AI Safety & Anti-Injection */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <EyeOff className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-white">AI Grounding & Anti-Injection</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Prompt injection defense layers and factual grounding constraints restrict AI responses strictly to your verified knowledge base, preventing prompt leaking and malicious prompt overrides.
              </p>
            </div>

            {/* Merchant of Record Security */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <Server className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-white">Secure Merchant of Record (Paddle)</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Credit card details and financial credentials are processed directly by Paddle. ONCEClic never stores or transmits raw credit card numbers.
              </p>
            </div>
          </section>

          {/* Vulnerability Reporting */}
          <section className="bg-slate-900 border border-emerald-500/20 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <Mail className="w-5 h-5 text-emerald-400" />
              <span>Responsible Security Disclosure</span>
            </h2>
            <p>
              If you identify a security vulnerability or have a security-related question, please contact our security team directly:
            </p>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono">
              <span className="text-slate-400">Security Contact: </span>
              <a href="mailto:kamiabc007@gmail.com" className="text-emerald-400 hover:underline font-bold">
                kamiabc007@gmail.com
              </a>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
};
