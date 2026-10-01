import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bot, ArrowRight, Menu, X, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const Navbar: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isCurrent = (path: string) => location.pathname === path;

  return (
    <nav className="border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand Logo */}
          <Link to="/" className="flex items-center space-x-2.5 group shrink-0">
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

          {/* Desktop Navigation Links */}
          <div className="hidden md:flex items-center space-x-7 text-sm font-medium">
            <Link
              to="/"
              className={`transition-colors ${
                isCurrent('/') ? 'text-emerald-400 font-semibold' : 'text-slate-300 hover:text-white'
              }`}
            >
              Product
            </Link>
            <Link
              to="/pricing"
              className={`transition-colors ${
                isCurrent('/pricing') ? 'text-emerald-400 font-semibold' : 'text-slate-300 hover:text-white'
              }`}
            >
              Pricing ($19/mo)
            </Link>
            <Link
              to="/about"
              className={`transition-colors ${
                isCurrent('/about') ? 'text-emerald-400 font-semibold' : 'text-slate-300 hover:text-white'
              }`}
            >
              About
            </Link>
            <Link
              to="/faq"
              className={`transition-colors ${
                isCurrent('/faq') ? 'text-emerald-400 font-semibold' : 'text-slate-300 hover:text-white'
              }`}
            >
              FAQ
            </Link>
            <Link
              to="/security"
              className={`transition-colors ${
                isCurrent('/security') ? 'text-emerald-400 font-semibold' : 'text-slate-300 hover:text-white'
              }`}
            >
              Security
            </Link>
            <Link
              to="/contact"
              className={`transition-colors ${
                isCurrent('/contact') ? 'text-emerald-400 font-semibold' : 'text-slate-300 hover:text-white'
              }`}
            >
              Contact
            </Link>
          </div>

          {/* Desktop Auth CTA Buttons */}
          <div className="hidden sm:flex items-center space-x-3">
            {user ? (
              <Link
                to="/app"
                className="inline-flex items-center space-x-2 px-4 py-2 text-sm font-medium rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition shadow-sm shadow-emerald-500/20 font-bold"
              >
                <span>Dashboard</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="px-3.5 py-1.5 text-sm font-medium text-slate-300 hover:text-white transition"
                >
                  Sign In
                </Link>
                <Link
                  to="/signup"
                  className="inline-flex items-center space-x-1.5 px-4 py-2 text-sm font-bold rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition shadow-md shadow-emerald-500/20"
                >
                  <span>Start 7-Day Free Trial</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <div className="md:hidden flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white focus:outline-none"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-slate-950 border-b border-slate-800 px-4 pt-2 pb-6 space-y-3">
          <div className="flex flex-col space-y-2 text-sm font-medium">
            <Link
              to="/"
              onClick={() => setMobileMenuOpen(false)}
              className={`px-3 py-2 rounded-lg ${isCurrent('/') ? 'bg-emerald-500/10 text-emerald-400 font-semibold' : 'text-slate-300 hover:bg-slate-900'}`}
            >
              Product Overview
            </Link>
            <Link
              to="/pricing"
              onClick={() => setMobileMenuOpen(false)}
              className={`px-3 py-2 rounded-lg ${isCurrent('/pricing') ? 'bg-emerald-500/10 text-emerald-400 font-semibold' : 'text-slate-300 hover:bg-slate-900'}`}
            >
              Pricing ($19/mo)
            </Link>
            <Link
              to="/about"
              onClick={() => setMobileMenuOpen(false)}
              className={`px-3 py-2 rounded-lg ${isCurrent('/about') ? 'bg-emerald-500/10 text-emerald-400 font-semibold' : 'text-slate-300 hover:bg-slate-900'}`}
            >
              About ONCEClic
            </Link>
            <Link
              to="/faq"
              onClick={() => setMobileMenuOpen(false)}
              className={`px-3 py-2 rounded-lg ${isCurrent('/faq') ? 'bg-emerald-500/10 text-emerald-400 font-semibold' : 'text-slate-300 hover:bg-slate-900'}`}
            >
              FAQ
            </Link>
            <Link
              to="/security"
              onClick={() => setMobileMenuOpen(false)}
              className={`px-3 py-2 rounded-lg ${isCurrent('/security') ? 'bg-emerald-500/10 text-emerald-400 font-semibold' : 'text-slate-300 hover:bg-slate-900'}`}
            >
              Security & Trust
            </Link>
            <Link
              to="/contact"
              onClick={() => setMobileMenuOpen(false)}
              className={`px-3 py-2 rounded-lg ${isCurrent('/contact') ? 'bg-emerald-500/10 text-emerald-400 font-semibold' : 'text-slate-300 hover:bg-slate-900'}`}
            >
              Contact Support
            </Link>
          </div>

          <div className="pt-4 border-t border-slate-800/80 flex flex-col space-y-2">
            {user ? (
              <Link
                to="/app"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-500 text-slate-950 font-bold text-center text-sm shadow-md"
              >
                Go to Dashboard
              </Link>
            ) : (
              <>
                <Link
                  to="/signup"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-center text-sm shadow-md"
                >
                  Start 7-Day Free Trial
                </Link>
                <Link
                  to="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full py-2 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 font-medium text-center text-sm border border-slate-800"
                >
                  Sign In
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  );
};
