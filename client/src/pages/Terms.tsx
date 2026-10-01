import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { FileText, ShieldAlert, CheckCircle2 } from 'lucide-react';

export const Terms: React.FC = () => {
  useEffect(() => {
    document.title = 'Terms of Service — ONCEClic';
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-slate-950">
      <Navbar />

      <main className="flex-1 py-16 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto w-full">
        <div className="mb-10 pb-6 border-b border-slate-800">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-4">
            <FileText className="w-3.5 h-3.5" />
            <span>Legal Agreement</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            Terms of Service
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-2">
            Last Updated: September 2026 &bull; Service: ONCEClic (onceclic.com)
          </p>
        </div>

        <div className="space-y-8 text-sm text-slate-300 leading-relaxed">
          {/* Section 1 */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">1. Acceptance of Terms</h2>
            <p>
              These Terms of Service ("Terms") constitute a binding legal agreement between you ("User", "Customer", or "You") and <strong>ONCEClic</strong> ("ONCEClic", "we", "us", or "our"), governing your access to and use of the ONCEClic website at <a href="https://onceclic.com" className="text-emerald-400 hover:underline">onceclic.com</a>, the hosted dashboard, APIs, and AI receptionist automation software (collectively, the "Service").
            </p>
            <p>
              By creating an account, initiating a trial, connecting integrations, or accessing the Service, you signify your agreement to these Terms. If you do not agree to these Terms, you must not use the Service.
            </p>
          </section>

          {/* Section 2 */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">2. Description of ONCEClic Service</h2>
            <p>
              ONCEClic is a multi-tenant, cloud-based software platform designed to provide automated AI receptionist services for businesses. Key capabilities include:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-xs sm:text-sm text-slate-300">
              <li>24/7 interactive website chat assistant powered by large language models.</li>
              <li>Automated appointment scheduling synchronized with your connected calendar.</li>
              <li>Automated email inquiry drafting and answering.</li>
              <li>Custom business knowledge base retrieval and FAQ grounding.</li>
              <li>Seamless human handoff triggers when complex or sensitive inquiries arise.</li>
            </ul>
          </section>

          {/* Section 3 */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">3. Account Registration & Security</h2>
            <p>
              To access the Service, you must register for an account using a valid email address. You are solely responsible for maintaining the confidentiality of your login credentials and for all activities that occur under your account. You agree to notify ONCEClic immediately at <a href="mailto:kamiabc007@gmail.com" className="text-emerald-400 hover:underline">kamiabc007@gmail.com</a> of any unauthorized use or security breach.
            </p>
          </section>

          {/* Section 4 */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">4. Free Trial, Subscriptions & Billing</h2>
            <div className="space-y-3 text-xs sm:text-sm">
              <p>
                <strong>7-Day Free Trial:</strong> All new users receive access to a 7-day free trial ($0.00). No credit card or payment information is required to start the trial. The trial is application-managed and will not automatically charge you.
              </p>
              <p>
                <strong>ONCEClic Pro Plan:</strong> Following or during the trial, you may choose to upgrade to <strong>ONCEClic Pro</strong> at <strong>$19 USD per month</strong>.
              </p>
              <p>
                <strong>Merchant of Record:</strong> Payments and recurring billing for ONCEClic Pro are securely processed by <strong>Paddle.com</strong>, acting as our Merchant of Record. By upgrading to a paid subscription, you agree to Paddle's checkout terms and policies.
              </p>
              <p>
                <strong>Renewal & Cancellation:</strong> Paid subscriptions automatically renew on a monthly basis until canceled. You can cancel your subscription at any time via your dashboard billing settings. Cancellation takes effect at the end of the then-current billing period.
              </p>
              <p>
                <strong>Refunds:</strong> Refund requests are handled in accordance with our <Link to="/refund-policy" className="text-emerald-400 hover:underline">Refund Policy</Link> and Paddle's applicable Merchant of Record policies.
              </p>
            </div>
          </section>

          {/* Section 5 */}
          <section className="bg-slate-900 border border-amber-500/30 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
              <span>5. AI-Generated Output & User Responsibility</span>
            </h2>
            <p>
              ONCEClic utilizes artificial intelligence and automated language processing to generate conversational responses, draft emails, and schedule bookings. You acknowledge and agree that:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-xs sm:text-sm text-slate-300">
              <li><strong>Review Responsibility:</strong> You and your organization remain solely responsible for reviewing and verifying all AI-generated outputs, automated communications, appointments, and business decisions.</li>
              <li><strong>No Guarantee of Accuracy:</strong> While ONCEClic enforces strict prompt-grounding and knowledge retrieval guardrails, AI systems may occasionally produce incomplete, inaccurate, or outdated information. ONCEClic does not warrant that AI output will be 100% error-free.</li>
              <li><strong>Professional Advice Disclaimer:</strong> ONCEClic does not provide legal, financial, medical, or certified professional advice. The Service must not be used as a replacement for licensed human professional judgment.</li>
            </ul>
          </section>

          {/* Section 6 */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">6. Third-Party Integrations & Permissions</h2>
            <p>
              ONCEClic allows you to connect third-party platforms (including Google Calendar, Gmail, and Instagram) to facilitate appointment scheduling and automated replies. By authorizing an integration:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-xs sm:text-sm text-slate-300">
              <li>You grant ONCEClic permission to access, read, and write data within your connected accounts strictly as required to perform the requested automation.</li>
              <li>You represent that you hold all necessary authorizations from your organization and third-party service providers.</li>
              <li>You agree to comply with all applicable terms of service and developer policies of connected third-party platforms.</li>
            </ul>
          </section>

          {/* Section 7 */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">7. User Content & Intellectual Property</h2>
            <p>
              You retain all ownership rights in the data, FAQs, business information, and customer data ("User Content") you upload to ONCEClic. You grant ONCEClic a limited license to process and store your User Content solely to provide and maintain the Service.
            </p>
            <p>
              All software, source code, visual interfaces, documentation, logos, and trademarks comprising ONCEClic are the intellectual property of ONCEClic. You may not copy, reverse engineer, decompile, or create derivative works from the Service.
            </p>
          </section>

          {/* Section 8 */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">8. Service Availability & Modifications</h2>
            <p>
              We strive to maintain continuous availability of ONCEClic. However, the Service is provided on an "AS IS" and "AS AVAILABLE" basis without warranties of uninterrupted operation. We reserve the right to modify, update, or discontinue features of the Service with reasonable notice when feasible.
            </p>
          </section>

          {/* Section 9 */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">9. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by applicable law, ONCEClic and its operators shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data, or business opportunities arising out of or related to your use of or inability to use the Service, even if advised of the possibility of such damages.
            </p>
          </section>

          {/* Section 10 */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">10. Termination & Contact</h2>
            <p>
              We may suspend or terminate your access to the Service if you violate these Terms or engage in abusive or illegal activities. You may terminate your account at any time by contacting support.
            </p>
            <p>
              For any questions regarding these Terms of Service, please contact us at:
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
