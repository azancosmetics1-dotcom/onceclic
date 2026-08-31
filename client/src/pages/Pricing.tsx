import React from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Check, ShieldCheck, HelpCircle, ArrowRight, Bot } from 'lucide-react';

export const Pricing: React.FC = () => {
  const planFeatures = [
    '24/7 Website AI Receptionist Chatbot',
    'Automated Business Email Answering',
    'Real-Time Appointment Booking Calendar',
    'Custom Business Knowledge Base & FAQs',
    'Automatic Human Handoff & Team Alerts',
    'Multi-Tenant Team Member RBAC (Owner, Manager, Staff)',
    'Strict Zero-Hallucination & Anti-Injection Guardrails',
    'Full Conversation History & Analytics',
    'Easy 1-Line Website Script Embed or Hosted Link',
  ];

  const faqs = [
    {
      q: 'How does the 7-day free trial work?',
      a: 'You get full access to all ONCEClic Pro features immediately upon creating your account. No payment is taken upfront. After 7 days, your subscription continues at $49/month via Paddle recurring billing.',
    },
    {
      q: 'What happens when my trial expires?',
      a: 'If you choose not to subscribe, your AI receptionist and automated responses will pause, but your account and business data will remain safely preserved so you can reactivate at any time.',
    },
    {
      q: 'How does appointment booking work?',
      a: 'The AI checks your real business hours and existing appointment schedule to ensure it only books available slots without double-booking.',
    },
    {
      q: 'Can I customize what the AI says?',
      a: 'Yes! You have full control over the AI’s name, tone, personality, instructions, business profile, services, and FAQ knowledge base.',
    },
    {
      q: 'How do I install it on my website?',
      a: 'Simply copy the one-line embed snippet from your dashboard and paste it before the closing </body> tag of your website, or share your hosted direct chat link.',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Navbar />

      <main className="flex-1 py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h1 className="text-4xl sm:text-5xl font-black text-white tracking-tight">
            Simple, transparent pricing.
          </h1>
          <p className="mt-4 text-lg text-slate-300">
            One powerful plan with everything you need to automate your front desk and acquire more customers.
          </p>
        </div>

        {/* Pricing Card */}
        <div className="max-w-lg mx-auto bg-slate-900 border-2 border-emerald-500/50 rounded-3xl p-8 sm:p-10 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-emerald-500 text-slate-950 text-xs font-bold px-4 py-1.5 rounded-bl-xl uppercase tracking-wider">
            Most Popular
          </div>

          <div className="flex items-center space-x-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-white">ONCEClic Pro</h2>
              <p className="text-xs text-slate-400">Complete AI Receptionist & Booking Suite</p>
            </div>
          </div>

          <div className="mt-6 mb-8 flex items-baseline space-x-2">
            <span className="text-5xl font-black text-white">$49</span>
            <span className="text-slate-400 text-sm font-medium">/ month</span>
            <span className="text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full ml-2">
              7 Days Free
            </span>
          </div>

          <Link
            to="/signup"
            className="w-full py-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-center block transition shadow-lg shadow-emerald-500/20 mb-8"
          >
            Start 7-Day Free Trial
          </Link>

          <p className="text-xs text-center text-slate-400 mb-6 flex items-center justify-center space-x-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Paddle Merchant of Record &bull; Secure recurring billing</span>
          </p>

          <div className="border-t border-slate-800 pt-6">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-4">
              Everything included in Pro:
            </p>
            <ul className="space-y-3.5 text-sm text-slate-300">
              {planFeatures.map((feat, i) => (
                <li key={i} className="flex items-start space-x-3">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{feat}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* FAQs */}
        <div className="mt-24 max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-10">Frequently Asked Questions</h2>
          <div className="space-y-6">
            {faqs.map((faq, i) => (
              <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <h3 className="text-base font-bold text-white mb-2 flex items-center space-x-2">
                  <HelpCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{faq.q}</span>
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed pl-6">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-950 py-10 px-4 text-slate-400 text-xs text-center">
        <p>&copy; 2026 onceclic.com. All rights reserved.</p>
      </footer>
    </div>
  );
};
