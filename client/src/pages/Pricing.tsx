import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { Check, ShieldCheck, HelpCircle, Bot, Sparkles, ArrowRight } from 'lucide-react';

export const Pricing: React.FC = () => {
  useEffect(() => {
    document.title = 'ONCEClic Pricing — Pro Plan ($19/mo, 7-Day Free Trial)';
  }, []);

  const planFeatures = [
    '24/7 Website AI Receptionist Chatbot',
    'Automated Business Email & Gmail Answering',
    'Google Calendar & Real-Time Slot Availability Sync',
    'Instagram DM Receptionist with Live Booking',
    'Double-Booking Prevention Engine',
    'Custom Business Knowledge Base & FAQs Grounding',
    'Seamless Human Handoff & Team Alerts',
    'Multi-Tenant Team Member Roles (Owner, Manager, Staff)',
    'Strict Zero-Hallucination & Anti-Injection Guardrails',
    'Easy 1-Line Website Script Embed or Direct Link',
  ];

  const faqs = [
    {
      q: 'How does the 7-day free trial work?',
      a: 'Start your 7-day free trial with no credit card required. Your trial is free for 7 days. When the trial ends, you can choose whether to upgrade to ONCEClic Pro.',
    },
    {
      q: 'Is a credit card required to start the trial?',
      a: 'No. You do not need to enter a credit card or payment method to start your 7-day trial.',
    },
    {
      q: 'What happens when my trial expires?',
      a: 'When your trial ends, you are never automatically charged. You can choose whether to upgrade to ONCEClic Pro for $19/month to keep your AI receptionist and booking automation active.',
    },
    {
      q: 'Who processes payments and billing?',
      a: 'Paddle acts as our Merchant of Record for all paid transactions, handling checkout, invoicing, sales taxes, and recurring billing securely.',
    },
    {
      q: 'Can I cancel my subscription?',
      a: 'Yes. You can cancel your subscription at any time directly through the billing settings in your dashboard. You will not be billed for subsequent cycles.',
    },
    {
      q: 'How do appointment bookings work?',
      a: 'The AI checks your real business hours and connected calendar availability to book confirmed appointments directly into your schedule without double-booking.',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-slate-950">
      <Navbar />

      <main className="flex-1 py-16 sm:py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center space-x-2 px-3.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            <span>7-Day Free Trial &bull; No Credit Card Required</span>
          </div>
          <h1 className="text-4xl sm:text-6xl font-black text-white tracking-tight">
            Simple, transparent pricing.
          </h1>
          <p className="mt-4 text-base sm:text-lg text-slate-300">
            One comprehensive plan with everything your business needs to automate customer communication and bookings.
          </p>
        </div>

        {/* Pricing Card */}
        <div className="max-w-lg mx-auto bg-slate-900 border-2 border-emerald-500/50 rounded-3xl p-8 sm:p-10 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-emerald-500 text-slate-950 text-xs font-bold px-4 py-1.5 rounded-bl-xl uppercase tracking-wider">
            7-Day Free Trial
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

          <div className="mt-6 mb-2 flex items-baseline space-x-2">
            <span className="text-5xl font-black text-white">$19</span>
            <span className="text-slate-400 text-sm font-medium">USD / month</span>
          </div>

          <p className="text-xs text-emerald-400 font-semibold mb-6">
            Start your 7-day free trial with no credit card required.
          </p>

          <Link
            to="/signup"
            className="w-full py-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-center block transition shadow-lg shadow-emerald-500/20 mb-4"
          >
            Start 7-Day Free Trial
          </Link>

          <div className="text-xs text-slate-400 mb-6 flex flex-col items-center space-y-1 text-center">
            <div className="flex items-center space-x-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>No payment method required to start trial</span>
            </div>
            <span className="text-[11px] text-slate-500">
              Upgrade to Pro for $19/mo when you're ready. Merchant of Record: Paddle.
            </span>
          </div>

          <div className="border-t border-slate-800 pt-6">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-4">
              Everything included in ONCEClic Pro:
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
          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-2">
                <h3 className="text-base font-bold text-white flex items-center space-x-2">
                  <HelpCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{faq.q}</span>
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed pl-6">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};
