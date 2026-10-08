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
    'Facebook Page Messenger AI Receptionist',
    'Double-Booking Prevention Engine',
    'Custom Business Knowledge Base & FAQs Grounding',
    'Seamless Human Handoff & Team Alerts',
    'Multi-Tenant Team Member Roles (Owner, Manager, Staff)',
    'Strict Zero-Hallucination & Anti-Injection Guardrails',
    'Easy 1-Line Website Script Embed or Direct Link',
    'AI usage is subject to reasonable-use limits.',
  ];

  const faqs = [
    {
      q: 'How does the 7-day free trial work?',
      a: 'Start your 7-day free trial with no credit card required. Your trial is $0 for 7 days with limited AI usage during your free trial. When the trial ends, you can choose whether to upgrade to ONCEClic Pro.',
    },
    {
      q: 'Is a credit card required to start the trial?',
      a: 'No. You do not need to enter a credit card or payment method to start your 7-day free trial.',
    },
    {
      q: 'What happens when my trial expires?',
      a: 'When your trial ends, you are never automatically charged. You can choose whether to upgrade to ONCEClic Pro for $19/month to keep your AI receptionist and booking automation active.',
    },
    {
      q: 'What are the AI usage terms?',
      a: 'Limited AI usage during your free trial. On the ONCEClic Pro plan, AI usage is subject to reasonable-use limits.',
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
            <span>7-Day Free Trial &bull; $0 &bull; No Credit Card Required</span>
          </div>
          <h1 className="text-4xl sm:text-6xl font-black text-white tracking-tight">
            Simple, transparent pricing.
          </h1>
          <p className="mt-4 text-base sm:text-lg text-slate-300">
            One comprehensive plan with everything your business needs to automate customer communication and bookings.
          </p>
        </div>

        {/* Pricing Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {/* Starter Plan */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-9 h-9 rounded-xl bg-slate-800 text-slate-300 flex items-center justify-center">
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Starter</h2>
                  <p className="text-xs text-slate-400">Essential Phone & Web AI</p>
                </div>
              </div>

              <div className="mt-4 mb-2 flex items-baseline space-x-2">
                <span className="text-4xl font-black text-white">$19</span>
                <span className="text-slate-400 text-xs font-medium">USD / month</span>
              </div>
              <p className="text-xs text-emerald-400 font-semibold mb-6">
                Includes 50 Voice Call Minutes / mo
              </p>

              <Link
                to="/signup"
                className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-center block transition text-sm mb-6 border border-slate-700"
              >
                Start 7-Day Free Trial
              </Link>

              <div className="border-t border-slate-800 pt-5">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3">Included:</p>
                <ul className="space-y-2.5 text-xs text-slate-300">
                  <li className="flex items-start space-x-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>50 Included Voice Minutes</strong> / mo</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>24/7 AI Phone Receptionist</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Existing Business Number Forwarding</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Google Calendar Real-Time Booking</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>24/7 Website Live Chat Widget</span>
                  </li>
                </ul>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-6 text-center">AI usage subject to reasonable-use limits.</p>
          </div>

          {/* Pro Plan (Most Popular) */}
          <div className="bg-slate-900 border-2 border-emerald-500 rounded-3xl p-8 shadow-2xl relative overflow-hidden flex flex-col justify-between">
            <div className="absolute top-0 right-0 bg-emerald-500 text-slate-950 text-[11px] font-bold px-3.5 py-1 rounded-bl-xl uppercase tracking-wider">
              Most Popular
            </div>

            <div>
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">ONCEClic Pro</h2>
                  <p className="text-xs text-slate-400">Complete AI Voice & Booking Suite</p>
                </div>
              </div>

              <div className="mt-4 mb-2 flex items-baseline space-x-2">
                <span className="text-4xl font-black text-white">$49</span>
                <span className="text-slate-400 text-xs font-medium">USD / month</span>
              </div>
              <p className="text-xs text-emerald-400 font-semibold mb-6">
                Includes 150 Voice Call Minutes / mo
              </p>

              <Link
                to="/signup"
                className="w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-center block transition text-sm mb-6 shadow-md shadow-emerald-500/20"
              >
                Start 7-Day Free Trial ($0)
              </Link>

              <div className="border-t border-slate-800 pt-5">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3">Everything in Starter plus:</p>
                <ul className="space-y-2.5 text-xs text-slate-300">
                  <li className="flex items-start space-x-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>150 Included Voice Minutes</strong> / mo</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Call Transcripts &amp; Recordings</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>SMS &amp; Email Confirmation Alerts</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Custom Industry Knowledge &amp; FAQs</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Priority Support</span>
                  </li>
                </ul>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-6 text-center">AI usage subject to reasonable-use limits.</p>
          </div>

          {/* Business Plan */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-9 h-9 rounded-xl bg-slate-800 text-slate-300 flex items-center justify-center">
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Business</h2>
                  <p className="text-xs text-slate-400">High Volume Phone Answering</p>
                </div>
              </div>

              <div className="mt-4 mb-2 flex items-baseline space-x-2">
                <span className="text-4xl font-black text-white">$99</span>
                <span className="text-slate-400 text-xs font-medium">USD / month</span>
              </div>
              <p className="text-xs text-emerald-400 font-semibold mb-6">
                Includes 400 Voice Call Minutes / mo
              </p>

              <Link
                to="/signup"
                className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-center block transition text-sm mb-6 border border-slate-700"
              >
                Start 7-Day Free Trial
              </Link>

              <div className="border-t border-slate-800 pt-5">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3">Everything in Pro plus:</p>
                <ul className="space-y-2.5 text-xs text-slate-300">
                  <li className="flex items-start space-x-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>400 Included Voice Minutes</strong> / mo</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Multiple Phone Numbers Support</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Dedicated Team Member Inboxes</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Advanced Call Analytics &amp; Reporting</span>
                  </li>
                </ul>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-6 text-center">AI usage subject to reasonable-use limits.</p>
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
