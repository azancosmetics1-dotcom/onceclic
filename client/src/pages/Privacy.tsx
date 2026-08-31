import React from 'react';
import { Navbar } from '../components/Navbar';

export const Privacy: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Navbar />
      <main className="flex-1 py-16 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto w-full">
        <h1 className="text-3xl font-black text-white mb-2">Privacy Policy</h1>
        <p className="text-xs text-slate-400 mb-8">Last Updated: August 2026</p>

        <div className="space-y-6 text-sm text-slate-300 leading-relaxed">
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h2 className="text-lg font-bold text-white mb-2">1. Information We Collect</h2>
            <p>
              We collect account information (name, email address, password hashes), organization configuration data, business knowledge base content, and conversation transcripts needed to deliver our AI receptionist services.
            </p>
          </section>

          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h2 className="text-lg font-bold text-white mb-2">2. How We Use Information</h2>
            <p>
              Information is used strictly to provide, maintain, secure, and optimize our services, process customer interactions with your AI receptionist, and manage billing.
            </p>
          </section>

          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h2 className="text-lg font-bold text-white mb-2">3. Multi-Tenant Data Isolation</h2>
            <p>
              Your business data, knowledge base, customer inquiries, and appointments are strictly isolated using enterprise-grade multi-tenant architecture. Organization data is never shared across tenants.
            </p>
          </section>

          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h2 className="text-lg font-bold text-white mb-2">4. Payment Processing</h2>
            <p>
              Payment details are processed securely by Paddle. ONCEClic does not directly store credit card or payment credential data.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
};
