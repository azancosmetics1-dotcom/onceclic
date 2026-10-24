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
                <span><strong>No Automatic Charges:</strong> You will never be charged automatically when your trial ends. Paid subscriptions begin only if you choose to manually upgrade to a paid plan (Starter $19/mo, Pro $49/mo, Business $99/mo).</span>
              </li>
              <li className="flex items-start space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><strong>Merchant of Record:</strong> Creem acts as the online Merchant of Record for paid transactions on ONCEClic (with historical transactions supported for existing Paddle customers).</span>
              </li>
            </ul>
          </div>

          {/* Section 1 */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">1. Free Trial & Non-Automatic Conversion</h2>
            <p>
              ONCEClic provides a 7-day free trial for businesses to evaluate our AI phone receptionist, real-time calendar booking, and multi-channel messaging capabilities.
            </p>
            <p>
              Because trial access is 100% free and requires no credit card or payment credentials at signup, <strong>your trial will never automatically convert into a paid charge</strong>. When your trial concludes, your account transitions to an inactive state while preserving your configuration, business hours, and knowledge base. You can choose at any time whether to upgrade to a paid plan.
            </p>
          </section>

          {/* Section 2 */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">2. Upgrades, Recurring Renewal & Pricing</h2>
            <p>
              You may upgrade to any of our three published monthly plans at any time:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-xs sm:text-sm text-slate-300">
              <li><strong>Starter:</strong> $19.00 USD per month (includes 50 voice minutes and core AI receptionist features).</li>
              <li><strong>ONCEClic Pro:</strong> $49.00 USD per month (includes 150 voice minutes, transcripts, SMS/email alerts, and custom FAQs).</li>
              <li><strong>Business:</strong> $99.00 USD per month (includes 400 voice minutes, multiple numbers, and advanced analytics).</li>
            </ul>
            <p>
              <strong>Recurring Renewal:</strong> Upgrades require completing checkout through our Merchant of Record, <strong>Creem</strong>. Paid subscriptions renew automatically on a recurring monthly billing cycle on the same calendar day each month until you cancel.
            </p>
          </section>

          {/* Section 3 */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">3. Cancellation Policy & When Access Ends</h2>
            <p>
              You may cancel your subscription at any time without fees or penalties through the <strong>Billing</strong> section of your dashboard or directly through the Creem Customer Portal.
            </p>
            <ul className="list-disc pl-5 space-y-2 text-xs sm:text-sm text-slate-300">
              <li><strong>Access Until Cycle End:</strong> Cancellation schedules the termination at the end of your then-current paid billing period. You retain full access to all features, included voice minutes, and AI receptionist services through the end of the paid cycle.</li>
              <li><strong>No Subsequent Charges:</strong> No further monthly charges will occur once cancellation is scheduled.</li>
              <li><strong>Data Preservation:</strong> Your account settings, prompt instructions, phone configurations, and knowledge documents remain saved and will not be deleted, allowing you to reactivate in the future without reconfiguring your AI.</li>
            </ul>
          </section>

          {/* Section 4 */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white">4. Refund Policy & Eligible Conditions</h2>
            <p>
              Our order processing and recurring billing are conducted by our Merchant of Record, <strong>Creem</strong>. Creem and ONCEClic evaluate refund inquiries under the following principles:
            </p>
            <div className="space-y-3 text-xs sm:text-sm">
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                <p className="font-bold text-white">A. Technical Failure or Inability to Deliver Service (14-Day Window)</p>
                <p className="text-slate-300 mt-1">
                  If you encounter a verified critical service defect, telephony provisioning failure, or platform outage that our technical team cannot resolve within 14 calendar days of your initial paid upgrade, you are eligible for a <strong>100% full refund</strong> of the initial subscription charge.
                </p>
              </div>
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                <p className="font-bold text-white">B. Duplicate Charges and Billing Mistakes</p>
                <p className="text-slate-300 mt-1">
                  If you are erroneously billed twice, experience a duplicate transaction, or are charged after a confirmed cancellation timestamp, please contact us immediately. Verified erroneous and duplicate charges are <strong>100% refunded</strong> to your original payment method.
                </p>
              </div>
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                <p className="font-bold text-white">C. Partial-Month & Mid-Cycle Cancellations</p>
                <p className="text-slate-300 mt-1">
                  Because subscriptions remain fully operational until the end of the paid monthly billing period upon cancellation, we do not automatically offer prorated partial-period refunds for voluntary mid-cycle cancellation, except where required by applicable statutory consumer protection law.
                </p>
              </div>
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                <p className="font-bold text-white">D. Statutory Consumer Rights</p>
                <p className="text-slate-300 mt-1">
                  Nothing in this policy limits, modifies, or excludes your statutory consumer rights under applicable local laws (including the statutory right of withdrawal available to consumers in the European Union and the United Kingdom within 14 days of purchase).
                </p>
              </div>
            </div>
          </section>

          {/* Section 5 */}
          <section className="bg-slate-900 border border-emerald-500/20 rounded-2xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <Mail className="w-5 h-5 text-emerald-400" />
              <span>5. How to Submit a Refund or Billing Request</span>
            </h2>
            <p>
              To request a refund, report an unexpected charge, or inquire about an existing transaction, please contact our support team promptly:
            </p>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono space-y-1">
              <p className="text-slate-400">Support Contact Email:</p>
              <a href="mailto:kamiabc007@gmail.com" className="text-emerald-400 hover:underline font-bold text-sm">
                kamiabc007@gmail.com
              </a>
              <p className="text-slate-500 text-[11px] pt-1">
                Please include: (1) Your registered account email address, (2) Your organization name, and (3) The transaction date or receipt ID from Creem.
              </p>
            </div>
            <p className="text-xs text-slate-400">
              We review and acknowledge all billing inquiries within 24–48 business hours. Approved refunds are credited directly back to the original payment method by our Merchant of Record.
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
};
