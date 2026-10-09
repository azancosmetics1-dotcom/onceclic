import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { Bot, MessageSquare, Calendar, Mail, ArrowRight, ShieldCheck, Sparkles, User, Award, Globe, Building2 } from 'lucide-react';

export const About: React.FC = () => {
  useEffect(() => {
    document.title = 'About ONCEClic — Kamran Ali, Founder & CEO';
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
            AI-powered business automation platform for customer communication, appointments, and business workflows.
          </p>
        </div>

        <div className="space-y-10 text-sm text-slate-300 leading-relaxed">
          {/* Mission */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-xl font-bold text-white">What is ONCEClic?</h2>
            <p>
              <strong>ONCEClic</strong> is an intelligent business automation platform that provides small businesses, clinics, salons, consultants, restaurants, and service providers with dedicated 24/7 AI receptionists and automated workflows.
            </p>
            <p>
              Small businesses lose valuable clients when inbound inquiries arrive after hours or when staff are busy serving in-person customers. ONCEClic bridges this gap by instantly answering customer questions, scheduling appointments in real-time without double-booking, and routing inquiries smoothly across Website Chat, Email, Instagram, and Facebook.
            </p>
          </section>

          {/* Founder Section */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 sm:gap-8">
              {/* CEO Photo */}
              <div className="relative shrink-0">
                <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-2xl overflow-hidden border-2 border-emerald-500/40 shadow-lg shadow-emerald-500/10 bg-slate-950">
                  <img
                    src="/founder.jpg"
                    alt="Kamran Ali, Founder & CEO of ONCEClic"
                    className="w-full h-full object-cover object-center"
                    loading="lazy"
                  />
                </div>
                <div className="absolute -bottom-2 -right-2 px-2.5 py-0.5 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-bold uppercase tracking-wider shadow-sm">
                  Founder
                </div>
              </div>

              {/* CEO Details & Message */}
              <div className="flex-1 text-center sm:text-left space-y-3 min-w-0">
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                  <h2 className="text-xl sm:text-2xl font-bold text-white">Kamran Ali</h2>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                    Founder &amp; CEO
                  </span>
                </div>
                <p className="text-sm text-slate-200 leading-relaxed font-normal">
                  Kamran Ali is the Founder and CEO of ONCEClic, an AI-powered business automation platform for customer communication, appointments, and business workflows.
                </p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Founded with a focus on practical operational efficiency, ONCEClic equips independent businesses with reliable, grounded customer communication and real-time scheduling automation.
                </p>
              </div>
            </div>
          </section>

          {/* Pillars */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-white">Platform Capabilities</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-white text-sm">24/7 Instant Answers</h3>
                <p className="text-xs text-slate-400">
                  Grounded on your custom business knowledge base, service menu, pricing, and operating hours.
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
                <h3 className="font-bold text-white text-sm">Automated Email &amp; DMs</h3>
                <p className="text-xs text-slate-400">
                  Connects to business email, Instagram, and Facebook to deliver prompt, grounded customer responses.
                </p>
              </div>
            </div>
          </section>

          {/* Transparency & Trial Box */}
          <section className="bg-gradient-to-b from-slate-900 to-slate-950 border border-emerald-500/30 rounded-3xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <span>Transparent Access &amp; Pricing</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-300">
              We offer a single, complete plan — <strong>ONCEClic Pro at $19/month</strong> — with a <strong>7-day free trial ($0, no credit card required)</strong>. Billing is handled securely through <strong>Paddle</strong> as our Merchant of Record.
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
