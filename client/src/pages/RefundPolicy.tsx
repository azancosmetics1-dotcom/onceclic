import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { ShieldCheck, Mail, HelpCircle, FileText, CheckCircle2 } from 'lucide-react';

export const RefundPolicy: React.FC = () => {
  useEffect(() => {
    document.title = 'Refund Policy — ONCEClic';
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-slate-950">
      <Navbar />

      <main className="flex-1 py-16 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto w-full">
        <div className="mb-10 pb-6 border-b border-slate-800">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-4">
            <FileText className="w-3.5 h-3.5" />
            <span>Legal & Billing Policy</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            Refund Policy
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-2">
            Last Updated: September 2026 &bull; Service: ONCEClic (onceclic.com)
          </p>
        </div>

        <div className="space-y-8 text-sm text-slate-300 leading-relaxed">
          {/* Summary Box */}
          <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-6 shadow-xl">
            <h2 className="text-base font-bold text-white flex items-center space-x-2 mb-3">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <span>Core Billing & Trial Transparency</span>
            </h2>
            <ul className="space-y-2 text-xs sm:text-sm text-slate-300">
              <li className="flex items-start space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><strong>7-Day Free Trial:</strong> All new accounts start with a 7-day free trial ($0.00). No credit card or payment information is required to access the trial.</span>
              </li>
              <li className="flex items-start space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><strong>No Automatic Charges:</strong> You will never be charged automatically when your trial ends. Paid subscriptions begin only if you choose to manually upgrade to ONCEClic Pro ($19/month).</span>
              </li>
              <li className="flex items-start space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><strong>Merchant of Record:</strong> Paddle acts as the Merchant of Record for applicable paid transactions on ONCEClic.</span>
              </li>
            </ul>
          </div>

          {/* Section 1 */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">1. Free Trial Period</h2>
            <p>
              ONCEClic provides a 7-day free trial for users to evaluate our AI receptionist, appointment scheduling, and automated messaging capabilities. Because trial access is 100% free and requires no payment method at registration, no charges are incurred during the trial period.
            </p>
          </section>

          {/* Section 2 */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">2. Upgrades & Paid Subscriptions</h2>
            <p>
              Following or during your trial, you may choose to upgrade to the <strong>ONCEClic Pro</strong> plan ($19 USD/month). Upgrading requires completing checkout through our Merchant of Record, <strong>Paddle</strong>.
            </p>
            <p>
              Once upgraded, recurring subscription fees are billed on a monthly cycle until canceled. You can cancel your subscription at any time directly through your dashboard billing portal.
            </p>
          </section>

          {/* Section 3 */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">3. Merchant of Record & Refund Processing</h2>
            <p>
              Our order process is conducted by our online Merchant of Record, <strong>Paddle.com</strong>. Paddle handles all customer service inquiries relating to payment processing, billing receipts, tax collection, and transaction compliance.
            </p>
            <p>
              Applicable refunds for paid transactions are evaluated and processed according to applicable Paddle policies and the specific circumstances of the transaction. Paddle processes approved refunds back to the original payment method used at the time of purchase.
            </p>
          </section>

          {/* Section 4 */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">4. Cancellation Policy</h2>
            <p>
              You may cancel your ONCEClic Pro subscription at any time. When you cancel:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-xs sm:text-sm text-slate-300">
              <li>Your subscription will remain active until the end of your current paid billing cycle.</li>
              <li>You will not be billed for subsequent billing cycles.</li>
              <li>Your business data, configurations, and knowledge base remain preserved in your account unless you request deletion.</li>
            </ul>
          </section>

          {/* Section 5 */}
          <section className="bg-slate-900 border border-emerald-500/20 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <Mail className="w-5 h-5 text-emerald-400" />
              <span>5. How to Request Help with a Billing Issue</span>
            </h2>
            <p>
              If you experience any unexpected billing issue, double-charge, or service disruption, ONCEClic is committed to assisting you. Please contact our support team promptly with your account details:
            </p>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono space-y-1">
              <p className="text-slate-400">Email Support:</p>
              <a href="mailto:kamiabc007@gmail.com" className="text-emerald-400 hover:underline font-bold text-sm">
                kamiabc007@gmail.com
              </a>
              <p className="text-slate-500 text-[11px] pt-1">
                Please include your registered account email, organization name, and transaction details.
              </p>
            </div>
            <p className="text-xs text-slate-400">
              We will review your inquiry and work alongside Paddle to resolve any billing discrepancies swiftly.
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
};
