import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { Bot, MessageSquare, Calendar, Mail, ArrowRight, ShieldCheck, Sparkles, CheckCircle2, User } from 'lucide-react';

export const About: React.FC = () => {
  useEffect(() => {
    document.title = 'About ONCEClic — AI Business Automation & Receptionist';
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-slate-950">
      <Navbar />

      <main className="flex-1 py-16 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto w-full">
        <div className="mb-10 pb-6 border-b border-slate-800 text-center sm:text-left">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            <span>About Us</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight">
            About ONCEClic
          </h1>
          <p className="text-base sm:text-lg text-slate-300 mt-3 max-w-2xl">
            AI-powered business automation, appointment scheduling, and 24/7 customer communication.
          </p>
        </div>

        <div className="space-y-10 text-sm text-slate-300 leading-relaxed">
          {/* Mission */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-xl font-bold text-white">What is ONCEClic?</h2>
            <p>
              <strong>ONCEClic</strong> is an intelligent software platform that gives small businesses, clinics, salons, consultants, and contractors a dedicated 24/7 AI receptionist.
            </p>
            <p>
              Small businesses lose valuable clients when inbound inquiries arrive after hours or when staff are busy serving in-person customers. ONCEClic bridges this gap by instantly answering customer questions, scheduling appointments in real-time, and routing sensitive inquiries to your team.
            </p>
          </section>

          {/* Founder Section */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <User className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Leadership</h2>
                <p className="text-xs text-slate-400">Founder & Operator</p>
              </div>
            </div>
            <div className="pt-1 space-y-2">
              <h3 className="text-base font-semibold text-emerald-400">Kamran Ali</h3>
              <p className="text-xs font-medium text-slate-400">Founder & CEO of ONCEClic</p>
              <p className="text-sm text-slate-300">
                ONCEClic is founded and operated by Kamran Ali. Built to simplify communication and operations, ONCEClic provides modern businesses with reliable, automated scheduling and intelligent customer response solutions.
              </p>
            </div>
          </section>

          {/* Pillars */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-white">What ONCEClic Does</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-white text-sm">24/7 Instant Answers</h3>
                <p className="text-xs text-slate-400">
                  Grounded on your custom business knowledge base, service menu, pricing, and FAQs.
                </p>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                  <Calendar className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-white text-sm">Real-Time Booking</h3>
                <p className="text-xs text-slate-400">
                  Directly checks live calendar availability and prevents double-booking automatically.
                </p>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                  <Mail className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-white text-sm">Automated Email</h3>
                <p className="text-xs text-slate-400">
                  Connects to business email to draft and deliver prompt, grounded responses to incoming customer inquiries.
                </p>
              </div>
            </div>
          </section>

          {/* Transparency & Trial Box */}
          <section className="bg-gradient-to-b from-slate-900 to-slate-950 border border-emerald-500/30 rounded-3xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <span>Transparent & Simple Access</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-300">
              We offer a single, complete plan — <strong>ONCEClic Pro at $19/month</strong> — with a <strong>7-day free trial</strong> that requires no credit card to start. Billing is handled securely through <strong>Paddle</strong> as our Merchant of Record.
            </p>
            <div className="pt-2">
              <Link
                to="/signup"
                className="inline-flex items-center space-x-2 px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition shadow-lg shadow-emerald-500/20"
              >
                <span>Start 7-Day Free Trial</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
};
