import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { Badge } from '../components/Badge';
import { EmbedSnippet } from '../components/EmbedSnippet';
import {
  Bot,
  Calendar,
  MessageSquare,
  CreditCard,
  ArrowRight,
  Sparkles,
  ExternalLink,
  PlusCircle,
  Activity,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { Appointment, Conversation, AIEmployee } from '@onceclic/shared';

export const Dashboard: React.FC = () => {
  const { organization } = useAuth();
  const [aiEmployee, setAiEmployee] = useState<AIEmployee | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [billing, setBilling] = useState<any>(null);
  const [aiHealth, setAiHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        const [emp, appts, convs, bill, health] = await Promise.all([
          api.getAIEmployee().catch(() => null),
          api.getAppointments().catch(() => []),
          api.getConversations().catch(() => []),
          api.getBillingStatus().catch(() => null),
          api.getAIHealth().catch(() => null),
        ]);

        setAiEmployee(emp);
        setAppointments(appts || []);
        setConversations(convs || []);
        setBilling(bill);
        setAiHealth(health);
      } catch (err) {
        console.error('[Dashboard] Error loading data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadDashboardData();
  }, []);

  const todayStr = new Date().toISOString().split('T')[0];
  const apptsToday = appointments.filter((a) => a.startTime.startsWith(todayStr));
  const openConvs = conversations.filter((c) => c.status === 'OPEN' || c.status === 'HUMAN_HANDOFF');

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">Dashboard Overview</h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time status for {organization?.name || 'your business'} AI assistant and appointments.
          </p>
        </div>

        {organization?.slug && (
          <div className="flex items-center space-x-3">
            <a
              href={`/chat/${organization.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center space-x-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition shadow-md shadow-emerald-500/20"
            >
              <span>Test Live Customer Chat</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Card 1: AI Employee */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">AI Receptionist</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <Bot className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-xl font-bold text-white">{aiEmployee?.name || 'Luna'}</span>
            <Badge variant={aiEmployee?.status === 'ACTIVE' ? 'success' : 'warning'}>
              {aiEmployee?.status || 'ACTIVE'}
            </Badge>
          </div>
          <p className="text-[11px] text-slate-400 truncate">
            {aiHealth?.available ? 'Connected to OpenAI' : 'OpenAI key required for live AI'}
          </p>
        </div>

        {/* Card 2: Appointments Today */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Appointments Today</span>
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-black text-white">{apptsToday.length}</span>
            <span className="text-xs text-slate-400">({appointments.length} total)</span>
          </div>
          <Link to="/app/appointments" className="text-[11px] text-sky-400 hover:underline flex items-center space-x-1">
            <span>View booking calendar</span>
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {/* Card 3: Open Conversations */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Conversations</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
              <MessageSquare className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-black text-white">{openConvs.length}</span>
            <span className="text-xs text-slate-400">inbox threads</span>
          </div>
          <Link to="/app/conversations" className="text-[11px] text-indigo-400 hover:underline flex items-center space-x-1">
            <span>Open unified inbox</span>
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {/* Card 4: Plan Status */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Subscription</span>
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-lg font-bold text-white">ONCEClic Pro</span>
            <Badge variant={billing?.isPro ? 'brand' : 'warning'}>
              {billing?.subscription?.status || 'TRIALING'}
            </Badge>
          </div>
          <p className="text-[11px] text-slate-400">
            {billing?.subscription?.status === 'TRIALING'
              ? `${billing?.daysRemainingInTrial || 7} days remaining in trial`
              : 'Active recurring subscription'}
          </p>
        </div>
      </div>

      {/* Grid: Upcoming Appointments & Recent Conversations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Appointments Feed */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              <Calendar className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">Upcoming Appointments</h3>
            </div>
            <Link to="/app/appointments" className="text-xs text-emerald-400 hover:underline">
              View All
            </Link>
          </div>

          {appointments.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400">
              No appointments booked yet. Try booking a test appointment via live chat!
            </div>
          ) : (
            <div className="space-y-3">
              {appointments.slice(0, 4).map((appt) => (
                <div
                  key={appt.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs"
                >
                  <div>
                    <p className="font-semibold text-white">{appt.customerName}</p>
                    <p className="text-slate-400">{appt.serviceName}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-300 font-mono">
                      {new Date(appt.startTime).toLocaleDateString()} {new Date(appt.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <Badge variant={appt.status === 'CONFIRMED' ? 'success' : 'neutral'}>
                      {appt.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Conversations Feed */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              <MessageSquare className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">Recent Customer Inquiries</h3>
            </div>
            <Link to="/app/conversations" className="text-xs text-emerald-400 hover:underline">
              View Inbox
            </Link>
          </div>

          {conversations.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400">
              No customer inquiries yet. Share your website chat link to start receiving conversations!
            </div>
          ) : (
            <div className="space-y-3">
              {conversations.slice(0, 4).map((conv) => (
                <Link
                  key={conv.id}
                  to="/app/conversations"
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs hover:border-slate-700 transition block"
                >
                  <div className="min-w-0 pr-2">
                    <p className="font-semibold text-white truncate">{conv.customerName || 'Visitor'}</p>
                    <p className="text-slate-400 truncate">{conv.lastMessage?.content || 'Started conversation'}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <Badge variant={conv.channel === 'WEB' ? 'info' : 'brand'}>{conv.channel}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Embed Integration Code */}
      {organization?.slug && <EmbedSnippet slug={organization.slug} />}
    </div>
  );
};
