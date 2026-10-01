import React, { useEffect } from 'react';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { Cookie, ShieldCheck, CheckCircle2, Info, Mail } from 'lucide-react';

export const CookiePolicy: React.FC = () => {
  useEffect(() => {
    document.title = 'Cookie Policy — ONCEClic';
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-slate-950">
      <Navbar />

      <main className="flex-1 py-16 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto w-full">
        <div className="mb-10 pb-6 border-b border-slate-800">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-4">
            <Cookie className="w-3.5 h-3.5" />
            <span>Transparency & Tracking</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            Cookie Policy
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-2">
            Last Updated: September 2026 &bull; Service: ONCEClic (onceclic.com)
          </p>
        </div>

        <div className="space-y-8 text-sm text-slate-300 leading-relaxed">
          {/* Overview */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">1. What Are Cookies and Local Storage?</h2>
            <p>
              Cookies and local browser storage are small text files or data keys stored on your device when you visit a website or web application. They help authenticate your session, remember your preferences, and maintain application functionality across page refreshes.
            </p>
          </section>

          {/* Categories */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">2. Technologies Used by ONCEClic</h2>
            <p>ONCEClic uses browser storage strictly for necessary operational functionality:</p>
            
            <div className="space-y-4 pt-2">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                <h3 className="font-bold text-white text-xs uppercase tracking-wider text-emerald-400">
                  A. Strictly Essential & Authentication Storage
                </h3>
                <p className="text-xs text-slate-300">
                  We use secure local storage and session tokens to maintain your authenticated login session, verify organization permissions, and protect against unauthorized access. Without these, you cannot log in or manage your dashboard.
                </p>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                <h3 className="font-bold text-white text-xs uppercase tracking-wider text-emerald-400">
                  B. Functional & Preference Storage
                </h3>
                <p className="text-xs text-slate-300">
                  Used to remember interface configurations, active organization selection, and UI display settings across browser sessions.
                </p>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                <h3 className="font-bold text-white text-xs uppercase tracking-wider text-emerald-400">
                  C. Payment Processing (Paddle)
                </h3>
                <p className="text-xs text-slate-300">
                  When you initiate a checkout or upgrade to ONCEClic Pro, our Merchant of Record (Paddle) may utilize session cookies necessary for fraud prevention, checkout security, and transaction completion.
                </p>
              </div>
            </div>
          </section>

          {/* Third-Party Analytics Disclosure */}
          <section className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <Info className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>3. Analytics & Advertising Trackers Notice</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              <strong>ONCEClic does not use intrusive cross-site advertising pixels or third-party marketing trackers (such as Google Analytics or Meta Pixel).</strong> We believe in minimal, clean data collection strictly focused on delivering reliable AI automation.
            </p>
          </section>

          {/* Managing Cookies */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">4. Managing Your Browser Storage & Cookies</h2>
            <p>
              You can control and delete cookies and local storage through your browser settings. Please note that disabling essential storage keys may prevent you from logging into your ONCEClic account or using dashboard features.
            </p>
          </section>

          {/* Contact */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <Mail className="w-5 h-5 text-emerald-400" />
              <span>5. Questions & Contact</span>
            </h2>
            <p>
              For questions regarding our Cookie Policy, please contact our team:
            </p>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono">
              <span className="text-slate-400">Support Email: </span>
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
