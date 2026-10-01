import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { HelpCircle, ChevronDown, ChevronUp, Sparkles, ShieldCheck, ArrowRight } from 'lucide-react';

interface FAQItem {
  category: string;
  question: string;
  answer: React.ReactNode;
}

export const FAQ: React.FC = () => {
  useEffect(() => {
    document.title = 'Frequently Asked Questions (FAQ) — ONCEClic';
  }, []);

  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const faqs: FAQItem[] = [
    {
      category: 'General',
      question: 'What is ONCEClic?',
      answer:
        'ONCEClic is an AI-powered receptionist and business automation platform built specifically for small businesses, clinics, salons, consultants, and contractors. It helps you manage website visitors, answer questions 24/7, and book appointments automatically.',
    },
    {
      category: 'General',
      question: 'What does ONCEClic do?',
      answer:
        'ONCEClic provides 24/7 website chat support grounded on your custom business knowledge base, automates appointment scheduling with live calendar sync, drafts and sends intelligent email responses, and routes complex inquiries to your human team.',
    },
    {
      category: 'Pricing & Trial',
      question: 'What is the 7-day free trial?',
      answer:
        'All new accounts receive full access to ONCEClic for 7 days at $0 cost. You can train your knowledge base, test the live website receptionist, connect your calendar, and experience automated booking during your trial period.',
    },
    {
      category: 'Pricing & Trial',
      question: 'Do I need a credit card to start the free trial?',
      answer:
        'No. No credit card or payment information is required to start your 7-day free trial. You can create an account and start configuring your AI receptionist in minutes.',
    },
    {
      category: 'Pricing & Trial',
      question: 'How much does ONCEClic Pro cost?',
      answer:
        'ONCEClic Pro costs $19 USD per month. It includes the complete AI receptionist suite, website embed, calendar booking engine, email answering, and team collaboration features.',
    },
    {
      category: 'Pricing & Trial',
      question: 'What happens when my free trial ends?',
      answer:
        'When your 7-day trial ends, you are never automatically charged. You can choose whether to upgrade to ONCEClic Pro ($19/month) via our secure checkout. If you choose not to upgrade, your settings and knowledge base remain safely preserved in your account.',
    },
    {
      category: 'Billing & Merchant of Record',
      question: 'How does billing work and what is Paddle?',
      answer:
        'Paddle acts as our Merchant of Record for all paid transactions. Paddle handles payment processing, invoicing, sales tax/VAT compliance, and subscription billing securely.',
    },
    {
      category: 'Billing & Merchant of Record',
      question: 'Can I cancel my subscription anytime?',
      answer:
        'Yes. You can cancel your subscription at any time directly from the Billing tab in your dashboard. When canceled, your subscription remains active until the end of your current paid monthly cycle, with no future renewals.',
    },
    {
      category: 'Billing & Merchant of Record',
      question: 'How do refunds work?',
      answer: (
        <span>
          Refund requests are evaluated in accordance with our{' '}
          <Link to="/refund-policy" className="text-emerald-400 hover:underline">
            Refund Policy
          </Link>{' '}
          and Paddle’s applicable Merchant of Record policies. If you have any billing concerns, you can contact us directly at{' '}
          <a href="mailto:kamiabc007@gmail.com" className="text-emerald-400 hover:underline">
            kamiabc007@gmail.com
          </a>
          .
        </span>
      ),
    },
    {
      category: 'AI & Accuracy',
      question: 'Is the AI always 100% correct?',
      answer:
        'No artificial intelligence system is infallible. However, ONCEClic enforces strict prompt-grounding and knowledge retrieval guardrails to ensure responses are derived solely from the information you provide in your business profile and FAQs. Users and business owners should periodically review AI communications.',
    },
    {
      category: 'Integrations',
      question: 'What integrations are currently available?',
      answer:
        'ONCEClic supports Google Calendar (for real-time appointment availability and scheduling), Gmail (for automated email answering), Instagram (for direct message responses), and embeddable website chat widgets.',
    },
    {
      category: 'Integrations',
      question: 'How do I add ONCEClic to my website?',
      answer:
        'You can embed the ONCEClic chat widget by copying a single-line script tag from your dashboard and pasting it before the closing </body> tag of your website. You can also share your hosted direct chat link directly with clients.',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-slate-950">
      <Navbar />

      <main className="flex-1 py-16 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto w-full">
        <div className="mb-12 pb-6 border-b border-slate-800 text-center sm:text-left">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-4">
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Answers & Guidance</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight">
            Frequently Asked Questions
          </h1>
          <p className="text-base text-slate-300 mt-3 max-w-2xl">
            Everything you need to know about ONCEClic, the 7-day free trial, billing, and integrations.
          </p>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, index) => {
            const isOpen = openIndex === index;
            return (
              <div
                key={index}
                className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden transition"
              >
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                  className="w-full text-left p-6 flex items-center justify-between space-x-4 focus:outline-none"
                >
                  <div className="flex items-center space-x-3">
                    <span className="text-[10px] uppercase font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                      {faq.category}
                    </span>
                    <h2 className="text-base font-bold text-white">{faq.question}</h2>
                  </div>
                  {isOpen ? (
                    <ChevronUp className="w-5 h-5 text-slate-400 shrink-0" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400 shrink-0" />
                  )}
                </button>
                {isOpen && (
                  <div className="px-6 pb-6 text-sm text-slate-300 leading-relaxed border-t border-slate-800/60 pt-4">
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* CTA banner */}
        <div className="mt-16 bg-gradient-to-b from-slate-900 to-slate-950 border border-emerald-500/30 rounded-3xl p-8 text-center space-y-4">
          <h2 className="text-2xl font-black text-white">Still have questions?</h2>
          <p className="text-sm text-slate-300 max-w-md mx-auto">
            Our support team is ready to help you get your AI receptionist up and running.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link
              to="/contact"
              className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl transition"
            >
              Contact Support
            </Link>
            <Link
              to="/signup"
              className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition flex items-center space-x-2"
            >
              <span>Start 7-Day Free Trial</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};
