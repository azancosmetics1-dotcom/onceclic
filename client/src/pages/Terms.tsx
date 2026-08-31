import React from 'react';
import { Navbar } from '../components/Navbar';

export const Terms: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Navbar />
      <main className="flex-1 py-16 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto w-full">
        <h1 className="text-3xl font-black text-white mb-2">Terms of Service</h1>
        <p className="text-xs text-slate-400 mb-8">Last Updated: August 2026</p>

        <div className="space-y-6 text-sm text-slate-300 leading-relaxed">
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h2 className="text-lg font-bold text-white mb-2">1. Agreement to Terms</h2>
            <p>
              By accessing or using ONCEClic (onceclic.com), you agree to be bound by these Terms of Service. If you disagree with any part of the terms, you may not access the service.
            </p>
          </section>

          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h2 className="text-lg font-bold text-white mb-2">2. Description of Service</h2>
            <p>
              ONCEClic provides a multi-tenant AI receptionist software platform for businesses to manage website chat, business FAQs, appointment scheduling, and email answering.
            </p>
          </section>

          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h2 className="text-lg font-bold text-white mb-2">3. Subscriptions & Billing</h2>
            <p>
              ONCEClic Pro is billed at $49/month following a 7-day free trial. Payments and recurring billing are processed securely through Paddle as our Merchant of Record. You may cancel your subscription at any time via the billing portal.
            </p>
          </section>

          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h2 className="text-lg font-bold text-white mb-2">4. Acceptable Use</h2>
            <p>
              You agree not to use the service for any illegal purposes, to impersonate other entities fraudulently, or to transmit malicious code or harmful automated traffic.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
};
