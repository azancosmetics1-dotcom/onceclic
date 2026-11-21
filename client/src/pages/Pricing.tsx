import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import {
  Check,
  Sparkles,
  ArrowRight,
  Bot,
  Zap,
  BarChart3,
  HelpCircle,
  Clock,
  Globe,
  Mic,
  ShieldCheck,
  Calendar,
  Layers,
  PhoneCall,
  Info,
} from 'lucide-react';

export const Pricing: React.FC = () => {
  useEffect(() => {
    document.title = 'ONCEClic Pricing — Starter ($19/mo), Pro ($49/mo) & Business ($99/mo)';
  }, []);

  const faqs = [
    {
      q: 'Does ONCEClic require a phone number?',
      a: 'No phone number is required for browser-based website voice. Your AI receptionist communicates directly through the visitor\'s browser microphone and speakers on your website.',
    },
    {
      q: 'How does the website AI voice agent work?',
      a: 'Visitors click the voice button on your website and speak naturally through their browser microphone and speakers. Powered by Google Gemini Live real-time audio AI, the receptionist answers questions, explains your services, and checks real calendar availability.',
    },
    {
      q: 'What happens when my included minutes run out?',
      a: 'Usage is subject to the monthly included voice allowance (Starter: 50 min, Pro: 200 min, Business: 500 min). All plans feature strict usage caps with zero surprise charges or automated overage fees. When your monthly allowance is reached, voice sessions are safely paused until the next billing cycle or until you upgrade your plan.',
    },
    {
      q: 'Does ONCEClic support appointment booking?',
      a: 'Yes. Appointment booking is available when your calendar integration is configured and active. The AI checks verified calendar availability and business opening hours to eliminate double bookings.',
    },
    {
      q: 'Are phone calls available?',
      a: 'Telephone calling and phone number purchasing are Coming Soon in a future release. ONCEClic V1 is fully dedicated to website-embedded browser voice receptionists.',
    },
    {
      q: 'Can I embed the agent on my own website?',
      a: 'Yes! Once your assistant is ready in the dashboard, you can copy the 1-click embed code snippet and paste it onto any website (WordPress, Webflow, Shopify, Squarespace, React, or plain HTML).',
    },
  ];

  const comparisonFeatures = [
    {
      name: 'Monthly Subscription',
      starter: '$19 / month',
      pro: '$49 / month',
      business: '$99 / month',
    },
    {
      name: 'Included AI Voice Minutes',
      starter: '50 minutes / mo',
      pro: '200 minutes / mo',
      business: '500 minutes / mo',
    },
    {
      name: 'Browser-Based Voice Receptionist',
      starter: true,
      pro: true,
      business: true,
    },
    {
      name: 'Google Gemini 2.5 Flash-Lite AI',
      starter: true,
      pro: true,
      business: true,
    },
    {
      name: 'Multilingual (English & Urdu)',
      starter: true,
      pro: true,
      business: true,
    },
    {
      name: '1-Click Website Embed',
      starter: true,
      pro: true,
      business: true,
    },
    {
      name: 'Verified Business Knowledge Base',
      starter: true,
      pro: true,
      business: true,
    },
    {
      name: 'Real Calendar Availability & Booking',
      starter: 'Basic',
      pro: 'Full Real-Time',
      business: 'Advanced Multi-Staff',
    },
    {
      name: 'Voice Agent Customization',
      starter: 'Standard',
      pro: 'Advanced',
      business: 'Full Customization',
    },
    {
      name: 'Browser Voice Usage Analytics',
      starter: 'Basic',
      pro: 'Advanced',
      business: 'Enterprise Analytics',
    },
    {
      name: 'Support Level',
      starter: 'Standard Email',
      pro: 'Priority Email',
      business: 'Priority Support',
    },
    {
      name: 'Business Phone Numbers & PSTN Calls',
      starter: 'Coming Soon',
      pro: 'Coming Soon',
      business: 'Coming Soon',
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
            <span>AI Voice Receptionist — Available Now</span>
          </div>
          <h1 className="text-4xl sm:text-6xl font-black text-white tracking-tight">
            Simple, transparent pricing.
          </h1>
          <p className="mt-4 text-base sm:text-lg text-slate-300">
            Empower your website visitors with natural voice conversations. Visitors speak directly through their browser microphone & speakers — no phone numbers required.
          </p>
        </div>

        {/* Pricing Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto items-stretch">
          {/* Starter Plan */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-xl flex flex-col justify-between transition hover:border-slate-700">
            <div>
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-slate-800 text-slate-300 flex items-center justify-center">
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Starter</h2>
                  <p className="text-xs text-slate-400">Essential Website Voice</p>
                </div>
              </div>

              <div className="mt-4 mb-2 flex items-baseline space-x-2">
                <span className="text-4xl font-black text-white">$19</span>
                <span className="text-slate-400 text-xs font-medium">USD / month</span>
              </div>

              {/* Minute Badge */}
              <div className="mb-6 p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-center space-x-2 text-xs">
                <Mic className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-emerald-300 font-bold">50 AI voice minutes/month</span>
              </div>

              <Link
                to="/signup?plan=starter"
                className="w-full py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-center block transition text-sm mb-6 border border-slate-700"
              >
                Start 14-Day Free Trial
              </Link>

              <div className="border-t border-slate-800 pt-5">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3">Included Features:</p>
                <ul className="space-y-3 text-xs text-slate-300">
                  <li className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>50 AI voice minutes/month</strong></span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Website AI Voice Receptionist</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>1-Click Website Embed & Installation</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Business Knowledge Base</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Basic Dashboard & Analytics</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Calendar Integration (Basic)</span>
                  </li>
                  <li className="flex items-start space-x-2 text-slate-500">
                    <Clock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                    <span>Phone numbers & PSTN calls (Coming Soon)</span>
                  </li>
                </ul>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-6 text-center">AI voice minutes consumed during browser sessions.</p>
          </div>

          {/* Pro Plan (Recommended / Most Popular) */}
          <div className="bg-slate-900 border-2 border-emerald-500 rounded-3xl p-8 shadow-2xl relative overflow-hidden flex flex-col justify-between ring-4 ring-emerald-500/10">
            <div className="absolute top-0 right-0 bg-emerald-500 text-slate-950 text-[11px] font-black px-4 py-1 rounded-bl-xl uppercase tracking-wider">
              Recommended
            </div>

            <div>
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Pro</h2>
                  <p className="text-xs text-slate-400">Complete AI Voice & Scheduling</p>
                </div>
              </div>

              <div className="mt-4 mb-2 flex items-baseline space-x-2">
                <span className="text-4xl font-black text-white">$49</span>
                <span className="text-slate-400 text-xs font-medium">USD / month</span>
              </div>

              {/* Minute Badge */}
              <div className="mb-6 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center space-x-2 text-xs">
                <Mic className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-emerald-300 font-bold">200 AI voice minutes/month</span>
              </div>

              <Link
                to="/signup?plan=pro"
                className="w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-center block transition text-sm mb-6 shadow-lg shadow-emerald-500/25"
              >
                Start 14-Day Free Trial ($0)
              </Link>

              <div className="border-t border-slate-800 pt-5">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3">Everything in Starter plus:</p>
                <ul className="space-y-3 text-xs text-slate-300">
                  <li className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>200 AI voice minutes/month</strong></span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Advanced Voice Agent Configuration</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>Real Appointment Booking & Availability</strong></span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Advanced Voice & Visitor Analytics</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Additional Persona & Tone Customization</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Priority Email Support</span>
                  </li>
                  <li className="flex items-start space-x-2 text-slate-500">
                    <Clock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                    <span>Phone numbers & PSTN calls (Coming Soon)</span>
                  </li>
                </ul>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-6 text-center">AI voice minutes consumed during browser sessions.</p>
          </div>

          {/* Business Plan */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-xl flex flex-col justify-between transition hover:border-slate-700">
            <div>
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-slate-800 text-slate-300 flex items-center justify-center">
                  <BarChart3 className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Business</h2>
                  <p className="text-xs text-slate-400">High Volume Organizations</p>
                </div>
              </div>

              <div className="mt-4 mb-2 flex items-baseline space-x-2">
                <span className="text-4xl font-black text-white">$99</span>
                <span className="text-slate-400 text-xs font-medium">USD / month</span>
              </div>

              {/* Minute Badge */}
              <div className="mb-6 p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-center space-x-2 text-xs">
                <Mic className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-emerald-300 font-bold">500 AI voice minutes/month</span>
              </div>

              <Link
                to="/signup?plan=business"
                className="w-full py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-center block transition text-sm mb-6 border border-slate-700"
              >
                Start 14-Day Free Trial
              </Link>

              <div className="border-t border-slate-800 pt-5">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3">Everything in Pro plus:</p>
                <ul className="space-y-3 text-xs text-slate-300">
                  <li className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>500 AI voice minutes/month</strong></span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Higher Monthly Usage Allowance</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Advanced Business Configuration</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Multi-Calendar Team Scheduling</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Dedicated Priority Support</span>
                  </li>
                  <li className="flex items-start space-x-2 text-slate-500">
                    <Clock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                    <span>Phone numbers & PSTN calls (Coming Soon)</span>
                  </li>
                </ul>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-6 text-center">AI voice minutes consumed during browser sessions.</p>
          </div>
        </div>

        {/* Transparent Usage Policy Banner */}
        <div className="mt-12 max-w-4xl mx-auto p-5 rounded-2xl bg-slate-900/80 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start space-x-3">
            <Info className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-white">Strict Allowance Policy</h3>
              <p className="text-xs text-slate-300 mt-0.5">
                Every plan includes a generous browser voice allowance (Starter: 50 min, Pro: 200 min, Business: 500 min).
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                Usage is strictly capped at your plan's included allowance with zero automated overage charges. When minutes are exhausted, sessions pause safely until your next billing date or plan upgrade.
              </p>
            </div>
          </div>
          <span className="shrink-0 text-xs font-semibold px-3 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
            Zero Overage Surprises
          </span>
        </div>

        {/* Plan Comparison Table */}
        <div className="mt-20 max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-black text-white text-center mb-8">
            Compare Plan Capabilities
          </h2>

          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/90 text-slate-300">
                  <th className="py-4 px-6 font-bold">Feature</th>
                  <th className="py-4 px-6 font-bold text-center">Starter ($19)</th>
                  <th className="py-4 px-6 font-bold text-center text-emerald-400">Pro ($49)</th>
                  <th className="py-4 px-6 font-bold text-center">Business ($99)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {comparisonFeatures.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/30 transition">
                    <td className="py-3.5 px-6 font-medium text-white">{row.name}</td>
                    <td className="py-3.5 px-6 text-center">
                      {typeof row.starter === 'boolean' ? (
                        row.starter ? (
                          <Check className="w-4 h-4 text-emerald-400 mx-auto" />
                        ) : (
                          <span className="text-slate-600">—</span>
                        )
                      ) : (
                        <span className={row.starter === 'Coming Soon' ? 'text-amber-400 text-xs' : ''}>{row.starter}</span>
                      )}
                    </td>
                    <td className="py-3.5 px-6 text-center bg-emerald-500/[0.03]">
                      {typeof row.pro === 'boolean' ? (
                        row.pro ? (
                          <Check className="w-4 h-4 text-emerald-400 mx-auto" />
                        ) : (
                          <span className="text-slate-600">—</span>
                        )
                      ) : (
                        <span className={row.pro === 'Coming Soon' ? 'text-amber-400 text-xs' : 'font-semibold text-emerald-300'}>{row.pro}</span>
                      )}
                    </td>
                    <td className="py-3.5 px-6 text-center">
                      {typeof row.business === 'boolean' ? (
                        row.business ? (
                          <Check className="w-4 h-4 text-emerald-400 mx-auto" />
                        ) : (
                          <span className="text-slate-600">—</span>
                        )
                      ) : (
                        <span className={row.business === 'Coming Soon' ? 'text-amber-400 text-xs' : ''}>{row.business}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* FAQs */}
        <div className="mt-24 max-w-3xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-black text-white">Frequently Asked Questions</h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-2">
              Everything you need to know about ONCEClic website AI voice receptionists.
            </p>
          </div>
          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-2">
                <h3 className="text-sm sm:text-base font-bold text-white flex items-center space-x-2.5">
                  <HelpCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{faq.q}</span>
                </h3>
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed pl-6.5">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};
