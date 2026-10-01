import React from 'react';
import { Link } from 'react-router-dom';
import { Bot, Mail, ShieldCheck, Sparkles, ExternalLink } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="border-t border-slate-800/80 bg-slate-950 text-slate-400 text-xs mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 lg:gap-8 mb-12">
          {/* Brand & Overview */}
          <div className="lg:col-span-2 space-y-4">
            <Link to="/" className="inline-flex items-center space-x-2.5 group">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20 group-hover:scale-105 transition-transform">
                <Bot className="w-5 h-5 text-slate-950 stroke-[2.5]" />
              </div>
              <div className="flex flex-col">
                <span className="text-xl font-black tracking-tight text-white flex items-center">
                  ONCE<span className="text-emerald-400">Clic</span>
                </span>
                <span className="text-[10px] uppercase font-semibold tracking-wider text-emerald-500/90 -mt-1">
                  AI Receptionist
                </span>
              </div>
            </Link>
            <p className="text-slate-400 text-xs sm:text-sm max-w-sm leading-relaxed">
              AI-powered business automation, appointment scheduling, and 24/7 customer communication for modern service businesses.
            </p>
            <div className="pt-2 flex flex-col space-y-2 text-xs">
              <a
                href="mailto:kamiabc007@gmail.com"
                className="inline-flex items-center space-x-2 text-slate-300 hover:text-emerald-400 transition"
              >
                <Mail className="w-4 h-4 text-emerald-400" />
                <span>kamiabc007@gmail.com</span>
              </a>
              <div className="inline-flex items-center space-x-2 text-slate-400">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Merchant of Record: Paddle</span>
              </div>
            </div>
          </div>

          {/* Product Column */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">Product</h4>
            <ul className="space-y-2 text-xs">
              <li>
                <Link to="/" className="hover:text-white transition">Features Overview</Link>
              </li>
              <li>
                <Link to="/pricing" className="hover:text-white transition flex items-center space-x-1.5">
                  <span>Pricing</span>
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-400 font-semibold px-1.5 py-0.5 rounded border border-emerald-500/20">
                    $19/mo
                  </span>
                </Link>
              </li>
              <li>
                <Link to="/about" className="hover:text-white transition">About ONCEClic</Link>
              </li>
              <li>
                <Link to="/faq" className="hover:text-white transition">FAQ</Link>
              </li>
              <li>
                <Link to="/signup" className="hover:text-emerald-400 transition font-medium">
                  Start 7-Day Free Trial
                </Link>
              </li>
              <li>
                <Link to="/login" className="hover:text-white transition">Customer Sign In</Link>
              </li>
            </ul>
          </div>

          {/* Legal Column */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">Legal & Policies</h4>
            <ul className="space-y-2 text-xs">
              <li>
                <Link to="/terms" className="hover:text-white transition">Terms of Service</Link>
              </li>
              <li>
                <Link to="/privacy-policy" className="hover:text-white transition">Privacy Policy</Link>
              </li>
              <li>
                <Link to="/refund-policy" className="hover:text-white transition">Refund Policy</Link>
              </li>
              <li>
                <Link to="/cookie-policy" className="hover:text-white transition">Cookie Policy</Link>
              </li>
              <li>
                <Link to="/acceptable-use" className="hover:text-white transition">Acceptable Use Policy</Link>
              </li>
              <li>
                <Link to="/disclaimer" className="hover:text-white transition">Disclaimer</Link>
              </li>
            </ul>
          </div>

          {/* Trust & Support Column */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">Trust & Support</h4>
            <ul className="space-y-2 text-xs">
              <li>
                <Link to="/security" className="hover:text-white transition flex items-center space-x-1">
                  <span>Security & Trust</span>
                </Link>
              </li>
              <li>
                <Link to="/contact" className="hover:text-white transition">Contact Support</Link>
              </li>
              <li className="pt-2 text-[11px] text-slate-500 leading-relaxed">
                7-day free trial requires no credit card. Subscriptions can be upgraded or canceled at any time.
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Banner & Copyright */}
        <div className="pt-8 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-slate-500">
          <div className="flex items-center space-x-2">
            <span>&copy; {new Date().getFullYear()} ONCEClic (onceclic.com). All rights reserved.</span>
          </div>
          <div className="flex items-center space-x-4">
            <span>Payments & Billing powered by Paddle</span>
            <span>&bull;</span>
            <Link to="/privacy-policy" className="hover:text-slate-400">Privacy</Link>
            <span>&bull;</span>
            <Link to="/terms" className="hover:text-slate-400">Terms</Link>
            <span>&bull;</span>
            <Link to="/refund-policy" className="hover:text-slate-400">Refunds</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};
