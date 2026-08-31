import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { AnalyticsResponse, ConversationChannel } from '@onceclic/shared';
import {
  BarChart3,
  Calendar,
  MessageSquare,
  Bot,
  CalendarCheck,
  Zap,
  TrendingUp,
  Clock,
  AlertCircle,
  Globe,
  Mail,
  UserCheck,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Coins,
} from 'lucide-react';

export const AnalyticsPage: React.FC = () => {
  const [period, setPeriod] = useState<'today' | '7d' | '30d' | 'this_month' | 'custom'>('7d');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAnalytics({
        period,
        startDate: period === 'custom' ? startDate : undefined,
        endDate: period === 'custom' ? endDate : undefined,
      });
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load analytics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [period]);

  const handleCustomApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (startDate && endDate) {
      fetchAnalytics();
    }
  };

  const kpis = data?.kpis;
  const aiUsage = data?.aiUsage;

  return (
    <div className="space-y-6">
      {/* Header & Filter Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <BarChart3 className="w-7 h-7 text-emerald-400" />
            Customer & AI Analytics
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Real-time multi-tenant insights across your AI Receptionist, website traffic, and appointment bookings.
          </p>
        </div>

        {/* Date Presets Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          {(['today', '7d', '30d', 'this_month', 'custom'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                period === p
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-750 hover:text-white border border-slate-700/60'
              }`}
            >
              {p === 'today' && 'Today'}
              {p === '7d' && 'Last 7 Days'}
              {p === '30d' && 'Last 30 Days'}
              {p === 'this_month' && 'This Month'}
              {p === 'custom' && 'Custom Range'}
            </button>
          ))}

          <button
            onClick={fetchAnalytics}
            title="Refresh"
            disabled={loading}
            className="p-2 bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white rounded-lg border border-slate-700/60 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Custom Date Form */}
      {period === 'custom' && (
        <form onSubmit={handleCustomApply} className="flex flex-wrap items-center gap-3 bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 font-medium">Start:</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 font-medium">End:</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <button
            type="submit"
            disabled={!startDate || !endDate}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-4 py-1.5 rounded-lg text-xs transition disabled:opacity-50"
          >
            Apply Range
          </button>
        </form>
      )}

      {error && (
        <div className="p-4 bg-red-950/60 border border-red-800 rounded-xl text-red-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Overview KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Conversations */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Conversations</span>
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <MessageSquare className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-3xl font-bold text-white tracking-tight">
              {kpis?.totalConversations ?? 0}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-3 text-xs text-slate-400 border-t border-slate-800/80 pt-2.5">
            <span>Today: <strong className="text-slate-200">{kpis?.conversationsToday ?? 0}</strong></span>
            <span>Week: <strong className="text-slate-200">{kpis?.conversationsThisWeek ?? 0}</strong></span>
            <span>Month: <strong className="text-slate-200">{kpis?.conversationsThisMonth ?? 0}</strong></span>
          </div>
        </div>

        {/* AI Resolution Rate */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">AI Resolution Rate</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Bot className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-emerald-400 tracking-tight">
              {kpis?.aiResolutionRate ?? 0}%
            </span>
            <span className="text-xs text-slate-400 font-medium">auto-handled</span>
          </div>
          <div className="mt-3 flex items-center gap-3 text-xs text-slate-400 border-t border-slate-800/80 pt-2.5">
            <span>AI responses: <strong className="text-emerald-400">{kpis?.aiResponses ?? 0}</strong></span>
            <span>Handoffs: <strong className="text-amber-400">{kpis?.humanHandoffs ?? 0}</strong></span>
          </div>
        </div>

        {/* Appointments Booked */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Booked Appointments</span>
            <div className="w-9 h-9 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
              <CalendarCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-3xl font-bold text-teal-400 tracking-tight">
              {kpis?.appointmentsBooked ?? 0}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-3 text-xs text-slate-400 border-t border-slate-800/80 pt-2.5">
            <span>Requested: <strong className="text-slate-200">{kpis?.appointmentsRequested ?? 0}</strong></span>
            <span>Completed: <strong className="text-emerald-400">{kpis?.appointmentsCompleted ?? 0}</strong></span>
            <span>Canceled: <strong className="text-red-400">{kpis?.appointmentsCancelled ?? 0}</strong></span>
          </div>
        </div>

        {/* Avg Response Time */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Avg Response Time</span>
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white tracking-tight">
              {kpis?.averageResponseTimeSeconds ?? 0}s
            </span>
            <span className="text-xs text-slate-400 font-medium">instant AI</span>
          </div>
          <div className="mt-3 flex items-center gap-3 text-xs text-slate-400 border-t border-slate-800/80 pt-2.5">
            <span>Web chat: <strong className="text-slate-200">{kpis?.websiteConversations ?? 0}</strong></span>
            <span>Email: <strong className="text-slate-200">{kpis?.emailConversations ?? 0}</strong></span>
          </div>
        </div>
      </div>

      {/* Main Charts & Breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline Chart (Conversations & Appointments) */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base font-bold text-white">Activity Over Time</h2>
              <p className="text-xs text-slate-400 mt-0.5">Conversations and appointments recorded in the selected period</p>
            </div>
            <div className="flex items-center gap-4 text-xs font-medium">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />
                <span className="text-slate-300">Conversations</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-teal-400 inline-block" />
                <span className="text-slate-300">Appointments</span>
              </div>
            </div>
          </div>

          {/* Time Series Bar Chart */}
          {data && data.timeSeries && data.timeSeries.length > 0 ? (
            <div className="space-y-4">
              <div className="h-56 flex items-end gap-2 pt-6 pb-2 px-2 border-b border-slate-800 overflow-x-auto">
                {data.timeSeries.map((pt, idx) => {
                  const maxVal = Math.max(1, ...data.timeSeries.map((p) => Math.max(p.conversations, p.appointments)));
                  const convHeight = Math.round((pt.conversations / maxVal) * 100);
                  const appHeight = Math.round((pt.appointments / maxVal) * 100);
                  const dateLabel = pt.date.slice(5); // MM-DD

                  return (
                    <div key={idx} className="flex-1 min-w-[28px] flex flex-col items-center gap-1.5 h-full justify-end group relative">
                      {/* Tooltip */}
                      <div className="absolute bottom-full mb-2 hidden group-hover:flex flex-col bg-slate-950 text-slate-200 text-[10px] p-2 rounded border border-slate-700 shadow-xl z-20 whitespace-nowrap">
                        <span className="font-bold text-white">{pt.date}</span>
                        <span>Conversations: {pt.conversations}</span>
                        <span>Appointments: {pt.appointments}</span>
                      </div>

                      <div className="w-full flex items-end justify-center gap-1 h-44">
                        <div
                          style={{ height: `${Math.max(4, convHeight)}%` }}
                          className="w-2.5 bg-gradient-to-t from-emerald-600 to-emerald-400 rounded-t transition-all hover:brightness-125"
                        />
                        <div
                          style={{ height: `${Math.max(4, appHeight)}%` }}
                          className="w-2.5 bg-gradient-to-t from-teal-600 to-teal-400 rounded-t transition-all hover:brightness-125"
                        />
                      </div>
                      <span className="text-[10px] text-slate-500 group-hover:text-slate-300 transition">
                        {dateLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="py-16 text-center text-slate-500 text-sm">
              No activity recorded in this period.
            </div>
          )}
        </div>

        {/* Channel & Status Breakdown */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col justify-between space-y-6">
          <div>
            <h2 className="text-base font-bold text-white mb-1">Channel Distribution</h2>
            <p className="text-xs text-slate-400 mb-4">Traffic sources for incoming inquiries</p>

            <div className="space-y-3">
              {data?.channelBreakdown.map((item) => (
                <div key={item.channel} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300 flex items-center gap-1.5">
                      {item.channel === ConversationChannel.WEB ? (
                        <Globe className="w-3.5 h-3.5 text-blue-400" />
                      ) : (
                        <Mail className="w-3.5 h-3.5 text-purple-400" />
                      )}
                      {item.channel === ConversationChannel.WEB ? 'Website Chat' : 'Business Email'}
                    </span>
                    <span className="font-semibold text-white">
                      {item.count} ({item.percentage}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      style={{ width: `${item.percentage}%` }}
                      className={`h-full rounded-full ${
                        item.channel === ConversationChannel.WEB ? 'bg-blue-500' : 'bg-purple-500'
                      }`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-800 pt-5">
            <h2 className="text-base font-bold text-white mb-1">Appointment Status</h2>
            <p className="text-xs text-slate-400 mb-4">Conversion and completion breakdown</p>

            <div className="space-y-2.5 text-xs">
              {data?.appointmentStatusBreakdown.map((item) => (
                <div key={item.status} className="flex items-center justify-between p-2 bg-slate-950/60 rounded-lg border border-slate-800/80">
                  <span className="text-slate-300 font-medium capitalize">
                    {item.status.toLowerCase()}
                  </span>
                  <span className="font-bold text-white">
                    {item.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* AI Token & Cost Usage Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" />
              AI Receptionist Usage & Token Efficiency
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Accurate token telemetry and cost accounting from live GPT-4o-mini and RAG embedding models
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800">
            <span className="text-[11px] font-medium text-slate-400 block">Total AI Calls</span>
            <span className="text-lg font-bold text-white mt-1 block">{aiUsage?.totalRequests ?? 0}</span>
          </div>

          <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800">
            <span className="text-[11px] font-medium text-slate-400 block">Prompt Tokens</span>
            <span className="text-lg font-bold text-slate-200 mt-1 block">{(aiUsage?.promptTokens ?? 0).toLocaleString()}</span>
          </div>

          <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800">
            <span className="text-[11px] font-medium text-slate-400 block">Completion Tokens</span>
            <span className="text-lg font-bold text-slate-200 mt-1 block">{(aiUsage?.completionTokens ?? 0).toLocaleString()}</span>
          </div>

          <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800">
            <span className="text-[11px] font-medium text-slate-400 block">Total Tokens</span>
            <span className="text-lg font-bold text-emerald-400 mt-1 block">{(aiUsage?.totalTokens ?? 0).toLocaleString()}</span>
          </div>

          <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800">
            <span className="text-[11px] font-medium text-slate-400 block">Estimated Cost</span>
            <span className="text-lg font-bold text-amber-400 mt-1 block">${(aiUsage?.estimatedCostUsd ?? 0).toFixed(4)}</span>
          </div>

          <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800">
            <span className="text-[11px] font-medium text-slate-400 block">Success Rate</span>
            <span className="text-lg font-bold text-teal-400 mt-1 block">
              {(aiUsage?.totalRequests ?? 0) > 0
                ? `${Math.round(((aiUsage?.successfulRequests ?? 0) / (aiUsage?.totalRequests ?? 1)) * 100)}%`
                : '100%'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
