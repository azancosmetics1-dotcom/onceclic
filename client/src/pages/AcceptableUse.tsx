import React, { useEffect } from 'react';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { ShieldAlert, AlertTriangle, CheckCircle2, Ban, Mail } from 'lucide-react';

export const AcceptableUse: React.FC = () => {
  useEffect(() => {
    document.title = 'Acceptable Use Policy — ONCEClic';
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-slate-950">
      <Navbar />

      <main className="flex-1 py-16 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto w-full">
        <div className="mb-10 pb-6 border-b border-slate-800">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-4">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Platform Guidelines</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            Acceptable Use Policy
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-2">
            Last Updated: September 2026 &bull; Service: ONCEClic (onceclic.com)
          </p>
        </div>

        <div className="space-y-8 text-sm text-slate-300 leading-relaxed">
          {/* Overview */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">1. Purpose & Applicability</h2>
            <p>
              This Acceptable Use Policy ("AUP") defines acceptable practices when utilizing <strong>ONCEClic</strong> ("ONCEClic", "we", "us", or "our") services, APIs, AI receptionist bots, and dashboard tools. This policy ensures the security, reliability, and lawful operation of the platform for all tenants and their customers.
            </p>
          </section>

          {/* Prohibited Activities */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <Ban className="w-5 h-5 text-rose-400" />
              <span>2. Strictly Prohibited Uses</span>
            </h2>
            <p>You agree not to use ONCEClic to engage in, foster, or promote any of the following activities:</p>
            
            <div className="space-y-3 pt-2 text-xs sm:text-sm">
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                <span className="font-bold text-rose-400">Illegal or Fraudulent Activity: </span>
                <span className="text-slate-300">Violating any applicable local, national, or international laws, perpetrating financial fraud, identity theft, or deceptive business practices.</span>
              </div>

              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                <span className="font-bold text-rose-400">Spam, Phishing & Unsolicited Communications: </span>
                <span className="text-slate-300">Using the AI email or messaging features to send unsolicited commercial emails, mass spam, credential harvesting schemes, or phishing attacks.</span>
              </div>

              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                <span className="font-bold text-rose-400">Impersonation & Deception: </span>
                <span className="text-slate-300">Misrepresenting your business identity, falsely claiming affiliations with other entities or government bodies, or attempting to mislead consumers.</span>
              </div>

              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                <span className="font-bold text-rose-400">Malicious Content & Exploits: </span>
                <span className="text-slate-300">Uploading viruses, malware, trojans, ransomware, or scripts intended to disrupt or damage systems.</span>
              </div>

              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                <span className="font-bold text-rose-400">AI Abuse & Guardrail Bypass: </span>
                <span className="text-slate-300">Conducting adversarial prompt injection attacks, jailbreaking attempts, automated scraping loops, or attempting to bypass AI usage and token limits.</span>
              </div>

              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                <span className="font-bold text-rose-400">Subscription & Access Control Evasion: </span>
                <span className="text-slate-300">Attempting to bypass authentication mechanisms, multi-tenant isolation boundaries, or subscription billing gates.</span>
              </div>
            </div>
          </section>

          {/* Customer Responsibility */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">3. Business Content & Knowledge Responsibility</h2>
            <p>
              You are responsible for ensuring that all knowledge base documents, business FAQs, and service descriptions uploaded to your ONCEClic receptionist are accurate, lawful, and do not infringe on third-party intellectual property or privacy rights.
            </p>
          </section>

          {/* Enforcement */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">4. Enforcement & Account Actions</h2>
            <p>
              ONCEClic reserves the right to investigate potential violations of this policy. If a violation is identified, we may issue a warning, temporarily suspend access, or terminate the offending organization's account immediately without prior notice.
            </p>
          </section>

          {/* Reporting */}
          <section className="bg-slate-900 border border-emerald-500/20 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <Mail className="w-5 h-5 text-emerald-400" />
              <span>5. Reporting Violations</span>
            </h2>
            <p>
              If you suspect that an ONCEClic account or hosted bot is being used in violation of this Acceptable Use Policy, please notify us immediately:
            </p>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono">
              <span className="text-slate-400">Abuse Reporting: </span>
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
