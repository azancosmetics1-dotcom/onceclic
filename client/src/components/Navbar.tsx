import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bot, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const Navbar: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();

  const isCurrent = (path: string) => location.pathname === path;

  return (
    <nav className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand Logo */}
          <Link to="/" className="flex items-center space-x-2.5 group">
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

          {/* Navigation Links */}
          <div className="hidden md:flex items-center space-x-8 text-sm font-medium">
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
              Pricing ($49/mo)
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

          {/* Auth CTA Buttons */}
          <div className="flex items-center space-x-3">
            {user ? (
              <Link
                to="/app"
                className="inline-flex items-center space-x-2 px-4 py-2 text-sm font-medium rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition shadow-sm shadow-emerald-500/20"
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
                  className="inline-flex items-center space-x-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400 font-semibold transition shadow-md shadow-emerald-500/20"
                >
                  <span>Start 7-Day Free Trial</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};
