import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { ShieldCheck, Lock, Database, Server, Mail, CheckCircle2 } from 'lucide-react';

export const Privacy: React.FC = () => {
  useEffect(() => {
    document.title = 'Privacy Policy — ONCEClic';
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-slate-950">
      <Navbar />

      <main className="flex-1 py-16 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto w-full">
        <div className="mb-10 pb-6 border-b border-slate-800">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-4">
            <Lock className="w-3.5 h-3.5" />
            <span>Data Protection & Privacy</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            Privacy Policy
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-2">
            Last Updated: September 2026 &bull; Service: ONCEClic (onceclic.com)
          </p>
        </div>

        <div className="space-y-8 text-sm text-slate-300 leading-relaxed">
          {/* Introduction */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">1. Introduction</h2>
            <p>
              This Privacy Policy explains how <strong>ONCEClic</strong> ("ONCEClic", "we", "us", or "our") collects, uses, processes, and protects information when you access our website (<a href="https://onceclic.com" className="text-emerald-400 hover:underline">onceclic.com</a>) and use our AI receptionist software services.
            </p>
            <p>
              We are committed to maintaining transparent, responsible data practices and protecting the privacy of your organization and customer interactions.
            </p>
          </section>

          {/* Categories of Data */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">2. Information We Collect</h2>
            <p>We collect information necessary to provide, secure, and operate the ONCEClic platform:</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs sm:text-sm pt-2">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1.5">
                <h3 className="font-bold text-white flex items-center space-x-2">
                  <Database className="w-4 h-4 text-emerald-400" />
                  <span>Account & Organization Data</span>
                </h3>
                <p className="text-slate-400 text-xs">
                  User name, business email address, hashed passwords, organization name, timezone, business hours, and member roles.
                </p>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1.5">
                <h3 className="font-bold text-white flex items-center space-x-2">
                  <Lock className="w-4 h-4 text-emerald-400" />
                  <span>Knowledge Base & Business FAQs</span>
                </h3>
                <p className="text-slate-400 text-xs">
                  Service descriptions, pricing info, policies, and FAQs uploaded to train and ground your AI receptionist.
                </p>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1.5">
                <h3 className="font-bold text-white flex items-center space-x-2">
                  <Server className="w-4 h-4 text-emerald-400" />
                  <span>Appointments & Inquiries</span>
                </h3>
                <p className="text-slate-400 text-xs">
                  Customer contact information, appointment booking requests, chat transcripts, and email inquiry threads.
                </p>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1.5">
                <h3 className="font-bold text-white flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Integration Tokens & Technical Logs</span>
                </h3>
                <p className="text-slate-400 text-xs">
                  OAuth authorization tokens for connected tools, API request logs, IP addresses, browser user-agents, and diagnostic metrics.
                </p>
              </div>
            </div>
          </section>

          {/* How We Use Data */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">3. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-2 text-xs sm:text-sm text-slate-300">
              <li><strong>Core Service Operation:</strong> Generating accurate AI receptionist replies, scheduling appointments, and managing email drafts.</li>
              <li><strong>Authentication & Security:</strong> Authenticating users, verifying email addresses, and enforcing role-based permissions.</li>
              <li><strong>Integration Synchronization:</strong> Connecting with Google Calendar, Gmail, or Instagram when explicitly authorized.</li>
              <li><strong>Abuse Prevention & Rate Limiting:</strong> Detecting prompt injection attempts, preventing automated spam, and ensuring platform integrity.</li>
              <li><strong>Customer Support:</strong> Assisting you with technical configuration, troubleshooting, or billing inquiries.</li>
            </ul>
          </section>

          {/* Third-Party Service Providers */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">4. Third-Party Service Providers</h2>
            <p>
              We share data with third-party service providers only as strictly necessary to deliver specific application functionality:
            </p>
            <div className="space-y-3 text-xs sm:text-sm pt-2">
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                <span className="font-bold text-white">Supabase: </span>
                <span className="text-slate-300">Provides secure database storage, row-level tenant isolation, and core user authentication.</span>
              </div>
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                <span className="font-bold text-white">Railway & Netlify: </span>
                <span className="text-slate-300">Host the secure backend API server and static web frontend client.</span>
              </div>
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                <span className="font-bold text-white">OpenAI: </span>
                <span className="text-slate-300">Processes user queries and business knowledge context to generate conversational receptionist responses.</span>
              </div>
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                <span className="font-bold text-white">Paddle: </span>
                <span className="text-slate-300">Acts as our Merchant of Record, processing payments, invoices, taxes, and subscription management for paid accounts.</span>
              </div>
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                <span className="font-bold text-white">Resend: </span>
                <span className="text-slate-300">Delivers transactional emails, such as account verification and system notifications.</span>
              </div>
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                <span className="font-bold text-white">Composio: </span>
                <span className="text-slate-300">Facilitates secure tool integration connectivity when authorized by your account.</span>
              </div>
            </div>
          </section>

          {/* Multi-Tenant Isolation */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">5. Multi-Tenant Data Isolation</h2>
            <p>
              ONCEClic is built with strict multi-tenant architecture. Your business profile, customer inquiries, appointment schedules, and knowledge base documents are segregated by unique organization identifiers. Data from one organization is never visible or accessible to other organizations.
            </p>
          </section>

          {/* Data Retention & Rights */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">6. Data Retention & User Rights</h2>
            <p>
              We retain your account data for as long as your organization maintains an active account with ONCEClic. You have the right to access, update, export, or request the deletion of your account and customer data at any time by contacting our support team.
            </p>
          </section>

          {/* Contact Section */}
          <section className="bg-slate-900 border border-emerald-500/20 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <Mail className="w-5 h-5 text-emerald-400" />
              <span>7. Privacy Inquiries & Contact</span>
            </h2>
            <p>
              If you have any questions about this Privacy Policy or wish to exercise your data protection rights, please contact:
            </p>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono">
              <span className="text-slate-400">Privacy Support: </span>
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
