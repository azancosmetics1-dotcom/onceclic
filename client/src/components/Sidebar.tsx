import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  BarChart3,
  Bot,
  BookOpen,
  Calendar,
  MessageSquare,
  Mail,
  Layers,
  CreditCard,
  Settings,
  LogOut,
  Building2,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Badge } from './Badge';

export const Sidebar: React.FC = () => {
  const { user, organization, role, logout } = useAuth();
  const location = useLocation();

  const navItems = [
    { label: 'Dashboard', path: '/app', icon: LayoutDashboard },
    { label: 'Analytics', path: '/app/analytics', icon: BarChart3 },
    { label: 'Integrations', path: '/app/integrations', icon: Layers },
    { label: 'AI Employee', path: '/app/ai-employee', icon: Bot },
    { label: 'Knowledge Base', path: '/app/knowledge', icon: BookOpen },
    { label: 'Appointments', path: '/app/appointments', icon: Calendar },
    { label: 'Conversations', path: '/app/conversations', icon: MessageSquare },
    { label: 'Email Answering', path: '/app/email', icon: Mail },
    { label: 'Billing & Plan', path: '/app/billing', icon: CreditCard },
    { label: 'Settings', path: '/app/settings', icon: Settings },
  ];

  const isActive = (path: string) => {
    if (path === '/app') return location.pathname === '/app';
    return location.pathname.startsWith(path);
  };

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col h-screen fixed top-0 left-0 z-40">
      {/* Brand Header */}
      <div className="h-16 px-5 flex items-center justify-between border-b border-slate-800">
        <Link to="/app" className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-md shadow-emerald-500/20">
            <Bot className="w-4 h-4 text-slate-950 stroke-[2.5]" />
          </div>
          <span className="text-lg font-black tracking-tight text-white">
            ONCE<span className="text-emerald-400">Clic</span>
          </span>
        </Link>
        <Badge variant="brand" size="sm">
          MVP
        </Badge>
      </div>

      {/* Organization Badge / Switcher */}
      <div className="p-3 border-b border-slate-800/60 bg-slate-950/40">
        <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-slate-800/60 border border-slate-750">
          <div className="flex items-center space-x-2 min-w-0">
            <Building2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="truncate">
              <p className="text-xs font-semibold text-white truncate">
                {organization?.name || 'My Organization'}
              </p>
              <p className="text-[10px] text-slate-400 capitalize">{role?.toLowerCase() || 'Member'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);

          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                active
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
              }`}
            >
              <Icon className={`w-4 h-4 ${active ? 'text-emerald-400' : 'text-slate-400'}`} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Public Chat Link Button */}
      {organization?.slug && (
        <div className="px-3 pb-2">
          <a
            href={`/chat/${organization.slug}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between px-3 py-2 text-xs font-medium text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 rounded-lg hover:bg-emerald-900/40 transition"
          >
            <span>Preview Public Chat</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}

      {/* User Footer & Logout */}
      <div className="p-3 border-t border-slate-800 bg-slate-950/60">
        <div className="flex items-center justify-between px-2 py-1.5">
          <div className="min-w-0 pr-2">
            <p className="text-xs font-medium text-white truncate">{user?.fullName || 'User'}</p>
            <p className="text-[11px] text-slate-400 truncate">{user?.email}</p>
          </div>
          <button
            onClick={logout}
            title="Sign Out"
            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};
